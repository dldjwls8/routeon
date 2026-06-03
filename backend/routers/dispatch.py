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

router = APIRouter()

from routers.trips import WaypointSchema, _trip_schema

class AutoDispatchTask(BaseModel):
    loadings:   list[WaypointSchema]
    unloadings: list[WaypointSchema]

class AutoDispatchRequest(BaseModel):
    tasks:          list[AutoDispatchTask]
    driver_ids:     Optional[list[str]] = None  # 없으면 전체 가용 기사
    vehicle_id:     Optional[int]        = None
    vehicle_assignments: Optional[dict[str, int]] = None  # driver_id → vehicle_id
    departure_time: Optional[str]        = None

@router.get("/drivers/available")
async def get_available_drivers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """현재 운행 중이 아닌 가용 기사 목록 (조직 내)"""
    busy_stmt = select(Trip.driver_id).where(
        Trip.status.in_([TripStatus.scheduled, TripStatus.in_progress])
    )
    busy_ids = {row[0] for row in (await db.execute(busy_stmt)).all()}

    stmt = select(User).where(
        User.organization_id == current_user.organization_id,
        User.role == UserRole.driver,
    ).order_by(User.name, User.username)
    drivers = (await db.execute(stmt)).scalars().all()

    return [
        {
            "id":       str(d.id),
            "username": d.username,
            "name":     d.name or d.username,
            "available": d.id not in busy_ids,
        }
        for d in drivers
    ]


