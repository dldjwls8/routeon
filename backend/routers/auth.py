import uuid as uuid_lib
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, update, delete
from pydantic import BaseModel

from database import get_db
from models import (
    User, Organization, Delivery, Trip, Vehicle, Location,
    Conversation, Message,
    AccountStatus, OrgStatus, TripStatus, UserRole,
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, require_admin,
)
from core.utils import normalize_phone
from services.entity_events import changed_fields, record_entity_event

ADMIN_PERMISSION_KEYS = {"dashboard", "control", "dispatch", "customers", "schedule", "basic"}
PROFILE_DIR = Path("/app/uploads/profiles")
PROFILE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

router = APIRouter()

class RegisterRequest(BaseModel):
    username: str
    password: str
    phone:    str
    org_code: str              # 기사/관리자 추가 가입 시 조직코드 입력
    name:     str
    email: Optional[str] = None
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
    기사 또는 일반 관리자 가입 신청.
    - org_code로 소속 기업 확인 후 가입
    - role=driver → 기업 설정에 따라 자동 승인 또는 승인 대기
    - role=admin  → 기업 설정에 따라 자동 승인 또는 최상위 기업관리자 승인 대기
    """
    if req.role not in {"driver", "admin"}:
        raise HTTPException(400, "가입 유형은 기사 또는 관리자여야 합니다.")
    if not req.phone:
        raise HTTPException(400, "전화번호는 필수입니다.")
    if not req.org_code:
        raise HTTPException(400, "조직 코드는 필수입니다.")
    if len(req.password) < 4:
        raise HTTPException(400, "비밀번호는 4자 이상이어야 합니다.")

    # 조직코드로 기업 조회
    _o = await db.execute(
        select(Organization).where(Organization.org_code == req.org_code)
    )
    org = _o.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "올바르지 않은 조직 코드입니다.")
    if org.status != OrgStatus.approved:
        raise HTTPException(403, "승인된 기업에만 가입을 신청할 수 있습니다.")

    # 아이디 중복 확인
    _r = await db.execute(select(User).where(User.username == req.username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")

    actual_role = UserRole.admin if req.role == "admin" else UserRole.driver
    account_status = (
        AccountStatus.approved
        if (
            (req.role == "driver" and org.auto_approve_drivers)
            or (req.role == "admin" and org.auto_approve_admins)
        )
        else AccountStatus.pending
    )

    user = User(
        username        = req.username,
        password_hash   = hash_password(req.password),
        role            = actual_role,
        account_status  = account_status,
        name            = req.name,
        email           = req.email.strip() if req.email else None,
        phone           = normalize_phone(req.phone),
        organization_id = org.id,
        is_org_owner    = False,
        permissions     = {},
    )
    if actual_role == UserRole.admin and account_status == AccountStatus.approved:
        user.permissions = {key: True for key in sorted(ADMIN_PERMISSION_KEYS)}
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id":         str(user.id),
        "username":   user.username,
        "name":       user.name,
        "role":       user.role,
        "account_status": user.account_status,
        "org_name":   org.name,
        "created_at": user.created_at,
    }


@router.post("/auth/approve/{user_id}")
async def approve_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """기업 관리자: 같은 기업의 가입 신청 승인."""
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
    if user.account_status != AccountStatus.pending:
        raise HTTPException(400, "승인 대기 중인 계정이 아닙니다.")
    if user.role == UserRole.admin and not current_user.is_org_owner:
        raise HTTPException(403, "최상위 기업관리자만 관리자 가입을 승인할 수 있습니다.")

    user.account_status = AccountStatus.approved
    if user.role == UserRole.admin:
        user.permissions = {key: True for key in sorted(ADMIN_PERMISSION_KEYS)}
        record_entity_event(
            db,
            organization_id=current_user.organization_id,
            entity_type="staff",
            entity_id=user.id,
            actor=current_user,
            action="approved",
            summary=f"관리자 '{user.name or user.username}' 가입 승인",
        )
    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "username": user.username,
        "role": user.role,
        "account_status": user.account_status,
    }


@router.post("/auth/reject/{user_id}")
async def reject_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """기업 관리자: 같은 기업의 가입 신청 반려."""
    user = (await db.execute(select(User).where(
        User.id == uuid_lib.UUID(user_id),
        User.organization_id == current_user.organization_id,
    ))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if user.account_status != AccountStatus.pending:
        raise HTTPException(400, "승인 대기 중인 계정이 아닙니다.")
    if user.role == UserRole.admin and not current_user.is_org_owner:
        raise HTTPException(403, "최상위 기업관리자만 관리자 가입을 반려할 수 있습니다.")

    user.account_status = AccountStatus.rejected
    if user.role == UserRole.admin:
        record_entity_event(
            db,
            organization_id=current_user.organization_id,
            entity_type="staff",
            entity_id=user.id,
            actor=current_user,
            action="rejected",
            summary=f"관리자 '{user.name or user.username}' 가입 반려",
        )
    await db.commit()
    return {
        "id": str(user.id),
        "username": user.username,
        "role": user.role,
        "account_status": user.account_status,
    }


@router.post("/auth/reissue-org-code")
async def reissue_org_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """최상위 기업관리자: 조직코드 재발급 (레거시 호환 경로)."""
    import random, string
    if not current_user.organization_id:
        raise HTTPException(400, "소속 조직이 없습니다.")
    if not current_user.is_org_owner:
        raise HTTPException(403, "최상위 기업관리자만 조직코드를 재발급할 수 있습니다.")
    org = (await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "소속 조직을 찾을 수 없습니다.")
    while True:
        new_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        existing = await db.execute(select(Organization).where(Organization.org_code == new_code))
        if not existing.scalar_one_or_none():
            break
    old_code = org.org_code
    org.org_code = new_code
    record_entity_event(
        db,
        organization_id=org.id,
        entity_type="organization",
        entity_id=org.id,
        actor=current_user,
        action="org_code_regenerated",
        summary="기업 조직코드 재발급",
        changes={"org_code": {"before": old_code, "after": new_code}},
    )
    await db.commit()
    return {"org_code": new_code}


@router.post("/auth/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """로그인 → JWT 액세스 토큰 발급"""
    _r = await db.execute(select(User).where(User.username == req.username))
    user = _r.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")
    if user.account_status == AccountStatus.pending:
        raise HTTPException(403, "가입 승인 대기 중입니다. 최상위 기업관리자의 승인 후 로그인할 수 있습니다.")
    if user.account_status == AccountStatus.rejected:
        raise HTTPException(403, "가입 신청이 반려된 계정입니다.")

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
        "profile_image": current_user.profile_image,
        "org_code": org_code,
        "is_org_owner": current_user.is_org_owner,
        "permissions": current_user.permissions or {},
        "account_status": current_user.account_status,
    }



class UpdateMeRequest(BaseModel):
    phone:            Optional[str] = None
    current_password: Optional[str] = None
    new_password:     Optional[str] = None


class DeleteMeRequest(BaseModel):
    current_password: str


async def _delete_user_relations(db: AsyncSession, user: User) -> None:
    uid = user.id
    await db.execute(delete(Message).where(Message.sender_id == uid))
    conv_ids = (await db.execute(
        select(Conversation.id).where(or_(Conversation.driver_id == uid, Conversation.admin_id == uid))
    )).scalars().all()
    if conv_ids:
        await db.execute(delete(Message).where(Message.conversation_id.in_(conv_ids)))
        await db.execute(delete(Conversation).where(Conversation.id.in_(conv_ids)))
    trip_ids = (await db.execute(select(Trip.id).where(Trip.driver_id == uid))).scalars().all()
    await db.execute(update(Delivery).where(Delivery.assigned_to == uid).values(assigned_to=None))
    if trip_ids:
        await db.execute(update(Delivery).where(Delivery.trip_id.in_(trip_ids)).values(trip_id=None))
        await db.execute(delete(Trip).where(Trip.id.in_(trip_ids)))
    await db.execute(delete(Location).where(Location.user_id == uid))


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
        "profile_image": current_user.profile_image,
    }


@router.post("/auth/me/profile-image")
async def upload_profile_image(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in PROFILE_EXTENSIONS:
        raise HTTPException(400, "JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.")
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(400, "지원하지 않는 이미지 형식입니다.")
    content = await file.read()
    if not content:
        raise HTTPException(400, "빈 파일은 업로드할 수 없습니다.")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "프로필 이미지는 5MB 이하여야 합니다.")
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    old_path = current_user.profile_image
    filename = f"{current_user.id.hex}{suffix}"
    target = PROFILE_DIR / filename
    target.write_bytes(content)
    current_user.profile_image = f"/uploads/profiles/{filename}"
    if old_path and old_path != current_user.profile_image:
        old_file = Path("/app") / old_path.lstrip("/")
        if old_file.is_file():
            old_file.unlink()
    await db.commit()
    return {"profile_image": current_user.profile_image}


@router.delete("/auth/me/profile-image", status_code=204)
async def delete_profile_image(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.profile_image:
        target = Path("/app") / current_user.profile_image.lstrip("/")
        if target.is_file():
            target.unlink()
    current_user.profile_image = None
    await db.commit()
    return Response(status_code=204)


@router.delete("/auth/me", status_code=204)
async def delete_me(
    req: DeleteMeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.is_org_owner:
        raise HTTPException(400, "최상위 기업관리자는 담당자에게 권한을 이전한 뒤 탈퇴할 수 있습니다.")
    if not verify_password(req.current_password, current_user.password_hash):
        raise HTTPException(401, "현재 비밀번호가 올바르지 않습니다.")
    if current_user.role == UserRole.driver:
        active_trip = (await db.execute(select(Trip.id).where(
            Trip.driver_id == current_user.id,
            Trip.status.in_((TripStatus.scheduled, TripStatus.in_progress)),
        ).limit(1))).scalar_one_or_none()
        if active_trip:
            raise HTTPException(409, "대기 또는 운행 중인 배차가 있어 탈퇴할 수 없습니다.")
    await _delete_user_relations(db, current_user)
    if current_user.profile_image:
        target = Path("/app") / current_user.profile_image.lstrip("/")
        if target.is_file():
            target.unlink()
    await db.delete(current_user)
    await db.commit()
    return Response(status_code=204)


@router.get("/users")
async def get_users(
    role: Optional[str] = None,
    account_status: Optional[str] = None,
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
    if account_status:
        try:
            stmt = stmt.where(User.account_status == AccountStatus(account_status))
        except ValueError:
            raise HTTPException(400, f"올바르지 않은 account_status 값: {account_status}")
    stmt = stmt.order_by(User.created_at.desc())
    _r = await db.execute(stmt)
    users = _r.scalars().all()

    # 기사별 마지막 GPS 위치 (차량 위치와 별개로 본인의 최근 location 기록)
    driver_ids = [u.id for u in users if u.role == UserRole.driver]
    last_gps_by_user = {}
    if driver_ids:
        _rl = await db.execute(
            select(Location)
            .where(Location.user_id.in_(driver_ids))
            .order_by(Location.user_id, Location.recorded_at.desc())
        )
        for loc in _rl.scalars().all():
            if loc.user_id not in last_gps_by_user:
                last_gps_by_user[loc.user_id] = {
                    "lat": loc.lat,
                    "lon": loc.lon,
                    "recorded_at": loc.recorded_at.isoformat() if loc.recorded_at else None,
                }

    # 배정 차량 이름 조회
    vehicle_ids = [u.vehicle_id for u in users if u.vehicle_id]
    vehicle_name_by_id = {}
    if vehicle_ids:
        from models import Vehicle
        _rv = await db.execute(
            select(Vehicle).where(Vehicle.id.in_(vehicle_ids))
        )
        for v in _rv.scalars().all():
            vehicle_name_by_id[v.id] = v.plate_number or v.vehicle_type or str(v.id)

    return [
        {
            "id":            str(u.id),
            "username":      u.username,
            "name":          u.name,
            "role":          u.role,
            "phone":         u.phone,
            "org_code":      None,
            "vehicle_id":    u.vehicle_id,
            "vehicle_name":  vehicle_name_by_id.get(u.vehicle_id) if u.vehicle_id else None,
            "driver_status": u.driver_status,
            "created_at":    u.created_at.isoformat(),
            "is_org_owner":  u.is_org_owner,
            "permissions":   u.permissions or {},
            "account_status": u.account_status,
            "last_gps":      last_gps_by_user.get(u.id),
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
    active_trip = None
    if user.role == UserRole.driver:
        active_trip = (await db.execute(select(Trip.id).where(
            Trip.driver_id == user.id,
            Trip.status == TripStatus.in_progress,
        ).limit(1))).scalar_one_or_none()
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
        if user.role != UserRole.driver:
            raise HTTPException(400, "기사 계정만 운행 상태를 변경할 수 있습니다.")
        if user.driver_status == "운행중" or active_trip:
            raise HTTPException(409, "운행 중인 기사의 상태는 수동으로 변경할 수 없습니다.")
        if req.driver_status not in {"운행가능", "휴무"}:
            raise HTTPException(400, "기사 상태는 운행가능 또는 휴무로만 변경할 수 있습니다.")
        user.driver_status = req.driver_status
    if 'vehicle_id' in req.model_fields_set:
        if active_trip:
            raise HTTPException(409, "운행 중인 기사의 배정 차량은 변경할 수 없습니다.")
        if req.vehicle_id is not None:
            _vc = await db.execute(select(Vehicle).where(
                Vehicle.id == req.vehicle_id,
                Vehicle.organization_id == current_user.organization_id,
            ))
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
    _r = await db.execute(select(User).where(
        User.id == uuid_lib.UUID(user_id),
        User.organization_id == current_user.organization_id,
    ))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if str(user.id) == str(current_user.id):
        raise HTTPException(400, "자기 자신은 삭제할 수 없습니다.")
    if user.is_org_owner:
        raise HTTPException(400, "최상위 관리자 계정은 삭제할 수 없습니다.")
    if user.role == UserRole.admin and not current_user.is_org_owner:
        raise HTTPException(403, "최상위 관리자만 담당자를 삭제할 수 있습니다.")
    if user.role == UserRole.driver:
        active_trip = (await db.execute(select(Trip.id).where(
            Trip.driver_id == user.id,
            Trip.status == TripStatus.in_progress,
        ).limit(1))).scalar_one_or_none()
        if active_trip:
            raise HTTPException(409, "운행 중인 기사는 삭제할 수 없습니다.")

    record_entity_event(
        db,
        organization_id=current_user.organization_id,
        entity_type="staff" if user.role == UserRole.admin else "driver",
        entity_id=user.id,
        actor=current_user,
        action="deleted",
        summary=f"{'담당자' if user.role == UserRole.admin else '기사'} '{user.name or user.username}' 삭제",
    )

    await _delete_user_relations(db, user)
    await db.delete(user)
    await db.commit()
