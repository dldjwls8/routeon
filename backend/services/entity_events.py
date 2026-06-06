from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from models import EntityEvent, User


def changed_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        key: {"before": before.get(key), "after": value}
        for key, value in after.items()
        if before.get(key) != value
    }


def record_entity_event(
    db: AsyncSession,
    *,
    organization_id: int,
    entity_type: str,
    entity_id: Any,
    actor: User,
    action: str,
    summary: str,
    changes: dict | None = None,
) -> EntityEvent:
    event = EntityEvent(
        organization_id=organization_id,
        entity_type=entity_type,
        entity_id=str(entity_id),
        actor_id=actor.id,
        actor_name=actor.name or actor.username,
        action=action,
        summary=summary,
        changes=changes or {},
    )
    db.add(event)
    return event


def entity_event_schema(event: EntityEvent) -> dict:
    return {
        "id": str(event.id),
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "actor_id": str(event.actor_id) if event.actor_id else None,
        "actor_name": event.actor_name,
        "action": event.action,
        "summary": event.summary,
        "changes": event.changes or {},
        "created_at": event.created_at.isoformat(),
    }