@router.post("/trips/auto-dispatch", status_code=201)
async def auto_dispatch_trips(
    req: AutoDispatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    배송 태스크를 가용 기사에게 균등 분배하여 운행을 일괄 생성.
    라운드 로빈으로 기사당 여러 태스크가 배정되면 경유지를 합쳐 하나의 trip으로 생성.
    """
    import uuid as uuid_lib

    if not req.tasks:
        raise HTTPException(400, "태스크를 1개 이상 입력하세요.")

    # 가용 기사 조회
    busy_stmt = select(Trip.driver_id).where(
        Trip.status.in_([TripStatus.scheduled, TripStatus.in_progress])
    )
    busy_ids = {row[0] for row in (await db.execute(busy_stmt)).all()}

    if req.driver_ids:
        try:
            target_uuids = [uuid_lib.UUID(d) for d in req.driver_ids]
        except ValueError:
            raise HTTPException(400, "유효하지 않은 driver_id 형식이 포함되어 있습니다.")
        stmt = select(User).where(
            User.id.in_(target_uuids),
            User.organization_id == current_user.organization_id,
            User.role == UserRole.driver,
        )
    else:
        stmt = select(User).where(
            User.organization_id == current_user.organization_id,
            User.role == UserRole.driver,
        )
    drivers = (await db.execute(stmt)).scalars().all()
    available = [d for d in drivers if d.id not in busy_ids]

    if not available:
        raise HTTPException(409, "현재 가용 기사가 없습니다. 운행 중이 아닌 기사를 확인하세요.")

    # 차량 검증
    vehicle_by_driver: dict[uuid_lib.UUID, int] = {}
    if req.vehicle_assignments:
        try:
            vehicle_by_driver = {
                uuid_lib.UUID(driver_id): vehicle_id
                for driver_id, vehicle_id in req.vehicle_assignments.items()
                if vehicle_id is not None
            }
        except ValueError:
            raise HTTPException(400, "vehicle_assignments의 driver_id 형식이 올바르지 않습니다.")
        allowed_driver_ids = {d.id for d in drivers}
        invalid_driver_ids = [str(did) for did in vehicle_by_driver if did not in allowed_driver_ids]
        if invalid_driver_ids:
            raise HTTPException(403, "다른 조직 또는 미선택 기사에게 차량을 배정할 수 없습니다.")
        assigned_vehicle_ids = set(vehicle_by_driver.values())
        if assigned_vehicle_ids:
            vehicle_rows = (await db.execute(
                select(Vehicle).where(Vehicle.id.in_(assigned_vehicle_ids))
            )).scalars().all()
            vehicles = {v.id: v for v in vehicle_rows}
            missing = assigned_vehicle_ids - set(vehicles)
            if missing:
                raise HTTPException(404, f"차량을 찾을 수 없습니다: {sorted(missing)}")
            inactive = [v.id for v in vehicles.values() if not v.is_active]
            if inactive:
                raise HTTPException(400, f"비활성화된 차량입니다: {inactive}")

    if req.vehicle_id is not None:
        vehicle = (await db.execute(
            select(Vehicle).where(Vehicle.id == req.vehicle_id)
        )).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(404, "차량을 찾을 수 없습니다.")
        if not vehicle.is_active:
            raise HTTPException(400, "비활성화된 차량입니다.")

    # 기사별 마지막 위치 조회 (Redis 우선 → DB 폴백)
    driver_positions: dict = {}  # driver.id → (lat, lon) | None
    for d in available:
        val = redis.get(f"location:{d.id}")
        if val:
            lat_s, lon_s = val.split(",")
            driver_positions[d.id] = (float(lat_s), float(lon_s))
        else:
            row = (await db.execute(
                select(Location)
                .where(Location.user_id == d.id)
                .order_by(Location.recorded_at.desc())
                .limit(1)
            )).scalar_one_or_none()
            driver_positions[d.id] = (row.lat, row.lon) if row else None

    # 위치 기반 greedy 배정:
    #   기사당 최대 ceil(tasks/drivers) 개까지만 배정해 부하를 균등 분산.
    #   위치 있는 기사: 상차지에서 가장 가까운 기사 우선 배정, 한도 초과 시 후보 제외.
    #   위치 없는 기사: 라운드 로빈으로 배정.
    import math as _math
    driver_tasks: dict = {d.id: [] for d in available}
    max_per_driver = _math.ceil(len(req.tasks) / len(available))

    located = [d for d in available if driver_positions[d.id] is not None]
    rr_pool = [d for d in available if driver_positions[d.id] is None]
    rr_idx  = 0
    # 기사별 "현재 위치" — 태스크 배정 후 마지막 하차지로 갱신
    cur_pos: dict = {d.id: driver_positions[d.id] for d in located}

    for task in req.tasks:
        # 한도 미달 기사만 후보로 유지
        eligible_located = [d for d in located if len(driver_tasks[d.id]) < max_per_driver]
        if eligible_located:
            best = min(
                eligible_located,
                key=lambda d: _haversine_km(
                    cur_pos[d.id][0], cur_pos[d.id][1],
                    task.loadings[0].lat, task.loadings[0].lon,
                ),
            )
            driver_tasks[best.id].append(task)
            last = task.unloadings[-1] if task.unloadings else task.loadings[-1]
            cur_pos[best.id] = (last.lat, last.lon)
        else:
            # 위치 미확인 기사 라운드 로빈 (한도 초과 기사 포함 폴백)
            eligible_rr = [d for d in rr_pool if len(driver_tasks[d.id]) < max_per_driver]
            pool = eligible_rr if eligible_rr else available
            driver_tasks[pool[rr_idx % len(pool)].id].append(task)
            rr_idx += 1

    departure_iso: Optional[str] = None
    if req.departure_time:
        try:
            departure_iso = datetime.fromisoformat(req.departure_time).isoformat()
        except ValueError:
            raise HTTPException(400, "departure_time 형식이 올바르지 않습니다.")

    driver_map = {d.id: d for d in available}
    created_trips = []
    for driver_id, tasks in driver_tasks.items():
        if not tasks:
            continue
        driver = driver_map[driver_id]

        waypoints = []
        delivery_ids = []
        for tg, task in enumerate(tasks):
            for ld in task.loadings:
                waypoints.append({"name": ld.name, "lat": ld.lat, "lon": ld.lon,
                                  "type": "loading", "task_group": tg,
                                  "cargo_type": ld.cargo_type,
                                  "cargo_weight_ton": ld.cargo_weight_ton,
                                  "recipient_name": ld.recipient_name,
                                  "delivery_id": ld.delivery_id})
            for u in task.unloadings:
                waypoints.append({"name": u.name, "lat": u.lat, "lon": u.lon,
                                  "type": "unloading", "task_group": tg,
                                  "cargo_type": u.cargo_type,
                                  "cargo_weight_ton": u.cargo_weight_ton,
                                  "recipient_name": u.recipient_name,
                                  "delivery_id": u.delivery_id})
                if u.delivery_id:
                    try:
                        delivery_ids.append(uuid_lib.UUID(u.delivery_id))
                    except ValueError:
                        pass

        t = Trip(
            driver_id=driver.id,
            vehicle_id=vehicle_by_driver.get(driver.id, req.vehicle_id),
            waypoints=waypoints,
            departure_time=departure_iso,
        )
        db.add(t)
        await db.flush()

        # 배송 레코드를 이 trip·기사에 연결
        if delivery_ids:
            await db.execute(
                update(Delivery)
                .where(Delivery.id.in_(delivery_ids))
                .values(
                    trip_id=t.id,
                    assigned_to=driver.id,
                    status=DeliveryStatus.in_progress,
                )
            )

        created_trips.append(_trip_schema(t))

    await db.commit()

    # 각 기사에게 배차 알림 WS 전송
    for trip_data in created_trips:
        await manager.broadcast_replan_to_org(
            current_user.organization_id,
            {
                "type":      "trip.assigned",
                "trip_id":   trip_data["id"],
                "driver_id": trip_data["driver_id"],
                "message":   "새 배차가 배정되었습니다. 경로 최적화를 실행하세요.",
            }
        )

    return {
        "created": len(created_trips),
        "trips":   created_trips,
    }
