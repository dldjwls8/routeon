import uuid as uuid_lib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, update, delete
from pydantic import BaseModel

from database import get_db
from models import (
    User, Organization, Delivery, Trip, Vehicle, Location,
    Conversation, Message,
    UserRole,
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, require_admin,
)
from core.utils import normalize_phone
from services.entity_events import changed_fields, record_entity_event

ADMIN_PERMISSION_KEYS = {"dashboard", "control", "dispatch", "customers", "schedule", "basic"}

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
    if req.role != "driver":
        raise HTTPException(403, "담당자 계정은 최상위 관리자가 담당자 화면에서 추가해야 합니다.")
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

    if org.auto_approve_drivers:
        actual_role = UserRole.driver
    else:
        actual_role = UserRole.pending

    user = User(
        username        = req.username,
        password_hash   = hash_password(req.password),
        role            = actual_role,
        name            = req.name,
        phone           = normalize_phone(req.phone),
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


class AdminCreateRequest(BaseModel):
    username: str
    password: str
    phone: str
    name: str


@router.post("/users/admin", status_code=201)
async def create_admin(
    req: AdminCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not current_user.is_org_owner:
        raise HTTPException(403, "최상위 관리자만 담당자를 추가할 수 있습니다.")
    if len(req.password) < 4:
        raise HTTPException(400, "비밀번호는 4자 이상이어야 합니다.")
    exists = await db.execute(select(User).where(User.username == req.username.strip()))
    if exists.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")
    user = User(
        username=req.username.strip(),
        password_hash=hash_password(req.password),
        role=UserRole.admin,
        name=req.name.strip(),
        phone=normalize_phone(req.phone),
        organization_id=current_user.organization_id,
        is_org_owner=False,
        permissions={key: True for key in sorted(ADMIN_PERMISSION_KEYS)},
    )
    db.add(user)
    await db.flush()
    record_entity_event(
        db,
        organization_id=current_user.organization_id,
        entity_type="staff",
        entity_id=user.id,
        actor=current_user,
        action="created",
        summary=f"담당자 '{user.name or user.username}' 추가",
    )
    await db.commit()
    await db.refresh(user)
    return {
        "id": str(user.id),
        "username": user.username,
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "is_org_owner": user.is_org_owner,
        "permissions": user.permissions,
        "created_at": user.created_at.isoformat(),
    }


@router.post("/auth/approve/{user_id}")
async def approve_driver(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: pending 기사를 승인하여 driver로 변경 (같은 기업만)"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(
        User.id == uuid_lib.UUID(user_id),
        User.organization_id == current_user.organization_id,
    ))
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
        "is_org_owner": current_user.is_org_owner,
        "permissions": current_user.permissions or {},
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

    before_phone = current_user.phone
    password_changed = False
    # 비밀번호 변경
    if req.new_password:
        if not req.current_password:
            raise HTTPException(400, "비밀번호 변경 시 현재 비밀번호가 필요합니다.")
        if not verify_password(req.current_password, current_user.password_hash):
            raise HTTPException(401, "현재 비밀번호가 올바르지 않습니다.")
        if len(req.new_password) < 4:
            raise HTTPException(400, "새 비밀번호는 4자 이상이어야 합니다.")
        current_user.password_hash = hash_password(req.new_password)
        password_changed = True

    # 전화번호 변경
    if req.phone:
        current_user.phone = normalize_phone(req.phone)

    changes = {}
    if before_phone != current_user.phone:
        changes["phone"] = {"before": before_phone, "after": current_user.phone}
    if password_changed:
        changes["password"] = {"before": None, "after": "changed"}
    if changes and current_user.organization_id:
        record_entity_event(
            db,
            organization_id=current_user.organization_id,
            entity_type="staff" if current_user.role == UserRole.admin else "driver",
            entity_id=current_user.id,
            actor=current_user,
            action="updated",
            summary="관리자 계정 정보 수정" if current_user.role == UserRole.admin else "기사 계정 정보 수정",
            changes=changes,
        )
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
            "is_org_owner":  u.is_org_owner,
            "permissions":   u.permissions or {},
        }
        for u in users
    ]


class UserUpdate(BaseModel):
    name:          Optional[str] = None
    phone:         Optional[str] = None
    driver_status: Optional[str] = None
    vehicle_id:    Optional[int] = None
    permissions:   Optional[dict[str, bool]] = None


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    req: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 기사 정보 수정 (상태, 배정 차량 등)"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(
        User.id == uuid_lib.UUID(user_id),
        User.organization_id == current_user.organization_id,
    ))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    before = {
        "name": user.name,
        "phone": user.phone,
        "driver_status": user.driver_status,
        "vehicle_id": user.vehicle_id,
        "permissions": user.permissions or {},
    }
    if req.permissions is not None:
        if not current_user.is_org_owner:
            raise HTTPException(403, "최상위 관리자만 담당자 권한을 수정할 수 있습니다.")
        if user.role != UserRole.admin or user.is_org_owner:
            raise HTTPException(400, "최상위 관리자 권한은 변경할 수 없습니다.")
        unknown = set(req.permissions) - ADMIN_PERMISSION_KEYS
        if unknown:
            raise HTTPException(400, f"지원하지 않는 권한: {', '.join(sorted(unknown))}")
        user.permissions = {
            key: bool(req.permissions.get(key, False))
            for key in sorted(ADMIN_PERMISSION_KEYS)
        }
    if req.name is not None:
        user.name = req.name
    if req.phone is not None:
        user.phone = normalize_phone(req.phone)
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
    after = {
        "name": user.name,
        "phone": user.phone,
        "driver_status": user.driver_status,
        "vehicle_id": user.vehicle_id,
        "permissions": user.permissions or {},
    }
    changes = changed_fields(before, after)
    if changes:
        record_entity_event(
            db,
            organization_id=current_user.organization_id,
            entity_type="staff" if user.role == UserRole.admin else "driver",
            entity_id=user.id,
            actor=current_user,
            action="updated",
            summary=f"{'담당자' if user.role == UserRole.admin else '기사'} '{user.name or user.username}' 정보 수정",
            changes=changes,
        )
    await db.commit()
    await db.refresh(user)
    return {
        "id":            str(user.id),
        "name":          user.name,
        "driver_status": user.driver_status,
        "vehicle_id":    user.vehicle_id,
        "permissions":   user.permissions or {},
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
    if user.is_org_owner:
        raise HTTPException(400, "최상위 관리자 계정은 삭제할 수 없습니다.")
    if user.role == UserRole.admin and not current_user.is_org_owner:
        raise HTTPException(403, "최상위 관리자만 담당자를 삭제할 수 있습니다.")

    uid = user.id
    record_entity_event(
        db,
        organization_id=current_user.organization_id,
        entity_type="staff" if user.role == UserRole.admin else "driver",
        entity_id=user.id,
        actor=current_user,
        action="deleted",
        summary=f"{'담당자' if user.role == UserRole.admin else '기사'} '{user.name or user.username}' 삭제",
    )

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
