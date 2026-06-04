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

class DeliveryCreate(BaseModel):
    address:          str
    lat:              Optional[float] = None
    lon:              Optional[float] = None
    deadline:         Optional[str]   = None
    recipient_name:   Optional[str]   = None
    cargo_type:       Optional[str]   = None
    cargo_weight_ton: Optional[float] = None
    pickup_address:   Optional[str]   = None
    pickup_lat:       Optional[float] = None
    pickup_lon:       Optional[float] = None
    shipper_name:     Optional[str]   = None
    contact_name:     Optional[str]   = None
    contact_phone:    Optional[str]   = None
    shipper_phone:    Optional[str]   = None
    mixed_load:       bool            = False

class DeliveryAssign(BaseModel):
    driver_id: str   # UUID 문자열

class DeliveryUpdate(BaseModel):
    status:           Optional[str]   = None   # "cancelled" 등
    address:          Optional[str]   = None
    lat:              Optional[float] = None
    lon:              Optional[float] = None
    pickup_address:   Optional[str]   = None
    pickup_lat:       Optional[float] = None
    pickup_lon:       Optional[float] = None
    recipient_name:   Optional[str]   = None
    cargo_type:       Optional[str]   = None
    cargo_weight_ton: Optional[float] = None
    contact_name:     Optional[str]   = None
    shipper_name:     Optional[str]   = None
    contact_phone:    Optional[str]   = None
    shipper_phone:    Optional[str]   = None
    deadline:         Optional[str]   = None


