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

class LatLng(BaseModel):
    lat: float
    lon: float
    name: Optional[str] = None

class LocationUpdate(BaseModel):
    user_id: str
    lat: float
    lon: float
    speed: Optional[float] = None

@router.post("/location-logs", status_code=201)
async def create_location_log(
    req: LocationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Android 앱에서 주기적으로 현재 위치를 전송.
    1. Redis에 현재 위치 저장 (덮어씀)
    2. TimescaleDB에 이력 저장
    3. 진행 중 배송지와 거리 계산 → 50m 이내 시 자동 완료
    """
    import uuid as uuid_lib
    from datetime import datetime

    # 1. Redis — 현재 위치 갱신 (TTL 5분)
    redis.setex(
        f"location:{req.user_id}",
        300,
        f"{req.lat},{req.lon}"
    )

    # 2. TimescaleDB — 이력 저장
    loc = Location(
        user_id     = uuid_lib.UUID(req.user_id),
        lat         = req.lat,
        lon         = req.lon,
        speed       = req.speed,
        recorded_at = datetime.utcnow(),
    )
    db.add(loc)
    await db.flush()

    # 3. 도착 감지 — 해당 기사의 in_progress 배송지 조회
    current = LatLng(lat=req.lat, lon=req.lon)
    _r = await db.execute(
        select(Delivery).where(
            Delivery.assigned_to == uuid_lib.UUID(req.user_id),
            Delivery.status == DeliveryStatus.in_progress,
        ).order_by(Delivery.sequence)
    )
    pending = _r.scalars().all()

    arrived = []
    for delivery in pending:
        dest = LatLng(lat=delivery.lat, lon=delivery.lon)
        dist = _haversine(current, dest)
        if dist <= ARRIVAL_RADIUS_M:
            delivery.status       = DeliveryStatus.done
            delivery.completed_at = datetime.utcnow()
            arrived.append(str(delivery.id))

    await db.commit()

    # 4. ETA 재계산 — 현재 위치에서 남은 경유지까지 haversine 거리 합산 (평균 60km/h 기준)
    eta_remaining_min = None
    active_trip_id = None
    active_trip_r = await db.execute(
        select(Trip).where(
            Trip.driver_id == uuid_lib.UUID(req.user_id),
            Trip.status == TripStatus.in_progress,
        )
    )
    active_trip = active_trip_r.scalar_one_or_none()

    if active_trip and active_trip.optimized_route:
        active_trip_id = str(active_trip.id)
        route = active_trip.optimized_route.get("route", [])

        done_r = await db.execute(
            select(Delivery.lat, Delivery.lon).where(
                Delivery.trip_id == active_trip.id,
                Delivery.status.in_([DeliveryStatus.done, DeliveryStatus.done_manual]),
            )
        )
        done_coords = [(row.lat, row.lon) for row in done_r.all()]

        remaining = [
            n for n in route
            if n.get("type") in ("waypoint", "destination")
            and not any(
                abs(n["lat"] - d[0]) < 0.001 and abs(n["lon"] - d[1]) < 0.001
                for d in done_coords
            )
        ]

        if remaining:
            prev_lat, prev_lon = req.lat, req.lon
            total_km = 0.0
            for n in remaining:
                total_km += _haversine_km(prev_lat, prev_lon, n["lat"], n["lon"])
                prev_lat, prev_lon = n["lat"], n["lon"]
            eta_remaining_min = round((total_km / 60.0) * 60, 1)
        else:
            eta_remaining_min = 0.0
        redis.setex(f"eta:{active_trip.id}", 600, str(eta_remaining_min))

    # 5. WebSocket 브로드캐스트 — 같은 조직 관리자에게만 전송
    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "user_id":           req.user_id,
            "lat":               req.lat,
            "lon":               req.lon,
            "speed":             req.speed,
            "arrived_deliveries": arrived,
            "eta_remaining_min": eta_remaining_min,
            "trip_id":           active_trip_id,
        })

    return {
        "received":            True,
        "arrived_deliveries":  arrived,
        "eta_remaining_min":   eta_remaining_min,
    }


@router.websocket("/ws/location")
async def ws_location(
    ws: WebSocket,
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    관리자 웹이 연결하는 WebSocket 엔드포인트.
    토큰 인증 후 조직별로 위치 데이터를 수신합니다.
    """
    async def _reject():
        await ws.accept()
        await ws.close(code=1008)

    if not token:
        await _reject(); return
    try:
        current_user = await get_current_user_from_token(token, db)
    except HTTPException:
        await _reject(); return
    if current_user.role not in (UserRole.admin, UserRole.driver) or not current_user.organization_id:
        await _reject(); return

    org_id = current_user.organization_id
    if current_user.role == UserRole.driver:
        await manager.connect_driver(ws, org_id)
    else:
        await manager.connect(ws, org_id)

    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(20)
                await ws.send_text('{"type":"ping"}')
        except Exception:
            pass

    hb = asyncio.create_task(heartbeat())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hb.cancel()
        manager.disconnect(ws, org_id)

@router.get("/location-logs/{user_id}")
async def get_location_logs(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """기사의 현재(또는 마지막) 위치 조회. Redis 실시간 우선, 없으면 DB 최근 기록 폴백."""
    import uuid as uuid_lib

    val = redis.get(f"location:{user_id}")
    if val:
        lat, lon = val.split(",")
        return {"user_id": user_id, "lat": float(lat), "lon": float(lon),
                "is_realtime": True, "recorded_at": None}

    # Redis miss → TimescaleDB 최근 위치 폴백
    try:
        uid = uuid_lib.UUID(user_id)
    except ValueError:
        raise HTTPException(400, "유효하지 않은 user_id 형식입니다.")
    row = (await db.execute(
        select(Location)
        .where(Location.user_id == uid)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "위치 정보가 없습니다.")
    return {
        "user_id": user_id,
        "lat": row.lat,
        "lon": row.lon,
        "is_realtime": False,
        "recorded_at": row.recorded_at.isoformat(),
    }


@router.get("/nearby-drivers")
async def nearby_drivers(
    lat: float,
    lon: float,
    radius_km: float = 10.0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    상차지 좌표 기준 반경 내 같은 조직 기사 목록 반환.
    Redis 위치(TTL 5분)가 없는 기사는 제외.
    """
    # 같은 조직 driver 전체 조회
    _r = await db.execute(
        select(User).where(
            User.organization_id == current_user.organization_id,
            User.role == UserRole.driver,
        )
    )
    drivers = _r.scalars().all()

    # in_progress trip이 있는 기사 ID 집합
    _r2 = await db.execute(
        select(Trip.driver_id).where(
            Trip.status == TripStatus.in_progress,
        )
    )
    busy_ids = {row for row in _r2.scalars().all()}

    result = []
    for driver in drivers:
        val = redis.get(f"location:{driver.id}")
        if not val:
            continue
        dlat, dlon = map(float, val.split(","))
        dist_km = _haversine_km(lat, lon, dlat, dlon)
        if dist_km > radius_km:
            continue
        result.append({
            "driver_id":   str(driver.id),
            "username":    driver.username,
            "name":        driver.name,
            "lat":         dlat,
            "lon":         dlon,
            "distance_km": round(dist_km, 2),
            "is_busy":     driver.id in busy_ids,
        })

    result.sort(key=lambda x: x["distance_km"])
    return result
