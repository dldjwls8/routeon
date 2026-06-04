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
    User, Delivery, Trip, Vehicle, RestStop, Location, Organization, AppSetting,
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
from core.utils import _haversine, _haversine_km, _coord_to_address, normalize_phone

router = APIRouter()

ORG_AUTO_APPROVE_KEY = "organization_auto_approve"


async def _org_auto_approve_enabled(db: AsyncSession) -> bool:
    setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == ORG_AUTO_APPROVE_KEY)
    )).scalar_one_or_none()
    return bool((setting.value or {}).get("enabled")) if setting else False

class OrgCreate(BaseModel):
    name:     str   # 기업명
    username: str
    password: str
    phone:    str
    email:    str   # 승인/반려 알림 수신 이메일

@router.post("/organizations", status_code=201)
async def create_organization(
    name:     str       = Form(...),
    username: str       = Form(...),
    password: str       = Form(...),
    phone:    str       = Form(...),
    email:    str       = Form(...),
    doc_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    기업 최초 등록 + 관리자 계정 동시 생성.
    - 사업자등록증 등 첨부파일 필수 (PDF, JPG, PNG, 10MB 이하)
    - 등록 후 status=pending_review → 슈퍼 관리자 승인 후 이용 가능
    """
    import random, string
    from datetime import datetime

    # 파일 확장자 확인
    ext = Path(doc_file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"허용된 파일 형식: PDF, JPG, PNG")

    # 파일 크기 확인
    contents = await doc_file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(400, "파일 크기는 10MB 이하여야 합니다.")

    # 아이디 중복 확인
    _r = await db.execute(select(User).where(User.username == username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {username}")

    # 조직코드 생성
    while True:
        org_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        _o = await db.execute(select(Organization).where(Organization.org_code == org_code))
        if not _o.scalar_one_or_none():
            break

    auto_approve = await _org_auto_approve_enabled(db)

    # 기업 생성
    org = Organization(
        name   = name,
        org_code = org_code,
        status = OrgStatus.approved if auto_approve else OrgStatus.pending_review,
        reviewed_at = datetime.utcnow() if auto_approve else None,
    )
    db.add(org)
    await db.flush()  # org.id 확보

    # 파일 저장
    org_upload_dir = UPLOAD_DIR / str(org.id)
    org_upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{org.id}{ext}"
    file_path = org_upload_dir / safe_filename
    with open(file_path, "wb") as f:
        f.write(contents)

    org.doc_filename = doc_file.filename
    org.doc_path     = str(file_path)

    # 관리자 계정 생성
    admin = User(
        username        = username,
        password_hash   = hash_password(password),
        role            = UserRole.admin,
        phone           = normalize_phone(phone),
        email           = email,
        organization_id = org.id,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(org)
    await db.refresh(admin)

    if auto_approve and admin.email:
        asyncio.create_task(send_approved(admin.email, org.name, org.org_code))

    return {
        "org_id":           org.id,
        "org_name":         org.name,
        "org_code":         org.org_code,
        "status":           org.status,
        "admin_id":         str(admin.id),
        "admin_username":   admin.username,
        "message":          "기업 등록 완료. 자동 승인되었습니다." if auto_approve else "기업 등록 완료. 서류 심사 후 이용 가능합니다.",
    }


# ── 슈퍼 관리자 전용 ──────────────────────────────

@router.get("/superadmin/organizations")
async def list_organizations(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 전체 기업 목록 조회. ?status=pending_review|approved|rejected"""
    stmt = select(Organization)
    if status:
        try:
            stmt = stmt.where(Organization.status == OrgStatus(status))
        except ValueError:
            raise HTTPException(400, "status 값이 올바르지 않습니다.")
    stmt = stmt.order_by(Organization.created_at.desc())
    _r = await db.execute(stmt)
    orgs = _r.scalars().all()
    return [
        {
            "id":           o.id,
            "name":         o.name,
            "org_code":     o.org_code,
            "status":       o.status,
            "doc_filename": o.doc_filename,
            "reject_reason":o.reject_reason,
            "reviewed_at":  o.reviewed_at.isoformat() if o.reviewed_at else None,
            "created_at":   o.created_at.isoformat(),
        }
        for o in orgs
    ]


class SuperAdminSettings(BaseModel):
    organization_auto_approve: bool


@router.get("/superadmin/settings")
async def get_superadmin_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 루트온 전역 운영 설정 조회"""
    return {"organization_auto_approve": await _org_auto_approve_enabled(db)}


@router.patch("/superadmin/settings")
async def update_superadmin_settings(
    req: SuperAdminSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 가입 신청 자동 승인 on/off"""
    setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == ORG_AUTO_APPROVE_KEY)
    )).scalar_one_or_none()
    value = {"enabled": bool(req.organization_auto_approve)}
    if setting:
        setting.value = value
        setting.updated_at = datetime.utcnow()
    else:
        db.add(AppSetting(key=ORG_AUTO_APPROVE_KEY, value=value))
    await db.commit()
    return {"organization_auto_approve": value["enabled"]}


