from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin
from database import get_db
from models import EntityEvent, User
from services.entity_events import entity_event_schema

router = APIRouter()


@router.get("/entity-events")
async def list_entity_events(
    entity_type: str = Query(..., min_length=1, max_length=30),
    entity_id: str = Query(..., min_length=1, max_length=80),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(EntityEvent)
        .where(
            EntityEvent.organization_id == current_user.organization_id,
            EntityEvent.entity_type == entity_type,
            EntityEvent.entity_id == entity_id,
        )
        .order_by(EntityEvent.created_at.desc())
        .limit(100)
    )
    return [entity_event_schema(event) for event in result.scalars().all()]
