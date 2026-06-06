import uuid as uuid_lib
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from database import get_db
from models import User, Trip, TripStatus, UserRole
from auth import get_current_user, require_admin
from services import graphhopper as gh_svc
from core.managers import manager
from schemas import WaypointSchema
from serializers.trip import serialize_trip, trip_waypoints_for_response
from services.order_events import record_order_event
from services.trip_service import (
    assert_trip_access,
    cancel_trip_and_deliveries,
    change_trip_status,
    create_trip_record,
    reassign_trip_record,
    update_trip_progress_state,
)

router = APIRouter()


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
    return [serialize_trip(t) for t in _r.scalars().all()]

@router.post("/trips", status_code=201)
async def create_trip(req: TripCreate, db: AsyncSession = Depends(get_db),
                current_user: User = Depends(require_admin)):
    trip = await create_trip_record(
        db,
        current_user,
        driver_id=req.driver_id,
        vehicle_id=req.vehicle_id,
        dest_name=req.dest_name,
        dest_lat=req.dest_lat,
        dest_lon=req.dest_lon,
        waypoints=[w.model_dump() for w in req.waypoints] if req.waypoints else [],
        departure_time=req.departure_time,
        vehicle_height_m=req.vehicle_height_m,
        vehicle_weight_kg=req.vehicle_weight_kg,
        vehicle_length_cm=req.vehicle_length_cm,
        vehicle_width_cm=req.vehicle_width_cm,
    )
    return serialize_trip(trip)

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
    assert_trip_access(t, current_user)
    return serialize_trip(t)


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
    assert_trip_access(t, current_user)

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

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    assert_trip_access(t, current_user)

    await change_trip_status(db, t, current_user, status=status)

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
        await cancel_trip_and_deliveries(
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


@router.patch("/trips/{trip_id}/reassign", status_code=200)
async def reassign_trip(
    trip_id: str,
    req: ReassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """운행 중 기사 또는 차량을 교체합니다. transfer_remaining=True 시 잔여 경유지를 새 운행으로 이관합니다."""
    import uuid as uuid_lib

    _r = await db.execute(
        select(Trip)
        .options(selectinload(Trip.driver), selectinload(Trip.deliveries))
        .where(Trip.id == uuid_lib.UUID(trip_id))
    )
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    new_trip_id = await reassign_trip_record(
        db,
        t,
        current_user,
        new_driver_id=req.new_driver_id,
        new_vehicle_id=req.new_vehicle_id,
        transfer_remaining=req.transfer_remaining,
    )

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
    assert_trip_access(t, current_user)
    await update_trip_progress_state(
        db,
        t,
        current_user,
        phase=req.phase,
        waypoint_index=req.waypoint_index,
        event=req.event,
        event_time=req.event_time,
    )

    return {
        "trip_id": trip_id,
        "status": t.status,
        "current_phase": t.current_phase,
        "phase_updated_at": t.phase_updated_at.isoformat() if t.phase_updated_at else None,
        "waypoints": trip_waypoints_for_response(t),
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
    assert_trip_access(t, current_user)
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
