from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import Customer, User
from auth import require_admin
from core.utils import normalize_phone

router = APIRouter()


class CustomerCreate(BaseModel):
    name:       str
    contact:    Optional[str]  = None
    phone:      Optional[str]  = None
    address:    Optional[str]  = None
    lat:        Optional[float] = None
    lon:        Optional[float] = None
    memo:       Optional[str]  = None
    temporary:  bool           = False
    valid_date: Optional[str]  = None   # YYYY-MM-DD


class CustomerUpdate(BaseModel):
    name:       Optional[str]  = None
    contact:    Optional[str]  = None
    phone:      Optional[str]  = None
    address:    Optional[str]  = None
    lat:        Optional[float] = None
    lon:        Optional[float] = None
    memo:       Optional[str]  = None
    temporary:  Optional[bool] = None
    valid_date: Optional[str]  = None


def _schema(c: Customer) -> dict:
    return {
        "id":         c.id,
        "name":       c.name,
        "contact":    c.contact,
        "phone":      c.phone,
        "address":    c.address,
        "lat":        c.lat,
        "lon":        c.lon,
        "memo":       c.memo,
        "temporary":  c.temporary,
        "valid_date": c.valid_date.isoformat() if c.valid_date else None,
        "created_at": c.created_at.isoformat(),
    }


def _parse_date(s: Optional[str]) -> Optional[date_type]:
    if not s:
        return None
    try:
        return date_type.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, "valid_date 형식: YYYY-MM-DD")


@router.get("/customers")
async def list_customers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _r = await db.execute(
        select(Customer)
        .where(Customer.organization_id == current_user.organization_id)
        .order_by(Customer.name)
    )
    return [_schema(c) for c in _r.scalars().all()]


@router.post("/customers", status_code=201)
async def create_customer(
    req: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    c = Customer(
        organization_id = current_user.organization_id,
        name            = req.name.strip(),
        contact         = req.contact,
        phone           = normalize_phone(req.phone),
        address         = req.address,
        lat             = req.lat,
        lon             = req.lon,
        memo            = req.memo,
        temporary       = req.temporary,
        valid_date      = _parse_date(req.valid_date),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _schema(c)


@router.patch("/customers/{customer_id}")
async def update_customer(
    customer_id: int,
    req: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _r = await db.execute(
        select(Customer).where(
            Customer.id == customer_id,
            Customer.organization_id == current_user.organization_id,
        )
    )
    c = _r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "고객을 찾을 수 없습니다.")

    if req.name     is not None: c.name     = req.name.strip()
    if req.contact  is not None: c.contact  = req.contact
    sent_fields = getattr(req, "model_fields_set", getattr(req, "__fields_set__", set()))
    if req.phone    is not None: c.phone    = normalize_phone(req.phone)
    if req.address  is not None: c.address  = req.address
    if "lat" in sent_fields: c.lat = req.lat
    if "lon" in sent_fields: c.lon = req.lon
    if req.memo     is not None: c.memo     = req.memo
    if req.temporary is not None: c.temporary = req.temporary
    if req.valid_date is not None:
        c.valid_date = _parse_date(req.valid_date)

    await db.commit()
    await db.refresh(c)
    return _schema(c)


@router.delete("/customers/{customer_id}", status_code=204)
async def delete_customer(
    customer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _r = await db.execute(
        select(Customer).where(
            Customer.id == customer_id,
            Customer.organization_id == current_user.organization_id,
        )
    )
    c = _r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "고객을 찾을 수 없습니다.")
    await db.delete(c)
    await db.commit()
