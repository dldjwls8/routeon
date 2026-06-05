from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from models import OrderEvent, User


def _uuid_or_none(value: Any):
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _actor_role(actor: Optional[User]) -> Optional[str]:
    if not actor:
        return None
    role = getattr(actor, "role", None)
    return getattr(role, "value", role)


def _actor_name(actor: Optional[User]) -> Optional[str]:
    if not actor:
        return None
    return actor.name or actor.username or str(actor.id)


def record_order_event(
    db: AsyncSession,
    *,
    organization_id: Optional[int],
    event_type: str,
    summary: str,
    delivery_id: Any = None,
    trip_id: Any = None,
    actor: Optional[User] = None,
    actor_id: Any = None,
    actor_role: Optional[str] = None,
    actor_name: Optional[str] = None,
    details: Optional[dict] = None,
) -> OrderEvent:
    event = OrderEvent(
        organization_id=organization_id,
        delivery_id=_uuid_or_none(delivery_id),
        trip_id=_uuid_or_none(trip_id),
        actor_id=_uuid_or_none(actor_id) or (actor.id if actor else None),
        actor_role=actor_role or _actor_role(actor),
        actor_name=actor_name or _actor_name(actor),
        event_type=event_type,
        summary=summary,
        details=details or {},
    )
    db.add(event)
    return event


def order_event_schema(event: OrderEvent) -> dict:
    return {
        "id": str(event.id),
        "organization_id": event.organization_id,
        "delivery_id": str(event.delivery_id) if event.delivery_id else None,
        "trip_id": str(event.trip_id) if event.trip_id else None,
        "actor_id": str(event.actor_id) if event.actor_id else None,
        "actor_role": event.actor_role,
        "actor_name": event.actor_name,
        "event_type": event.event_type,
        "summary": event.summary,
        "details": event.details or {},
        "created_at": event.created_at.isoformat(),
    }
