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

class VehicleCreate(BaseModel):
    plate_number: str
    vehicle_type: str
    height_m:     float
    weight_kg:    float
    length_cm:    Optional[float] = None
    width_cm:     Optional[float] = None

@router.get("/vehicles")
async def get_vehicles(db: AsyncSession = Depends(get_db),
                 current_user: User = Depends(require_admin)):
    _r = await db.execute(select(Vehicle).where(Vehicle.is_active == True))
    return _r.scalars().all()

@router.post("/vehicles", status_code=201)
async def create_vehicle(req: VehicleCreate, db: AsyncSession = Depends(get_db),
                   current_user: User = Depends(require_admin)):
    v = Vehicle(**req.model_dump())
    db.add(v); await db.commit(); await db.refresh(v)
    return v

class VehicleUpdate(BaseModel):
    vehicle_type: Optional[str] = None
    weight_kg:    Optional[float] = None
    height_m:     Optional[float] = None

@router.patch("/vehicles/{vehicle_id}")
async def update_vehicle(vehicle_id: int, req: VehicleUpdate,
                         db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(require_admin)):
    _r = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    v = _r.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "차량을 찾을 수 없습니다.")
    if req.vehicle_type is not None:
        v.vehicle_type = req.vehicle_type
    if req.weight_kg is not None:
        v.weight_kg = req.weight_kg
    if req.height_m is not None:
        v.height_m = req.height_m
    await db.commit()
    await db.refresh(v)
    return v

@router.delete("/vehicles/{vehicle_id}", status_code=204)
async def delete_vehicle(vehicle_id: int, db: AsyncSession = Depends(get_db),
                   current_user: User = Depends(require_admin)):
    _r = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    v = _r.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "차량을 찾을 수 없습니다.")
    v.is_active = False
    await db.commit()


# ────────────────────────────────────────────────
# 프리셋 (waypoint 조합 저장)
# ────────────────────────────────────────────────
class PresetCreate(BaseModel):
    name:      str
    waypoints: list[dict]

@router.get("/presets")
async def get_presets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """같은 조직의 프리셋 목록 반환."""
    _r = await db.execute(
        select(Preset)
        .where(Preset.organization_id == current_user.organization_id)
        .order_by(Preset.created_at.desc())
    )
    presets = _r.scalars().all()
    return [{"id": p.id, "name": p.name, "waypoints": p.waypoints, "created_at": p.created_at} for p in presets]

@router.post("/presets", status_code=201)
async def create_preset(
    req: PresetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """현재 상차지/하차지 조합을 프리셋으로 저장."""
    if not req.name.strip():
        raise HTTPException(400, "프리셋 이름을 입력하세요.")
    if not req.waypoints:
        raise HTTPException(400, "경유지가 없습니다.")
    p = Preset(
        organization_id=current_user.organization_id,
        name=req.name.strip(),
        waypoints=req.waypoints,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return {"id": p.id, "name": p.name, "waypoints": p.waypoints, "created_at": p.created_at}

@router.delete("/presets/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """프리셋 삭제 (같은 조직만)."""
    _r = await db.execute(
        select(Preset).where(
            Preset.id == preset_id,
            Preset.organization_id == current_user.organization_id,
        )
    )
    p = _r.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "프리셋을 찾을 수 없습니다.")
    await db.delete(p)
    await db.commit()


# ────────────────────────────────────────────────
# 휴게소 (rest-stops)
# ────────────────────────────────────────────────
class RestStopCreate(BaseModel):
    name:      str
    type:      str
    latitude:  float
    longitude: float
    direction: Optional[str] = None
    note:      Optional[str] = None

@router.get("/rest-stops")
async def get_rest_stops(db: AsyncSession = Depends(get_db)):
    _r = await db.execute(select(RestStop).where(RestStop.is_active == True))
    return _r.scalars().all()

@router.post("/rest-stops", status_code=201)
async def create_rest_stop(req: RestStopCreate, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    try:
        stop_type = RestStopType(req.type)
    except ValueError:
        raise HTTPException(400, f"올바르지 않은 type: {req.type}")
    rs = RestStop(name=req.name, type=stop_type, latitude=req.latitude,
                  longitude=req.longitude, direction=req.direction, note=req.note)
    db.add(rs); await db.commit(); await db.refresh(rs)
    return rs

@router.delete("/rest-stops/{stop_id}", status_code=204)
async def delete_rest_stop(stop_id: int, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    _r = await db.execute(select(RestStop).where(RestStop.id == stop_id))
    rs = _r.scalar_one_or_none()
    if not rs:
        raise HTTPException(404, "휴게소를 찾을 수 없습니다.")
    rs.is_active = False
    await db.commit()


# ────────────────────────────────────────────────