@router.post("/deliveries", status_code=201)
async def create_delivery(
    req: DeliveryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송지 단건 등록"""
    from datetime import datetime
    deadline = None
    if req.deadline:
        try:
            deadline = datetime.strptime(req.deadline, "%Y-%m-%d %H:%M")
        except ValueError:
            raise HTTPException(400, "deadline 형식: 'YYYY-MM-DD HH:MM'")

    delivery = Delivery(
        organization_id  = current_user.organization_id,
        address          = req.address,
        lat              = req.lat,
        lon              = req.lon,
        deadline         = deadline,
        recipient_name   = req.recipient_name,
        cargo_type       = req.cargo_type,
        cargo_weight_ton = req.cargo_weight_ton,
        pickup_address   = req.pickup_address,
        pickup_lat       = req.pickup_lat,
        pickup_lon       = req.pickup_lon,
        shipper_name     = req.shipper_name,
        contact_name     = req.contact_name,
        contact_phone    = req.contact_phone,
        shipper_phone    = req.shipper_phone or req.contact_phone,
        mixed_load       = req.mixed_load,
    )
    db.add(delivery)
    await db.commit()
    await db.refresh(delivery)
    return _delivery_schema(delivery)


@router.post("/deliveries/batch", status_code=201)
async def create_deliveries_batch(
    reqs: list[DeliveryCreate],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송지 여러 개 한 번에 등록"""
    from datetime import datetime
    deliveries = []
    for req in reqs:
        deadline = None
        if req.deadline:
            try:
                deadline = datetime.strptime(req.deadline, "%Y-%m-%d %H:%M")
            except ValueError:
                raise HTTPException(400, f"deadline 형식 오류: {req.deadline}")
        d = Delivery(
            organization_id=current_user.organization_id,
            address=req.address, lat=req.lat, lon=req.lon, deadline=deadline,
            recipient_name=req.recipient_name, cargo_type=req.cargo_type,
            cargo_weight_ton=req.cargo_weight_ton,
            pickup_address=req.pickup_address, pickup_lat=req.pickup_lat,
            pickup_lon=req.pickup_lon, shipper_name=req.shipper_name,
            contact_name=req.contact_name, contact_phone=req.contact_phone,
            shipper_phone=req.shipper_phone or req.contact_phone,
            mixed_load=req.mixed_load,
        )
        db.add(d)
        deliveries.append(d)
    await db.commit()
    for d in deliveries:
        await db.refresh(d)
    return [_delivery_schema(d) for d in deliveries]


@router.patch("/deliveries/{delivery_id}/assign")
async def assign_delivery(
    delivery_id: str,
    req: DeliveryAssign,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송지에 기사 배정"""
    import uuid as uuid_lib
    _r = await db.execute(
        select(Delivery).where(
            Delivery.id == uuid_lib.UUID(delivery_id),
            Delivery.organization_id == current_user.organization_id,
        )
    )
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")

    _r2 = await db.execute(
        select(User).where(
            User.id == uuid_lib.UUID(req.driver_id),
            User.organization_id == current_user.organization_id,
            User.role == UserRole.driver,
        )
    )
    driver = _r2.scalar_one_or_none()
    if not driver:
        raise HTTPException(404, "기사를 찾을 수 없습니다.")

    delivery.assigned_to = driver.id
    delivery.status      = DeliveryStatus.in_progress
    await db.commit()
    await db.refresh(delivery)
    return _delivery_schema(delivery)


@router.patch("/deliveries/{delivery_id}")
async def update_delivery(
    delivery_id: str,
    req: DeliveryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 오더 수정 (상태 변경·필드 업데이트)"""
    from datetime import datetime
    _r = await db.execute(
        select(Delivery).where(
            Delivery.id == uuid_lib.UUID(delivery_id),
            Delivery.organization_id == current_user.organization_id,
        )
    )
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    if delivery.status in (DeliveryStatus.done, DeliveryStatus.done_manual):
        raise HTTPException(400, "완료된 배송은 수정할 수 없습니다.")
    cancelled_now = False
    if req.status is not None:
        try:
            delivery.status = DeliveryStatus(req.status)
            cancelled_now = delivery.status == DeliveryStatus.cancelled
        except ValueError:
            raise HTTPException(400, f"올바르지 않은 상태: {req.status}")
    if req.address is not None:
        delivery.address = req.address
    if req.lat is not None:
        delivery.lat = req.lat
    if req.lon is not None:
        delivery.lon = req.lon
    if req.pickup_address is not None:
        delivery.pickup_address = req.pickup_address
    if req.pickup_lat is not None:
        delivery.pickup_lat = req.pickup_lat
    if req.pickup_lon is not None:
        delivery.pickup_lon = req.pickup_lon
    if req.recipient_name is not None:
        delivery.recipient_name = req.recipient_name
    if req.cargo_type is not None:
        delivery.cargo_type = req.cargo_type
    if req.cargo_weight_ton is not None:
        delivery.cargo_weight_ton = req.cargo_weight_ton
    if req.contact_name is not None:
        delivery.contact_name = req.contact_name
    if req.shipper_name is not None:
        delivery.shipper_name = req.shipper_name
    if req.contact_phone is not None:
        delivery.contact_phone = req.contact_phone
    if req.shipper_phone is not None:
        delivery.shipper_phone = req.shipper_phone
    if req.deadline is not None:
        try:
            delivery.deadline = datetime.strptime(req.deadline, "%Y-%m-%d %H:%M")
        except ValueError:
            raise HTTPException(400, "deadline 형식: 'YYYY-MM-DD HH:MM'")
    if cancelled_now and delivery.trip_id:
        active_count = (await db.execute(
            select(func.count(Delivery.id)).where(
                Delivery.trip_id == delivery.trip_id,
                Delivery.id != delivery.id,
                Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.in_progress]),
            )
        )).scalar_one()
        if active_count == 0:
            trip = (await db.execute(select(Trip).where(Trip.id == delivery.trip_id))).scalar_one_or_none()
            if trip and trip.status in (TripStatus.scheduled, TripStatus.in_progress):
                trip.status = TripStatus.cancelled
                trip.current_phase = "cancelled"
                trip.phase_updated_at = datetime.utcnow()
                trip.cancel_requested = False
                if current_user.organization_id:
                    payload = {
                        "type": "trip.cancelled",
                        "trip_id": str(trip.id),
                        "driver_id": str(trip.driver_id),
                        "reason": "관리자 웹에서 오더 취소",
                        "cancelled_by": str(current_user.id),
                        "message": "배차가 취소되었습니다.",
                    }
                    await manager.broadcast_replan_to_org(current_user.organization_id, payload)
                    await manager.broadcast_to_org(current_user.organization_id, payload)
    await db.commit()
    await db.refresh(delivery)
    return _delivery_schema(delivery)


