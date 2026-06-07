import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import AsyncSessionLocal, get_db
from models import User, Trip, Location, TripStatus, UserRole
from auth import get_current_user, get_current_user_from_token, require_admin
from core.managers import manager, redis
from core.utils import _haversine_km
from services.location_service import record_driver_location

router = APIRouter()

class LocationUpdate(BaseModel):
    user_id: str
    lat: Optional[float] = None
    lon: Optional[float] = None
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
    return await record_driver_location(
        db,
        current_user,
        user_id=req.user_id,
        lat=req.lat,
        lon=req.lon,
        speed=req.speed,
    )


@router.websocket("/ws/location")
async def ws_location(
    ws: WebSocket,
    token: Optional[str] = None,
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
        async with AsyncSessionLocal() as db:
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
