import asyncio
import httpx
import shutil
import uuid as uuid_lib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, or_, func, cast, Float, update, delete
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from database import get_db
from models import (
    User, Delivery, Trip, Vehicle, RestStop, Location, Organization,
    Conversation, Message, Preset,
    DeliveryStatus, TripStatus, RestStopType, UserRole, OrgStatus
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, get_current_user_from_token,
    require_admin, require_driver, require_superadmin,
)
from services.optimizer import solve_tsp, validate_tsp_constraints
from services.rest_stop_inserter import RouteNode, insert_rest_stops
from services.email_service import send_approved, send_rejected
from services import kakao_mobility
from services import graphhopper as gh_svc
from core.config import ARRIVAL_RADIUS_M, UPLOAD_DIR, ALLOWED_EXTS, MAX_FILE_SIZE, KAKAO_BASE, KAKAO_REST_KEY, KAKAO_JS_KEY
from core.managers import manager, redis, chat_manager
from core.utils import _haversine, _haversine_km, _coord_to_address
from services.order_events import record_order_event

router = APIRouter()

class WaypointSchema(BaseModel):
    name:             str
    lat:              float
    lon:              float
    type:             str            = "unloading"  # "loading" | "unloading"
    task_group:       Optional[int] = None
    recipient_name:   Optional[str] = None   # 수신자(고객사명) — unloading 전용
    cargo_type:       Optional[str] = None   # 화물 종류
    cargo_size:       Optional[str] = None   # 화물 규격
    cargo_weight_ton: Optional[float] = None # 과거 톤수 값(호환용)
    shipper_name:     Optional[str] = None   # 화주명
    contact_name:     Optional[str] = None   # 담당자명
    contact_phone:    Optional[str] = None   # 담당자 연락처
    shipper_phone:    Optional[str] = None   # 화주 연락처
    delivery_id:      Optional[str] = None   # Delivery UUID — auto-dispatch 연결용

class TripCreate(BaseModel):
    driver_id:         str
    vehicle_id:        Optional[int]   = None
    dest_name:         Optional[str]   = None
    dest_lat:          Optional[float] = None
    dest_lon:          Optional[float] = None
    waypoints:         Optional[list[WaypointSchema]] = None
    departure_time:    Optional[str]   = None
    vehicle_height_m:  Optional[float] = None
    vehicle_weight_kg: Optional[float] = None
    vehicle_length_cm: Optional[float] = None
    vehicle_width_cm:  Optional[float] = None


def _same_unloading_point(w: dict, lat: float, lon: float) -> bool:
    if w.get("type") == "loading":
        return False
    try:
        w_lat = float(w.get("lat"))
        w_lon = float(w.get("lon"))
    except (TypeError, ValueError):
        return False
    return abs(w_lat - lat) < 1e-6 and abs(w_lon - lon) < 1e-6


def _dest_waypoint(name: str, lat: float, lon: float) -> dict:
    return {
        "name": name,
        "lat": lat,
        "lon": lon,
        "type": "unloading",
        "task_group": None,
        "recipient_name": None,
        "cargo_type": None,
        "cargo_size": None,
        "cargo_weight_ton": None,
        "shipper_name": None,
        "contact_name": None,
        "contact_phone": None,
        "shipper_phone": None,
        "delivery_id": None,
    }


def _apply_delivery_to_waypoint(w: dict, delivery: Delivery) -> None:
    stamp = (delivery.created_at or datetime.utcnow()).strftime("%y%m%d")
    w["order_no"] = w.get("order_no") or f"RO-{stamp}-{str(delivery.id).replace('-', '')[-6:].upper()}"
    w["recipient_name"] = w.get("recipient_name") or delivery.recipient_name
    w["cargo_type"] = w.get("cargo_type") or delivery.cargo_type
    w["cargo_size"] = w.get("cargo_size") or delivery.cargo_size
    w["cargo_weight_ton"] = (
        w.get("cargo_weight_ton")
        if w.get("cargo_weight_ton") is not None
        else delivery.cargo_weight_ton
    )
    w["shipper_name"] = w.get("shipper_name") or delivery.shipper_name
    w["contact_name"] = w.get("contact_name") or delivery.contact_name
    w["contact_phone"] = w.get("contact_phone") or delivery.contact_phone
    w["shipper_phone"] = w.get("shipper_phone") or delivery.shipper_phone or delivery.contact_phone


def _assert_trip_access(t: Trip, current_user: User) -> None:
    if current_user.role == UserRole.driver:
        if str(t.driver_id) != str(current_user.id):
            raise HTTPException(403, "본인 운행만 조회할 수 있습니다.")
        return
    if current_user.role == UserRole.superadmin:
        return
    if not current_user.organization_id:
        raise HTTPException(403, "소속 조직이 없습니다.")
    if not t.driver or t.driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직 운행에는 접근할 수 없습니다.")