@router.delete("/deliveries/{delivery_id}", status_code=204)
async def delete_delivery(
    delivery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송 취소 (삭제)"""
    import uuid as uuid_lib
    _r = await db.execute(
        select(Delivery).where(
            Delivery.id == uuid_lib.UUID(delivery_id),
            Delivery.organization_id == current_user.organization_id,
        )
    )
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    if delivery.status == DeliveryStatus.done:
        raise HTTPException(400, "완료된 배송은 삭제할 수 없습니다.")
    await db.delete(delivery)
    await db.commit()


@router.get("/deliveries")
async def get_deliveries(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    기사: 본인에게 배정된 in_progress 배송 목록
    관리자: 전체 배송 목록
    """
    stmt = select(Delivery)
    if current_user.role == UserRole.driver:
        stmt = stmt.where(
            Delivery.assigned_to == current_user.id,
            Delivery.status == DeliveryStatus.in_progress,
        )
    else:
        stmt = stmt.where(Delivery.organization_id == current_user.organization_id)
    stmt = stmt.order_by(Delivery.sequence, Delivery.created_at)
    _r = await db.execute(stmt)
    deliveries = _r.scalars().all()
    return [_delivery_schema(d) for d in deliveries]


@router.get("/deliveries/{delivery_id}")
async def get_delivery(
    delivery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """배송 상세 조회"""
    import uuid as uuid_lib
    stmt = select(Delivery).where(Delivery.id == uuid_lib.UUID(delivery_id))
    if current_user.role != UserRole.driver:
        stmt = stmt.where(Delivery.organization_id == current_user.organization_id)
    _r = await db.execute(stmt)
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    # 기사는 본인 배송만 조회 가능
    if current_user.role == UserRole.driver and delivery.assigned_to != current_user.id:
        raise HTTPException(403, "접근 권한이 없습니다.")
    return _delivery_schema(delivery)


def _delivery_schema(d: Delivery) -> dict:
    """Delivery 모델 → dict 변환 헬퍼"""
    return {
        "id":               str(d.id),
        "organization_id":  d.organization_id,
        "address":          d.address,
        "lat":              d.lat,
        "lon":              d.lon,
        "pickup_address":   d.pickup_address,
        "pickup_lat":       d.pickup_lat,
        "pickup_lon":       d.pickup_lon,
        "shipper_name":     d.shipper_name,
        "contact_name":     d.contact_name,
        "contact_phone":    d.contact_phone,
        "shipper_phone":    d.shipper_phone or d.contact_phone,
        "mixed_load":       d.mixed_load,
        "recipient_name":   d.recipient_name,
        "cargo_type":       d.cargo_type,
        "cargo_weight_ton": d.cargo_weight_ton,
        "status":           d.status,
        "sequence":         d.sequence,
        "trip_id":          str(d.trip_id)    if d.trip_id    else None,
        "assigned_to":      str(d.assigned_to) if d.assigned_to else None,
        "deadline":         d.deadline.isoformat()     if d.deadline     else None,
        "completed_at":     d.completed_at.isoformat() if d.completed_at else None,
        "created_at":       d.created_at.isoformat(),
    }

@router.patch("/deliveries/{delivery_id}/complete")
async def manual_complete(
    delivery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_driver),
):
    """
    GPS 미감지 시 기사가 수동으로 배송 완료 처리.
    status → done_manual
    """
    import uuid as uuid_lib
    from datetime import datetime

    _r = await db.execute(select(Delivery).where(Delivery.id == uuid_lib.UUID(delivery_id)))
    delivery = _r.scalar_one_or_none()

    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    if delivery.assigned_to != current_user.id:
        raise HTTPException(403, "본인에게 배정된 배송만 완료할 수 있습니다.")
    if delivery.status in (DeliveryStatus.done, DeliveryStatus.done_manual):
        raise HTTPException(400, "이미 완료된 배송입니다.")

    delivery.status       = DeliveryStatus.done_manual
    delivery.completed_at = datetime.utcnow()
    await db.commit()

    return {"id": delivery_id, "status": delivery.status}
