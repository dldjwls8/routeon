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

from routers.trips import _trip_schema

def _period_cutoff(period: str) -> datetime | None:
    """period 문자열을 cutoff datetime으로 변환. 'all' 또는 알 수 없는 값은 None 반환."""
    now = datetime.utcnow()
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "week":
        return (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    return None


async def _org_driver_ids(db: AsyncSession, current_user: User) -> list:
    """현재 사용자의 조직에 속한 driver id 목록 반환. superadmin은 빈 리스트(= 전체)."""
    if current_user.role == UserRole.superadmin:
        return []
    _r = await db.execute(
        select(User.id).where(
            User.organization_id == current_user.organization_id,
            User.role == UserRole.driver,
        )
    )
    return [row[0] for row in _r.all()]


@router.get("/stats/summary")
async def stats_summary(
    period: str = "30d",
    driver_id: Optional[str] = None,
    vehicle_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cutoff = _period_cutoff(period)
    driver_ids = await _org_driver_ids(db, current_user)

    dist_col = cast(Trip.optimized_route["total_distance_km"].astext, Float)
    dur_col  = cast(Trip.optimized_route["estimated_duration_min"].astext, Float)

    stmt = select(
        func.count().label("total"),
        func.coalesce(func.sum(dist_col), 0.0).label("total_dist"),
        func.coalesce(func.avg(dur_col),  0.0).label("avg_dur"),
        func.count().filter(Trip.status == TripStatus.completed).label("completed"),
        func.count().filter(Trip.status == TripStatus.scheduled).label("scheduled"),
        func.count().filter(Trip.status == TripStatus.in_progress).label("in_progress"),
        func.count().filter(Trip.status == TripStatus.cancelled).label("cancelled"),
        func.count().filter(Trip.safety_issue == True).label("safety_issues"),
    )
    if driver_ids:
        stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if cutoff:
        stmt = stmt.where(Trip.created_at >= cutoff)
    if driver_id:
        stmt = stmt.where(Trip.driver_id == driver_id)
    if vehicle_id:
        stmt = stmt.where(Trip.vehicle_id == vehicle_id)

    row = (await db.execute(stmt)).one()
    total     = int(row.total or 0)
    completed = int(row.completed or 0)

    # 배정 완료·미배정 (Delivery 기준)
    from models import Delivery
    del_stmt = select(
        func.count().filter(Delivery.trip_id != None).label("assigned"),
        func.count().filter(Delivery.trip_id == None).label("unassigned"),
    )
    if cutoff:
        del_stmt = del_stmt.where(Delivery.created_at >= cutoff)
    if driver_ids:
        assigned_sub = select(Delivery.id).join(Trip, Delivery.trip_id == Trip.id).where(Trip.driver_id.in_(driver_ids))
        unassigned_del_stmt = select(func.count()).select_from(Delivery).where(
            Delivery.trip_id == None
        )
        if cutoff:
            unassigned_del_stmt = unassigned_del_stmt.where(Delivery.created_at >= cutoff)
        assigned_del_stmt = select(func.count()).select_from(Delivery).where(
            Delivery.id.in_(assigned_sub)
        )
        if cutoff:
            assigned_del_stmt = assigned_del_stmt.where(Delivery.created_at >= cutoff)
        assigned_count   = (await db.execute(assigned_del_stmt)).scalar() or 0
        unassigned_count = (await db.execute(unassigned_del_stmt)).scalar() or 0
    else:
        del_row = (await db.execute(del_stmt)).one()
        assigned_count   = int(del_row.assigned or 0)
        unassigned_count = int(del_row.unassigned or 0)

    return {
        "total_trips":       total,
        "total_distance_km": round(float(row.total_dist or 0), 1),
        "avg_duration_min":  round(float(row.avg_dur or 0), 1),
        "completion_rate":   round(completed / total * 100, 1) if total else 0.0,
        "safety_issues":     int(row.safety_issues or 0),
        "assigned_deliveries":   int(assigned_count),
        "unassigned_deliveries": int(unassigned_count),
        "by_status": {
            "scheduled":   int(row.scheduled   or 0),
            "in_progress": int(row.in_progress or 0),
            "completed":   completed,
            "cancelled":   int(row.cancelled   or 0),
        },
    }


@router.get("/stats/by-driver")
async def stats_by_driver(
    period: str = "30d",
    driver_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cutoff = _period_cutoff(period)
    driver_ids = await _org_driver_ids(db, current_user)

    dist_col = cast(Trip.optimized_route["total_distance_km"].astext, Float)
    dur_col  = cast(Trip.optimized_route["estimated_duration_min"].astext, Float)

    stmt = (
        select(
            Trip.driver_id,
            User.username,
            User.name,
            func.count().label("total"),
            func.count().filter(Trip.status == TripStatus.completed).label("completed"),
            func.coalesce(func.sum(dist_col), 0.0).label("total_dist"),
            func.coalesce(func.avg(dur_col),  0.0).label("avg_dur"),
            func.coalesce(func.sum(dur_col),  0.0).label("total_dur"),
            func.count(func.distinct(func.date_trunc("day", Trip.created_at))).label("work_days"),
        )
        .join(User, Trip.driver_id == User.id)
        .group_by(Trip.driver_id, User.username, User.name)
        .order_by(func.count().desc())
    )
    if driver_ids:
        stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if cutoff:
        stmt = stmt.where(Trip.created_at >= cutoff)
    if driver_id:
        stmt = stmt.where(Trip.driver_id == driver_id)

    rows = (await db.execute(stmt)).all()
    return [
        {
            "driver_id":          str(r.driver_id),
            "username":           r.username,
            "name":               r.name,
            "total_trips":        int(r.total),
            "completed_trips":    int(r.completed or 0),
            "total_distance_km":  round(float(r.total_dist or 0), 1),
            "avg_duration_min":   round(float(r.avg_dur  or 0), 1),
            "total_duration_min": round(float(r.total_dur or 0), 0),
            "work_days":          int(r.work_days or 0),
        }
        for r in rows
    ]


@router.get("/stats/by-day")
async def stats_by_day(
    period: str = "30d",
    driver_id: Optional[str] = None,
    vehicle_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cutoff = _period_cutoff(period)
    driver_ids = await _org_driver_ids(db, current_user)

    day_col = func.date_trunc("day", Trip.created_at).label("day")
    stmt = (
        select(day_col, func.count().label("cnt"))
        .group_by(day_col)
        .order_by(day_col)
    )
    if driver_ids:
        stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if cutoff:
        stmt = stmt.where(Trip.created_at >= cutoff)
    if driver_id:
        stmt = stmt.where(Trip.driver_id == driver_id)
    if vehicle_id:
        stmt = stmt.where(Trip.vehicle_id == vehicle_id)

    rows = (await db.execute(stmt)).all()
    return [{"date": r.day.strftime("%Y-%m-%d"), "count": int(r.cnt)} for r in rows]


@router.get("/stats/by-driver-day")
async def stats_by_driver_day(
    period: str = "30d",
    driver_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cutoff = _period_cutoff(period)
    driver_ids = await _org_driver_ids(db, current_user)

    dist_col = cast(Trip.optimized_route["total_distance_km"].astext, Float)
    day_col  = func.date_trunc("day", Trip.created_at).label("day")

    stmt = (
        select(
            day_col,
            Trip.driver_id,
            User.username,
            User.name,
            func.count().label("cnt"),
            func.coalesce(func.sum(dist_col), 0.0).label("total_dist"),
        )
        .join(User, Trip.driver_id == User.id)
        .group_by(day_col, Trip.driver_id, User.username, User.name)
        .order_by(day_col)
    )
    if driver_ids:
        stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if cutoff:
        stmt = stmt.where(Trip.created_at >= cutoff)
    if driver_id:
        stmt = stmt.where(Trip.driver_id == driver_id)

    rows = (await db.execute(stmt)).all()
    return [
        {
            "date":              r.day.strftime("%Y-%m-%d"),
            "driver_id":         str(r.driver_id),
            "display_name":      r.name or r.username,
            "count":             int(r.cnt),
            "total_distance_km": round(float(r.total_dist or 0), 1),
        }
        for r in rows
    ]


@router.get("/stats/by-vehicle")
async def stats_by_vehicle(
    period: str = "30d",
    vehicle_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cutoff = _period_cutoff(period)
    driver_ids = await _org_driver_ids(db, current_user)

    dist_col = cast(Trip.optimized_route["total_distance_km"].astext, Float)
    dur_col  = cast(Trip.optimized_route["estimated_duration_min"].astext, Float)

    stmt = (
        select(
            Vehicle.id,
            Vehicle.plate_number,
            Vehicle.vehicle_type,
            func.count().label("total"),
            func.count().filter(Trip.status == TripStatus.completed).label("completed"),
            func.coalesce(func.sum(dist_col), 0.0).label("total_dist"),
            func.coalesce(func.sum(dur_col),  0.0).label("total_dur"),
        )
        .join(Trip, Trip.vehicle_id == Vehicle.id)
        .group_by(Vehicle.id, Vehicle.plate_number, Vehicle.vehicle_type)
        .order_by(func.count().desc())
    )
    if driver_ids:
        stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if cutoff:
        stmt = stmt.where(Trip.created_at >= cutoff)
    if vehicle_id:
        stmt = stmt.where(Vehicle.id == vehicle_id)

    rows = (await db.execute(stmt)).all()
    return [
        {
            "vehicle_id":         r.id,
            "plate_number":       r.plate_number,
            "vehicle_type":       r.vehicle_type,
            "total_trips":        int(r.total),
            "completed_trips":    int(r.completed or 0),
            "total_distance_km":  round(float(r.total_dist or 0), 1),
            "total_duration_min": round(float(r.total_dur  or 0), 0),
        }
        for r in rows
    ]


@router.get("/stats/route-history")
async def stats_route_history(
    driver_id: str,
    period: str = "7d",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    from uuid import UUID as _UUID
    cutoff = _period_cutoff(period) or (datetime.utcnow() - timedelta(days=7))
    uid = _UUID(driver_id)
    driver = (await db.execute(
        select(User).where(User.id == uid, User.organization_id == current_user.organization_id)
    )).scalar_one_or_none()
    if not driver:
        raise HTTPException(status_code=403, detail="접근 권한 없음")

    rows = (await db.execute(
        select(Location.lat, Location.lon, Location.recorded_at)
        .where(Location.user_id == uid, Location.recorded_at >= cutoff)
        .order_by(Location.recorded_at)
    )).all()
    return [{"lat": r.lat, "lon": r.lon, "recorded_at": r.recorded_at.isoformat()} for r in rows]