async def _cancel_trip_and_deliveries(
    db: AsyncSession,
    t: Trip,
    *,
    reason: Optional[str] = None,
    cancelled_by: Optional[str] = None,
    actor_user: Optional[User] = None,
    org_id: Optional[int] = None,
    notify: bool = True,
) -> None:
    t.status = TripStatus.cancelled
    t.current_phase = "cancelled"
    t.phase_updated_at = datetime.utcnow()
    t.cancel_requested = False
    if reason is not None:
        t.cancel_request_reason = reason

    await _freeze_vehicle_position_from_driver(db, vehicle_id=t.vehicle_id, driver_id=t.driver_id)

    affected_deliveries = (await db.execute(
        select(Delivery).where(
            Delivery.trip_id == t.id,
            Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.in_progress]),
        )
    )).scalars().all()

    await db.execute(
        update(Delivery)
        .where(
            Delivery.trip_id == t.id,
            Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.in_progress]),
        )
        .values(status=DeliveryStatus.cancelled)
    )

    for delivery in affected_deliveries:
        record_order_event(
            db,
            organization_id=org_id,
            delivery_id=delivery.id,
            trip_id=t.id,
            actor=actor_user,
            actor_id=cancelled_by,
            event_type="trip.cancelled",
            summary="운행 취소",
            details={"reason": reason or ""},
        )

    if notify and org_id:
        payload = {
            "type": "trip.cancelled",
            "trip_id": str(t.id),
            "driver_id": str(t.driver_id),
            "reason": reason or "",
            "cancelled_by": cancelled_by or "",
            "message": "배차가 취소되었습니다.",
        }
        await manager.broadcast_replan_to_org(org_id, payload)
        await manager.broadcast_to_org(org_id, payload)


