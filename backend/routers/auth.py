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

class RegisterRequest(BaseModel):
    username: str
    password: str
    phone:    str
    org_code: str              # 기사/관리자 추가 가입 시 조직코드 입력
    name:     str
    role: str = "driver"

class LoginRequest(BaseModel):
    username: str
    password: str

@router.get("/auth/check-username")
async def check_username(
    username: str,
    db: AsyncSession = Depends(get_db),
):
    """
    아이디 중복 확인 (인증 불필요).
    가입 전 사용 가능 여부 확인.

    예시: GET /auth/check-username?username=driver1
    """
    _r = await db.execute(select(User).where(User.username == username))
    exists = _r.scalar_one_or_none() is not None
    return {
        "username":   username,
        "available":  not exists,
        "message":    "사용 가능한 아이디입니다." if not exists else "이미 사용 중인 아이디입니다.",
    }


# ────────────────────────────────────────────────
# 인증 (회원가입 / 로그인)
# ────────────────────────────────────────────────
@router.post("/auth/register", status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    기사 또는 관리자 추가 가입.
    - org_code로 소속 기업 확인 후 가입
    - role=driver  → pending (관리자 승인 필요)
    - role=admin   → admin 즉시 (같은 기업 관리자 추가)
    """
    if req.role not in ("driver", "admin"):
        raise HTTPException(400, "role은 'driver' 또는 'admin'이어야 합니다.")
    if not req.phone:
        raise HTTPException(400, "전화번호는 필수입니다.")
    if not req.org_code:
        raise HTTPException(400, "조직 코드는 필수입니다.")

    # 조직코드로 기업 조회
    _o = await db.execute(
        select(Organization).where(Organization.org_code == req.org_code)
    )
    org = _o.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "올바르지 않은 조직 코드입니다.")

    # 아이디 중복 확인
    _r = await db.execute(select(User).where(User.username == req.username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")

    if req.role == "admin":
        actual_role = UserRole.admin
    elif org.auto_approve_drivers:
        actual_role = UserRole.driver
    else:
        actual_role = UserRole.pending

    user = User(
        username        = req.username,
        password_hash   = hash_password(req.password),
        role            = actual_role,
        name            = req.name,
        phone           = req.phone,
        organization_id = org.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id":         str(user.id),
        "username":   user.username,
        "name":       user.name,
        "role":       user.role,
        "org_name":   org.name,
        "created_at": user.created_at,
    }


@router.post("/auth/approve/{user_id}")
async def approve_driver(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: pending 기사를 승인하여 driver로 변경 (같은 기업만)"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(User.id == uuid_lib.UUID(user_id)))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if user.organization_id != current_user.organization_id:
        raise HTTPException(403, "같은 기업의 기사만 승인할 수 있습니다.")
    if user.role != UserRole.pending:
        raise HTTPException(400, "승인 대기 중인 계정이 아닙니다.")

    user.role = UserRole.driver
    await db.commit()
    await db.refresh(user)

    return {"id": str(user.id), "username": user.username, "role": user.role}


@router.post("/auth/reissue-org-code")
async def reissue_org_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 조직코드 재발급 (Organization.org_code 갱신)"""
    import random, string
    if not current_user.organization_id:
        raise HTTPException(400, "소속 조직이 없습니다.")
    org = (await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "소속 조직을 찾을 수 없습니다.")
    new_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    org.org_code = new_code
    await db.commit()
    return {"org_code": new_code}


@router.post("/auth/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """로그인 → JWT 액세스 토큰 발급"""
    _r = await db.execute(select(User).where(User.username == req.username))
    user = _r.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")

    token = create_token(str(user.id), user.role.value)
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user_id":      str(user.id),
        "username":     user.username,
        "role":         user.role,
    }


@router.get("/auth/me")
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 로그인된 유저 정보 확인"""
    org_code = None
    if current_user.organization_id:
        org = (await db.execute(
            select(Organization).where(Organization.id == current_user.organization_id)
        )).scalar_one_or_none()
        org_code = org.org_code if org else None
    return {
        "id":       str(current_user.id),
        "username": current_user.username,
        "name":     current_user.name,
        "role":     current_user.role,
        "phone":    current_user.phone,
        "org_code": org_code,
    }



class UpdateMeRequest(BaseModel):
    phone:            Optional[str] = None
    current_password: Optional[str] = None
    new_password:     Optional[str] = None


@router.patch("/auth/me")
async def update_me(
    req: UpdateMeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 정보 수정 — 전화번호 및 비밀번호 변경"""
    if not req.phone and not req.new_password:
        raise HTTPException(400, "변경할 정보를 입력해주세요.")

    # 비밀번호 변경
    if req.new_password:
        if not req.current_password:
            raise HTTPException(400, "비밀번호 변경 시 현재 비밀번호가 필요합니다.")
        if not verify_password(req.current_password, current_user.password_hash):
            raise HTTPException(401, "현재 비밀번호가 올바르지 않습니다.")
        if len(req.new_password) < 4:
            raise HTTPException(400, "새 비밀번호는 4자 이상이어야 합니다.")
        current_user.password_hash = hash_password(req.new_password)

    # 전화번호 변경
    if req.phone:
        current_user.phone = req.phone

    await db.commit()
    await db.refresh(current_user)

    return {
        "id":       str(current_user.id),
        "username": current_user.username,
        "role":     current_user.role,
        "phone":    current_user.phone,
    }


@router.get("/users")
async def get_users(
    role: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 같은 기업 유저 목록 조회"""
    stmt = select(User).where(User.organization_id == current_user.organization_id)
    if role:
        try:
            stmt = stmt.where(User.role == UserRole(role))
        except ValueError:
            raise HTTPException(400, f"올바르지 않은 role 값: {role}")
    stmt = stmt.order_by(User.created_at.desc())
    _r = await db.execute(stmt)
    users = _r.scalars().all()
    return [
        {
            "id":            str(u.id),
            "username":      u.username,
            "name":          u.name,
            "role":          u.role,
            "phone":         u.phone,
            "org_code":      None,
            "vehicle_id":    u.vehicle_id,
            "driver_status": u.driver_status,
            "created_at":    u.created_at.isoformat(),
        }
        for u in users
    ]


class UserUpdate(BaseModel):
    name:          Optional[str] = None
    phone:         Optional[str] = None
    driver_status: Optional[str] = None
    vehicle_id:    Optional[int] = None


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    req: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 기사 정보 수정 (상태, 배정 차량 등)"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(User.id == uuid_lib.UUID(user_id)))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if req.name is not None:
        user.name = req.name
    if req.phone is not None:
        user.phone = req.phone
    if req.driver_status is not None:
        user.driver_status = req.driver_status
    if 'vehicle_id' in req.model_fields_set:
        if req.vehicle_id is not None:
            _vc = await db.execute(select(Vehicle).where(Vehicle.id == req.vehicle_id))
            if not _vc.scalar_one_or_none():
                raise HTTPException(404, "차량을 찾을 수 없습니다.")
        # 기존 동일 vehicle_id 보유 기사 해제
        if req.vehicle_id is not None:
            _dup = await db.execute(
                select(User).where(User.vehicle_id == req.vehicle_id, User.id != user.id)
            )
            for dup in _dup.scalars().all():
                dup.vehicle_id = None
        user.vehicle_id = req.vehicle_id
    await db.commit()
    await db.refresh(user)
    return {
        "id":            str(user.id),
        "name":          user.name,
        "driver_status": user.driver_status,
        "vehicle_id":    user.vehicle_id,
    }


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 기사 계정 삭제 (연관 데이터 일괄 정리 후 삭제)"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(User.id == uuid_lib.UUID(user_id)))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if str(user.id) == str(current_user.id):
        raise HTTPException(400, "자기 자신은 삭제할 수 없습니다.")

    uid = user.id

    # 1. 메시지 삭제 (sender_id = uid)
    await db.execute(delete(Message).where(Message.sender_id == uid))
    # 2. 대화방에 속한 나머지 메시지 삭제 후 대화방 삭제
    conv_ids = (await db.execute(
        select(Conversation.id).where(
            or_(Conversation.driver_id == uid, Conversation.admin_id == uid)
        )
    )).scalars().all()
    if conv_ids:
        await db.execute(delete(Message).where(Message.conversation_id.in_(conv_ids)))
        await db.execute(delete(Conversation).where(Conversation.id.in_(conv_ids)))
    # 3. 배송 담당자 해제 (assigned_to nullable)
    await db.execute(update(Delivery).where(Delivery.assigned_to == uid).values(assigned_to=None))
    # 4. 운행 기록 삭제
    await db.execute(delete(Trip).where(Trip.driver_id == uid))
    # 5. GPS 로그 삭제
    await db.execute(delete(Location).where(Location.user_id == uid))
    # 6. 유저 삭제
    await db.delete(user)
    await db.commit()
