"""
RouteOn — JWT 인증 모듈 (비동기)
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import User, UserRole

JWT_SECRET       = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM    = "HS256"
JWT_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer()


# ────────────────────────────────────────────────
# 비밀번호
# ────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ────────────────────────────────────────────────
# JWT
# ────────────────────────────────────────────────
def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub":  user_id,
        "role": role,
        "exp":  datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰이 유효하지 않거나 만료되었습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ────────────────────────────────────────────────
# 의존성 — 현재 로그인 유저 추출 (비동기)
# ────────────────────────────────────────────────
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    result  = await db.execute(select(User).where(User.id == payload["sub"]))
    user    = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="유저를 찾을 수 없습니다.")
    if user.role == UserRole.pending:
        raise HTTPException(status_code=403, detail="관리자 승인 대기 중입니다. 승인 후 이용 가능합니다.")

    # 기업 심사 상태 확인 (superadmin 제외)
    if user.role != UserRole.superadmin and user.organization_id:
        from models import Organization, OrgStatus
        from sqlalchemy import select as sa_select
        _o = await db.execute(
            sa_select(Organization).where(Organization.id == user.organization_id)
        )
        org = _o.scalar_one_or_none()
        if org:
            if org.status == OrgStatus.pending_review:
                raise HTTPException(status_code=403, detail="기업 서류 심사 중입니다. 승인 후 이용 가능합니다.")
            if org.status == OrgStatus.rejected:
                reason = org.reject_reason or "사유 없음"
                raise HTTPException(status_code=403, detail=f"기업 등록이 반려됐습니다. 사유: {reason}")
    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.admin, UserRole.superadmin):
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return current_user


async def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.superadmin:
        raise HTTPException(status_code=403, detail="슈퍼 관리자 권한이 필요합니다.")
    return current_user


async def require_driver(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in (UserRole.driver, UserRole.admin, UserRole.superadmin):
        raise HTTPException(status_code=403, detail="권한이 없습니다.")
    return current_user