async def _freeze_vehicle_position_from_driver(
    db: AsyncSession,
    *,
    vehicle_id: Optional[int],
    driver_id,
) -> None:
    if vehicle_id is None or driver_id is None:
        return
    vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))).scalar_one_or_none()
    if not vehicle:
        return

    now = datetime.utcnow()
    val = redis.get(f"location:{driver_id}")
    if val:
        lat_s, lon_s = val.split(",")
        vehicle.last_lat = float(lat_s)
        vehicle.last_lon = float(lon_s)
        vehicle.last_gps_at = now
        return

    loc = (await db.execute(
        select(Location)
        .where(Location.user_id == driver_id)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if loc:
        vehicle.last_lat = loc.lat
        vehicle.last_lon = loc.lon
        vehicle.last_gps_at = loc.recorded_at


@router.get("/trips")
async def get_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    driver_id: Optional[str] = None,
    status: Optional[str] = None,
):
    import uuid as uuid_lib
    stmt = select(Trip).options(selectinload(Trip.deliveries), selectinload(Trip.driver))
    if current_user.role == UserRole.driver:
        # 기사: 본인 운행만
        stmt = stmt.where(Trip.driver_id == current_user.id)
    else:
        # 관리자: 같은 기업 기사의 운행만
        _r = await db.execute(
            select(User.id).where(
                User.organization_id == current_user.organization_id,
                User.role == UserRole.driver,
            )
        )
        driver_ids = [row[0] for row in _r.all()]
        if driver_id:
            stmt = stmt.where(Trip.driver_id == uuid_lib.UUID(driver_id))
        else:
            stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if status:
        stmt = stmt.where(Trip.status == status)
    stmt = stmt.order_by(Trip.created_at.desc())
    _r = await db.execute(stmt)
    return [_trip_schema(t) for t in _r.scalars().all()]

@router.post("/trips", status_code=201)
async def create_trip(req: TripCreate, db: AsyncSession = Depends(get_db),
                current_user: User = Depends(require_admin)):
    import uuid as uuid_lib
    # 기사 검증
    try:
        driver_uuid = uuid_lib.UUID(req.driver_id)
    except ValueError:
        raise HTTPException(400, "유효하지 않은 driver_id 형식입니다.")
    driver = (await db.execute(select(User).where(User.id == driver_uuid))).scalar_one_or_none()
    if not driver:
        raise HTTPException(404, "기사를 찾을 수 없습니다.")
    if driver.role != UserRole.driver:
        raise HTTPException(400, "지정한 사용자는 기사가 아닙니다.")
    if driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직의 기사에게 배차할 수 없습니다.")
    # 중복 배차 검증
    existing = (await db.execute(
        select(Trip).where(
            Trip.driver_id == driver_uuid,
            Trip.status.in_([TripStatus.scheduled, TripStatus.in_progress]),
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "해당 기사에게 이미 진행 중인 배차가 있습니다.")
    # 차량 검증
    vehicle = None
    if req.vehicle_id is not None:
        vehicle = (await db.execute(
            select(Vehicle).where(
                Vehicle.id == req.vehicle_id,
                Vehicle.organization_id == current_user.organization_id,
            )
        )).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(404, "차량을 찾을 수 없습니다.")
        if not vehicle.is_active:
            raise HTTPException(400, "비활성화된 차량입니다.")
    waypoints_json = [w.model_dump() for w in req.waypoints] if req.waypoints else []
    if req.dest_name and req.dest_lat is not None and req.dest_lon is not None:
        has_dest_waypoint = any(_same_unloading_point(w, req.dest_lat, req.dest_lon) for w in waypoints_json)
        if not has_dest_waypoint:
            waypoints_json.append(_dest_waypoint(req.dest_name, req.dest_lat, req.dest_lon))
    if not waypoints_json:
        raise HTTPException(400, "상차지 또는 하차지를 1개 이상 입력해주세요.")

    delivery_ids: list[uuid_lib.UUID] = []
    for w in waypoints_json:
        raw_delivery_id = w.get("delivery_id")
        if raw_delivery_id:
            try:
                delivery_ids.append(uuid_lib.UUID(str(raw_delivery_id)))
            except ValueError:
                raise HTTPException(400, "유효하지 않은 delivery_id 형식입니다.")
            continue
        if w.get("type") != "unloading" or w.get("lat") is None or w.get("lon") is None:
            continue
        matched_delivery = (await db.execute(
            select(Delivery).where(
                Delivery.organization_id == current_user.organization_id,
                Delivery.assigned_to == driver_uuid,
                Delivery.trip_id == None,
                Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.in_progress]),
                Delivery.lat.between(float(w["lat"]) - 0.0001, float(w["lat"]) + 0.0001),
                Delivery.lon.between(float(w["lon"]) - 0.0001, float(w["lon"]) + 0.0001),
            ).order_by(Delivery.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        if matched_delivery:
            w["delivery_id"] = str(matched_delivery.id)
            _apply_delivery_to_waypoint(w, matched_delivery)
            delivery_ids.append(matched_delivery.id)

    t = Trip(
        driver_id=driver_uuid, vehicle_id=req.vehicle_id,
        dest_name=req.dest_name, dest_lat=req.dest_lat, dest_lon=req.dest_lon,
        waypoints=waypoints_json, departure_time=req.departure_time or datetime.utcnow().isoformat(),
        vehicle_height_m=req.vehicle_height_m  if req.vehicle_height_m  is not None else (vehicle.height_m  if vehicle else None),
        vehicle_weight_kg=req.vehicle_weight_kg if req.vehicle_weight_kg is not None else (vehicle.weight_kg if vehicle else None),
        vehicle_length_cm=req.vehicle_length_cm if req.vehicle_length_cm is not None else (vehicle.length_cm if vehicle else None),
        vehicle_width_cm=req.vehicle_width_cm   if req.vehicle_width_cm  is not None else (vehicle.width_cm  if vehicle else None),
    )
    db.add(t)
    await db.flush()
    if delivery_ids:
        await db.execute(
            update(Delivery)
            .where(
                Delivery.id.in_(delivery_ids),
                Delivery.organization_id == current_user.organization_id,
            )
            .values(
                trip_id=t.id,
                assigned_to=driver_uuid,
                status=DeliveryStatus.in_progress,
            )
        )
        for delivery_id in delivery_ids:
            record_order_event(
                db,
                organization_id=current_user.organization_id,
                delivery_id=delivery_id,
                trip_id=t.id,
                actor=current_user,
                event_type="trip.assigned",
                summary=f"배차 생성: {driver.name or driver.username}",
                details={
                    "driver_id": str(driver_uuid),
                    "driver_name": driver.name or driver.username,
                    "vehicle_id": req.vehicle_id,
                },
            )
    await db.commit()
    await db.refresh(t)
    return _trip_schema(t)

@router.get("/trips/{trip_id}")
async def get_trip(trip_id: str, db: AsyncSession = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    import uuid as uuid_lib
    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    _assert_trip_access(t, current_user)
    return _trip_schema(t)


@router.get("/trips/{trip_id}/polyline")
async def get_trip_polyline(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    운행의 최적화된 경로를 실제 도로 폴리라인 좌표로 반환합니다.
    관리자 웹 지도에서 경로선을 그릴 때 사용합니다.
    """
    import uuid as uuid_lib

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    _assert_trip_access(t, current_user)

    route_data = t.optimized_route
    if not route_data or not route_data.get("route"):
        raise HTTPException(400, "아직 경로 최적화가 완료되지 않은 운행입니다.")

    nodes = route_data["route"]  # [{type, name, lat, lon}, ...]

    if len(nodes) < 2:
        return {"trip_id": trip_id, "polyline": [], "nodes": nodes}

    try:
        raw_polyline, _, _ = await gh_svc.get_route_with_stats(nodes, profile="truck")
        # [[lat, lon], ...] → [{"lat": ..., "lon": ...}, ...]
        polyline = [{"lat": p[0], "lon": p[1]} for p in raw_polyline]
    except Exception:
        polyline = [{"lat": n["lat"], "lon": n["lon"]} for n in nodes]

    return {
        "trip_id":  trip_id,
        "polyline": polyline,
        "nodes":    nodes,
    }


@router.patch("/trips/{trip_id}/waypoints")
async def add_waypoint(
    trip_id: str,
    req: WaypointSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    운행 중 경유지를 추가합니다 (원격 배차).
    1. trips.waypoints에 경유지 추가
    2. WebSocket으로 해당 기사 앱에 재경로 요청 알림 전송

    앱은 이 알림을 수신하면 POST /optimize/replan을 호출해야 합니다.
    """
    import uuid as uuid_lib

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    if not t.driver or t.driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직 운행은 수정할 수 없습니다.")

    # waypoints 배열에 추가
    current_waypoints = list(t.waypoints or [])
    new_waypoint = req.model_dump()   # type 필드(기본값 "unloading") 포함
    current_waypoints.append(new_waypoint)
    t.waypoints = current_waypoints
    await db.commit()
    await db.refresh(t)

    # WebSocket으로 재경로 요청 알림 — 관리자 웹 + 기사 앱 모두 전송
    if current_user.organization_id:
        replan_data = {
            "type":         "replan_requested",
            "trip_id":      trip_id,
            "driver_id":    str(t.driver_id),
            "new_waypoint": new_waypoint,
            "waypoints":    current_waypoints,
            "message":      f"새 경유지 '{req.name}'이 추가됐습니다. 경로를 재계산하세요.",
        }
        await manager.broadcast_to_org(current_user.organization_id, replan_data)
        await manager.broadcast_replan_to_org(current_user.organization_id, replan_data)

    return {
        "trip_id":   trip_id,
        "waypoints": current_waypoints,
        "added":     new_waypoint,
    }


@router.patch("/trips/{trip_id}/status")
async def update_trip_status(
    trip_id: str,
    status: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    운행 상태 변경.

    쿼리 파라미터:
      - status=completed : 운행 완료
      - status=cancelled : 운행 취소

    예시: PATCH /trips/{id}/status?status=completed
    """
    import uuid as uuid_lib
    from datetime import datetime

    if status not in ("completed", "cancelled"):
        raise HTTPException(400, "status는 'completed' 또는 'cancelled'만 가능합니다.")

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    _assert_trip_access(t, current_user)

    if t.status == TripStatus.completed:
        raise HTTPException(400, "이미 완료된 운행입니다.")
    if t.status == TripStatus.cancelled:
        raise HTTPException(400, "이미 취소된 운행입니다.")

    # 권한 확인 — 기사는 본인 운행만 완료 처리 가능
    if current_user.role == UserRole.driver and str(t.driver_id) != str(current_user.id):
        raise HTTPException(403, "본인 운행만 처리할 수 있습니다.")

    if status == "completed":
        t.status = TripStatus.completed
        t.current_phase = "completed"
        t.phase_updated_at = datetime.utcnow()
        t.completed_at = datetime.utcnow()
        await _freeze_vehicle_position_from_driver(db, vehicle_id=t.vehicle_id, driver_id=t.driver_id)

        # 소속 배송지 중 미완료 건 일괄 완료 처리
        _rd = await db.execute(
            select(Delivery).where(
                Delivery.trip_id == t.id,
                Delivery.status  == DeliveryStatus.in_progress,
            )
        )
        for d in _rd.scalars().all():
            d.status       = DeliveryStatus.done_manual
            d.completed_at = datetime.utcnow()
            record_order_event(
                db,
                organization_id=t.driver.organization_id if t.driver else current_user.organization_id,
                delivery_id=d.id,
                trip_id=t.id,
                actor=current_user,
                event_type="trip.completed",
                summary="운행 완료",
                details={"completed_at": d.completed_at.isoformat()},
            )
    else:
        org_id = t.driver.organization_id if t.driver else current_user.organization_id
        cancel_reason = "기사 앱에서 운행 취소" if current_user.role == UserRole.driver else "관리자 웹에서 배차 취소"
        await _freeze_vehicle_position_from_driver(db, vehicle_id=t.vehicle_id, driver_id=t.driver_id)
        await _cancel_trip_and_deliveries(
            db,
            t,
            reason=cancel_reason,
            cancelled_by=str(current_user.id),
            actor_user=current_user,
            org_id=org_id,
        )

    await db.commit()
    await db.refresh(t)

    return {
        "trip_id":      str(t.id),
        "status":       t.status,
        "current_phase": t.current_phase,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }

class CancelRequestSchema(BaseModel):
    reason: str


@router.post("/trips/{trip_id}/cancel-request")
async def request_trip_cancel(
    trip_id: str,
    req: CancelRequestSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """기사가 운행 취소를 요청합니다. 관리자에게 WS 알림이 전송됩니다."""
    import uuid as uuid_lib

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    if str(t.driver_id) != str(current_user.id):
        raise HTTPException(403, "본인 운행만 취소 요청할 수 있습니다.")
    if t.status not in (TripStatus.scheduled, TripStatus.in_progress):
        raise HTTPException(400, "취소 요청이 불가능한 운행 상태입니다.")
    if t.cancel_requested:
        raise HTTPException(400, "이미 취소 요청이 진행 중입니다.")
    reason = req.reason.strip()
    if not reason:
        raise HTTPException(400, "취소 사유를 입력해주세요.")

    t.cancel_requested      = True
    t.cancel_request_reason = reason
    for delivery in t.deliveries:
        record_order_event(
            db,
            organization_id=current_user.organization_id,
            delivery_id=delivery.id,
            trip_id=t.id,
            actor=current_user,
            event_type="trip.cancel_requested",
            summary="기사 취소 요청",
            details={"reason": reason},
        )
    await db.commit()

    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "type":      "trip.cancel_requested",
            "trip_id":   trip_id,
            "driver_id": str(current_user.id),
            "reason":    reason,
        })

    return {"trip_id": trip_id, "cancel_requested": True, "reason": reason}


@router.post("/trips/{trip_id}/cancel-request/respond")
async def respond_trip_cancel(
    trip_id: str,
    action: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자가 기사의 취소 요청을 승인(approve) 또는 거절(reject)합니다."""
    import uuid as uuid_lib
    from datetime import datetime

    if action not in ("approve", "reject"):
        raise HTTPException(400, "action은 'approve' 또는 'reject'만 가능합니다.")

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    if not t.driver or t.driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직 운행은 처리할 수 없습니다.")
    if not t.cancel_requested:
        raise HTTPException(400, "진행 중인 취소 요청이 없습니다.")

    if action == "approve":
        await _cancel_trip_and_deliveries(
            db,
            t,
            reason=t.cancel_request_reason,
            cancelled_by=str(current_user.id),
            actor_user=current_user,
            org_id=current_user.organization_id,
        )
    else:
        t.cancel_requested = False
        for delivery in t.deliveries:
            record_order_event(
                db,
                organization_id=current_user.organization_id,
                delivery_id=delivery.id,
                trip_id=t.id,
                actor=current_user,
                event_type="trip.cancel_rejected",
                summary="취소 요청 반려",
                details={},
            )
    t.cancel_request_reason = None

    await db.commit()

    if current_user.organization_id:
        await manager.broadcast_replan_to_org(current_user.organization_id, {
            "type":    "trip.cancel_responded",
            "trip_id": trip_id,
            "action":  action,
            "status":  t.status.value,
        })
        await manager.broadcast_to_org(current_user.organization_id, {
            "type":      "trip.cancel_responded",
            "trip_id":   trip_id,
            "driver_id": str(t.driver_id),
            "action":    action,
            "status":    t.status.value,
        })

    return {"trip_id": trip_id, "action": action}


class ReassignRequest(BaseModel):
    new_driver_id:      Optional[str] = None
    new_vehicle_id:     Optional[int] = None
    transfer_remaining: bool          = False  # True: 현재 운행 취소 + 새 운행 생성


class TripProgressUpdate(BaseModel):
    phase: Optional[str] = None
    waypoint_index: Optional[int] = None
    event: Optional[str] = None  # arrived | departed | completed
    event_time: Optional[str] = None


TRIP_PHASES = {
    "waiting",
    "en_route_to_loading",
    "loading_arrived",
    "loading_completed",
    "en_route_to_unloading",
    "unloading_arrived",
    "unloading_completed",
    "completed",
    "cancelled",
}


def _phase_from_waypoint_event(waypoint: dict, event: str) -> str:
    is_loading = waypoint.get("type") == "loading"
    if event == "arrived":
        return "loading_arrived" if is_loading else "unloading_arrived"
    if event in ("departed", "completed"):
        return "loading_completed" if is_loading else "unloading_completed"
    raise HTTPException(400, "event는 arrived, departed, completed 중 하나여야 합니다.")


def _waypoint_event_summary(waypoint: dict, event: str) -> str:
    is_loading = waypoint.get("type") == "loading"
    place = waypoint.get("name") or ("상차지" if is_loading else "하차지")
    if event == "arrived":
        return f"{'상차' if is_loading else '하차'} 도착: {place}"
    return f"{'상차' if is_loading else '하차'} 완료: {place}"


@router.patch("/trips/{trip_id}/reassign", status_code=200)
async def reassign_trip(
    trip_id: str,
    req: ReassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """운행 중 기사 또는 차량을 교체합니다. transfer_remaining=True 시 잔여 경유지를 새 운행으로 이관합니다."""
    import uuid as uuid_lib

    if not req.new_driver_id and req.new_vehicle_id is None:
        raise HTTPException(400, "교체할 기사 ID 또는 차량 ID를 입력해주세요.")

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    if not t.driver or t.driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직 운행은 교체할 수 없습니다.")
    if t.status not in (TripStatus.scheduled, TripStatus.in_progress):
        raise HTTPException(400, "완료되거나 취소된 운행은 교체할 수 없습니다.")

    new_trip_id = None

    if req.new_driver_id:
        try:
            new_driver_uuid = uuid_lib.UUID(req.new_driver_id)
        except ValueError:
            raise HTTPException(400, "유효하지 않은 new_driver_id 형식입니다.")
        new_driver = (await db.execute(select(User).where(User.id == new_driver_uuid))).scalar_one_or_none()
        if not new_driver:
            raise HTTPException(404, "교체할 기사를 찾을 수 없습니다.")
        if new_driver.role != UserRole.driver:
            raise HTTPException(400, "지정한 사용자는 기사가 아닙니다.")
        if new_driver.organization_id != current_user.organization_id:
            raise HTTPException(403, "다른 조직의 기사로 교체할 수 없습니다.")

        if req.transfer_remaining:
            if req.new_vehicle_id is not None:
                vehicle = (await db.execute(
                    select(Vehicle).where(
                        Vehicle.id == req.new_vehicle_id,
                        Vehicle.organization_id == current_user.organization_id,
                    )
                )).scalar_one_or_none()
                if not vehicle:
                    raise HTTPException(404, "차량을 찾을 수 없습니다.")
                if not vehicle.is_active:
                    raise HTTPException(400, "비활성화된 차량입니다.")
            # 현재 운행 취소 후 새 기사에게 잔여 경유지로 새 운행 생성
            await _cancel_trip_and_deliveries(
                db,
                t,
                reason="기사·차량 교체로 기존 배차 취소",
                cancelled_by=str(current_user.id),
                actor_user=current_user,
                org_id=current_user.organization_id,
            )
            chosen_vehicle = req.new_vehicle_id if req.new_vehicle_id is not None else t.vehicle_id
            new_trip = Trip(
                driver_id=new_driver_uuid,
                vehicle_id=chosen_vehicle,
                dest_name=t.dest_name, dest_lat=t.dest_lat, dest_lon=t.dest_lon,
                waypoints=list(t.waypoints or []),
                departure_time=t.departure_time,
            )
            db.add(new_trip)
            await db.flush()
            new_trip_id = str(new_trip.id)
            delivery_ids = []
            for w in list(t.waypoints or []):
                raw_delivery_id = w.get("delivery_id") if isinstance(w, dict) else None
                if not raw_delivery_id:
                    continue
                try:
                    delivery_ids.append(uuid_lib.UUID(str(raw_delivery_id)))
                except ValueError:
                    pass
            if delivery_ids:
                await db.execute(
                    update(Delivery)
                    .where(
                        Delivery.id.in_(delivery_ids),
                        Delivery.organization_id == current_user.organization_id,
                    )
                    .values(
                        trip_id=new_trip.id,
                        assigned_to=new_driver_uuid,
                        status=DeliveryStatus.in_progress,
                    )
                )
                for delivery_id in delivery_ids:
                    record_order_event(
                        db,
                        organization_id=current_user.organization_id,
                        delivery_id=delivery_id,
                        trip_id=new_trip.id,
                        actor=current_user,
                        event_type="trip.reassigned",
                        summary=f"잔여 운행 이관: {new_driver.name or new_driver.username}",
                        details={
                            "old_trip_id": trip_id,
                            "new_trip_id": str(new_trip.id),
                            "new_driver_id": str(new_driver_uuid),
                            "new_vehicle_id": chosen_vehicle,
                        },
                    )
        else:
            existing = (await db.execute(
                select(Trip).where(
                    Trip.driver_id == new_driver_uuid,
                    Trip.status.in_([TripStatus.scheduled, TripStatus.in_progress]),
                )
            )).scalar_one_or_none()
            if existing:
                raise HTTPException(409, "해당 기사에게 이미 진행 중인 배차가 있습니다.")
            t.driver_id = new_driver_uuid
            for delivery in t.deliveries:
                record_order_event(
                    db,
                    organization_id=current_user.organization_id,
                    delivery_id=delivery.id,
                    trip_id=t.id,
                    actor=current_user,
                    event_type="trip.reassigned",
                    summary=f"기사 교체: {new_driver.name or new_driver.username}",
                    details={"new_driver_id": str(new_driver_uuid)},
                )

    if req.new_vehicle_id is not None and not req.transfer_remaining:
        vehicle = (await db.execute(
            select(Vehicle).where(
                Vehicle.id == req.new_vehicle_id,
                Vehicle.organization_id == current_user.organization_id,
            )
        )).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(404, "차량을 찾을 수 없습니다.")
        if not vehicle.is_active:
            raise HTTPException(400, "비활성화된 차량입니다.")
        t.vehicle_id = req.new_vehicle_id
        for delivery in t.deliveries:
            record_order_event(
                db,
                organization_id=current_user.organization_id,
                delivery_id=delivery.id,
                trip_id=t.id,
                actor=current_user,
                event_type="trip.vehicle_changed",
                summary=f"차량 교체: {req.new_vehicle_id}",
                details={"new_vehicle_id": req.new_vehicle_id},
            )

    await db.commit()

    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "type":        "trip.reassigned",
            "trip_id":     trip_id,
            "driver_id":   str(t.driver_id),
            "new_trip_id": new_trip_id,
        })

    return {
        "trip_id":     trip_id,
        "transferred": req.transfer_remaining,
        "new_trip_id": new_trip_id,
    }


@router.patch("/trips/{trip_id}/progress")
async def update_trip_progress(
    trip_id: str,
    req: TripProgressUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    앱에서 상차/하차 진행 이벤트를 기록합니다.

    body 예시:
      {"waypoint_index": 0, "event": "arrived"}
      {"waypoint_index": 0, "event": "departed"}
      {"phase": "en_route_to_unloading"}
    """
    import uuid as uuid_lib

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    _assert_trip_access(t, current_user)
    if t.status in (TripStatus.completed, TripStatus.cancelled):
        raise HTTPException(400, "완료/취소된 운행은 진행 상태를 변경할 수 없습니다.")

    event_time = req.event_time or datetime.utcnow().isoformat()
    wps = list(t.waypoints or [])
    phase = req.phase
    event_waypoint = None
    event_name = None

    if req.waypoint_index is not None:
        idx = int(req.waypoint_index)
        if idx < 0 or idx >= len(wps):
            raise HTTPException(400, "waypoint_index가 범위를 벗어났습니다.")
        event = req.event or "arrived"
        if event not in ("arrived", "departed", "completed"):
            raise HTTPException(400, "event는 arrived, departed, completed 중 하나여야 합니다.")
        key = "arrived_at" if event == "arrived" else "departed_at"
        wps[idx][key] = event_time
        event_waypoint = dict(wps[idx])
        event_name = event
        phase = phase or _phase_from_waypoint_event(wps[idx], event)
        t.waypoints = wps
        flag_modified(t, "waypoints")

    if not phase:
        raise HTTPException(400, "phase 또는 waypoint_index/event를 입력해주세요.")
    if phase not in TRIP_PHASES:
        raise HTTPException(400, f"올바르지 않은 phase: {phase}")

    if t.status == TripStatus.scheduled:
        t.status = TripStatus.in_progress
        t.started_at = t.started_at or datetime.utcnow()
        for delivery in t.deliveries:
            record_order_event(
                db,
                organization_id=t.driver.organization_id if t.driver else current_user.organization_id,
                delivery_id=delivery.id,
                trip_id=t.id,
                actor=current_user,
                event_type="trip.started",
                summary="기사 운행 시작",
                details={"started_at": t.started_at.isoformat()},
            )
    t.current_phase = phase
    t.phase_updated_at = datetime.utcnow()

    if event_waypoint:
        raw_delivery_id = event_waypoint.get("delivery_id")
        record_order_event(
            db,
            organization_id=t.driver.organization_id if t.driver else current_user.organization_id,
            delivery_id=raw_delivery_id,
            trip_id=t.id,
            actor=current_user,
            event_type=f"trip.waypoint_{event_name}",
            summary=_waypoint_event_summary(event_waypoint, event_name),
            details={
                "waypoint_index": req.waypoint_index,
                "event": event_name,
                "event_time": event_time,
                "waypoint": event_waypoint,
                "phase": phase,
            },
        )

    await db.commit()
    await db.refresh(t)

    if t.driver and t.driver.organization_id:
        await manager.broadcast_to_org(t.driver.organization_id, {
            "type": "trip.progress_updated",
            "trip_id": trip_id,
            "driver_id": str(t.driver_id),
            "current_phase": t.current_phase,
            "waypoint_index": req.waypoint_index,
            "event": req.event,
        })

    return {
        "trip_id": trip_id,
        "status": t.status,
        "current_phase": t.current_phase,
        "phase_updated_at": t.phase_updated_at.isoformat() if t.phase_updated_at else None,
        "waypoints": _trip_waypoints_for_response(t),
    }


def _trip_waypoints_for_response(t: Trip) -> list[dict]:
    wp = t.waypoints or []
    response_wp = [dict(w) for w in wp]
    deliveries = t.__dict__.get("deliveries") or []
    deliveries_by_id = {str(d.id): d for d in deliveries}
    for w in response_wp:
        delivery_id = w.get("delivery_id")
        delivery = deliveries_by_id.get(str(delivery_id)) if delivery_id else None
        if delivery:
            _apply_delivery_to_waypoint(w, delivery)
    if t.dest_name and t.dest_lat is not None and t.dest_lon is not None:
        has_dest_waypoint = any(_same_unloading_point(w, t.dest_lat, t.dest_lon) for w in response_wp)
        if not has_dest_waypoint:
            response_wp.append(_dest_waypoint(t.dest_name, t.dest_lat, t.dest_lon))
    return response_wp


def _trip_schema(t: Trip) -> dict:
    wp = _trip_waypoints_for_response(t)
    loadings   = sum(1 for w in wp if w.get("type") == "loading")
    unloadings = sum(1 for w in wp if w.get("type") != "loading")
    return {
        "id": str(t.id), "driver_id": str(t.driver_id), "vehicle_id": t.vehicle_id,
        "dest_name": t.dest_name, "dest_lat": t.dest_lat, "dest_lon": t.dest_lon,
        "waypoints": wp, "optimized_route": t.optimized_route,
        "status": t.status, "departure_time": t.departure_time,
        "current_phase": t.current_phase or "waiting",
        "phase_updated_at": t.phase_updated_at.isoformat() + "Z" if t.phase_updated_at else None,
        "is_emergency": t.is_emergency, "created_at": t.created_at.isoformat() + "Z",
        "started_at": t.started_at.isoformat() + "Z" if t.started_at else None,
        "completed_at": t.completed_at.isoformat() + "Z" if t.completed_at else None,
        "loading_count": loadings, "unloading_count": unloadings,
        "cancel_requested": bool(t.cancel_requested),
        "cancel_request_reason": t.cancel_request_reason,
    }

@router.patch("/trips/{trip_id}/safety")
async def update_trip_safety(
    trip_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = (await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(trip_id)))).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="운행을 찾을 수 없습니다")
    t.safety_issue = bool(body.get("safety_issue", False))
    await db.commit()
    return {"ok": True}


@router.patch("/trips/{trip_id}/waypoint-dwell")
async def update_waypoint_dwell(
    trip_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """경유지 도착/출발 시간 기록. body: {index, arrived_at?, departed_at?}"""
    t = (await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="운행을 찾을 수 없습니다")
    _assert_trip_access(t, current_user)
    wps = list(t.waypoints or [])
    idx = int(body.get("index", 0))
    if 0 <= idx < len(wps):
        if "arrived_at" in body:
            wps[idx]["arrived_at"] = body["arrived_at"]
        if "departed_at" in body:
            wps[idx]["departed_at"] = body["departed_at"]
        t.waypoints = wps
        flag_modified(t, "waypoints")
        record_order_event(
            db,
            organization_id=t.driver.organization_id if t.driver else current_user.organization_id,
            delivery_id=wps[idx].get("delivery_id") if isinstance(wps[idx], dict) else None,
            trip_id=t.id,
            actor=current_user,
            event_type="trip.waypoint_dwell",
            summary="경유지 도착·출발 시간 기록",
            details={"waypoint_index": idx, "waypoint": wps[idx]},
        )
        await db.commit()
    return {"ok": True}