@router.get("/superadmin/organizations/{org_id}/doc")
async def download_org_doc(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 첨부 서류 다운로드"""
    _r = await db.execute(select(Organization).where(Organization.id == org_id))
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    if not org.doc_path or not Path(org.doc_path).exists():
        raise HTTPException(404, "첨부 파일이 없습니다.")
    return FileResponse(
        path     = org.doc_path,
        filename = org.doc_filename or "document",
    )


@router.post("/superadmin/organizations/{org_id}/approve")
async def approve_organization(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 승인"""
    from datetime import datetime
    _r = await db.execute(select(Organization).where(Organization.id == org_id))
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    if org.status == OrgStatus.approved:
        raise HTTPException(400, "이미 승인된 기업입니다.")

    org.status      = OrgStatus.approved
    org.reviewed_at = datetime.utcnow()
    await db.commit()

    # 관리자 이메일로 승인 알림 발송
    _u = await db.execute(
        select(User).where(
            User.organization_id == org.id,
            User.role == UserRole.admin,
        )
    )
    admin = _u.scalars().first()
    if admin and admin.email:
        import asyncio
        asyncio.create_task(send_approved(admin.email, org.name, org.org_code))

    return {"org_id": org.id, "org_name": org.name, "status": org.status}


class RejectRequest(BaseModel):
    reason: str

@router.post("/superadmin/organizations/{org_id}/reject")
async def reject_organization(
    org_id: int,
    req: RejectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 반려 + 사유 저장"""
    from datetime import datetime
    _r = await db.execute(select(Organization).where(Organization.id == org_id))
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")

    org.status        = OrgStatus.rejected
    org.reject_reason = req.reason
    org.reviewed_at   = datetime.utcnow()
    await db.commit()

    # 관리자 이메일로 반려 알림 발송
    _u = await db.execute(
        select(User).where(
            User.organization_id == org.id,
            User.role == UserRole.admin,
        )
    )
    admin = _u.scalars().first()
    if admin and admin.email:
        import asyncio
        asyncio.create_task(send_rejected(admin.email, org.name, req.reason))

    return {"org_id": org.id, "org_name": org.name, "status": org.status, "reason": org.reject_reason}


class SuperAdminCreate(BaseModel):
    username: str
    password: str
    phone:    str = ""

@router.post("/superadmin/create-account", status_code=201)
async def create_superadmin_account(
    req: SuperAdminCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 새 슈퍼어드민 계정 생성"""
    _r = await db.execute(select(User).where(User.username == req.username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")

    user = User(
        username      = req.username,
        password_hash = hash_password(req.password),
        role          = UserRole.superadmin,
        phone         = normalize_phone(req.phone),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": str(user.id), "username": user.username, "role": user.role}




@router.get("/organizations/me")
async def get_my_organization(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 내 기업 정보 + 조직코드 조회"""
    if not current_user.organization_id:
        raise HTTPException(404, "소속 기업이 없습니다.")
    _r = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    return {
        "id":                   org.id,
        "name":                 org.name,
        "org_code":             org.org_code,
        "auto_approve_drivers": org.auto_approve_drivers,
    }


@router.patch("/organizations/me/settings")
async def update_org_settings(
    req: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 기업 운영 설정 변경 (현재: 기사 자동승인 on/off)"""
    if not current_user.organization_id:
        raise HTTPException(404, "소속 기업이 없습니다.")
    _r = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")

    if "auto_approve_drivers" in req:
        org.auto_approve_drivers = bool(req["auto_approve_drivers"])

    await db.commit()
    return {"auto_approve_drivers": org.auto_approve_drivers}


@router.post("/organizations/regen-code")
async def regen_org_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 조직코드 재발급"""
    import random, string

    if not current_user.organization_id:
        raise HTTPException(404, "소속 기업이 없습니다.")
    _r = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = _r.scalar_one_or_none()

    while True:
        new_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        _o = await db.execute(select(Organization).where(Organization.org_code == new_code))
        if not _o.scalar_one_or_none():
            break

    org.org_code = new_code
    await db.commit()
    return {"org_code": org.org_code}


@router.get("/organizations/lookup")
async def lookup_organization(
    org_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    조직코드로 기업 정보 조회 (인증 불필요).
    기사 앱 가입 화면에서 코드 입력 시 기업명 미리 표시할 때 사용.

    예시: GET /organizations/lookup?org_code=RT-ABC123
    """
    _r = await db.execute(
        select(Organization).where(Organization.org_code == org_code)
    )
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "존재하지 않는 조직코드입니다.")
    return {
        "org_id":   org.id,
        "org_name": org.name,
        "org_code": org.org_code,
    }
