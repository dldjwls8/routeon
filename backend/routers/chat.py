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

class ConversationCreate(BaseModel):
    partner_id: str

class MessageCreate(BaseModel):
    content: str

class ReadConversationRequest(BaseModel):
    last_read_message_id: Optional[str] = None


def _as_uuid(value: str, label: str = "id") -> uuid_lib.UUID:
    try:
        return uuid_lib.UUID(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"올바르지 않은 {label}입니다.")


def _conversation_schema(
    conversation: Conversation,
    current_user: User,
    unread_count: int = 0,
    last_message: "Message | None" = None,
) -> dict:
    partner_id = conversation.driver_id if current_user.id == conversation.admin_id else conversation.admin_id
    partner_role = UserRole.driver if current_user.id == conversation.admin_id else UserRole.admin
    partner_attr = "driver" if current_user.id == conversation.admin_id else "admin"
    partner = conversation.__dict__.get(partner_attr)
    return {
        "id": str(conversation.id),
        "organization_id": conversation.organization_id,
        "admin_id": str(conversation.admin_id),
        "driver_id": str(conversation.driver_id),
        "partner": {
            "id":       str(partner_id),
            "username": getattr(partner, "username", None),
            "name":     getattr(partner, "name", None),
            "role":     partner_role.value,
        },
        "unread_count": unread_count,
        "last_message": _message_schema(last_message) if last_message else None,
        "admin_last_read_at": conversation.admin_last_read_at.isoformat() if conversation.admin_last_read_at else None,
        "driver_last_read_at": conversation.driver_last_read_at.isoformat() if conversation.driver_last_read_at else None,
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
    }


def _message_schema(message: Message) -> dict:
    return {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "sender_id": str(message.sender_id),
        "content": message.content,
        "created_at": message.created_at.isoformat(),
    }


async def _get_user_by_id(db: AsyncSession, user_id: str) -> User:
    user_uuid = _as_uuid(user_id, "user_id")
    _r = await db.execute(select(User).where(User.id == user_uuid))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    return user


async def _assert_chat_pair(current_user: User, partner: User) -> None:
    if current_user.role not in (UserRole.admin, UserRole.driver):
        raise HTTPException(403, "채팅은 관리자와 기사만 사용할 수 있습니다.")
    if partner.role not in (UserRole.admin, UserRole.driver):
        raise HTTPException(403, "채팅 가능한 상대가 아닙니다.")
    if current_user.role == partner.role:
        raise HTTPException(403, "관리자와 기사 간 1:1 채팅만 가능합니다.")
    if not current_user.organization_id or current_user.organization_id != partner.organization_id:
        raise HTTPException(403, "같은 조직 사용자와만 채팅할 수 있습니다.")


async def _get_accessible_conversation(
    db: AsyncSession,
    conversation_id: str,
    current_user: User,
) -> Conversation:
    conversation_uuid = _as_uuid(conversation_id, "conversation_id")
    _r = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.admin), selectinload(Conversation.driver))
        .where(
            Conversation.id == conversation_uuid,
            Conversation.organization_id == current_user.organization_id,
            or_(
                Conversation.admin_id == current_user.id,
                Conversation.driver_id == current_user.id,
            ),
        )
    )
    conversation = _r.scalar_one_or_none()
    if not conversation:
        raise HTTPException(404, "대화방을 찾을 수 없습니다.")
    return conversation


async def _get_or_create_conversation(
    db: AsyncSession,
    current_user: User,
    partner: User,
) -> Conversation:
    await _assert_chat_pair(current_user, partner)
    admin = current_user if current_user.role == UserRole.admin else partner
    driver = current_user if current_user.role == UserRole.driver else partner

    _r = await db.execute(
        select(Conversation).where(
            Conversation.organization_id == current_user.organization_id,
            Conversation.admin_id == admin.id,
            Conversation.driver_id == driver.id,
        )
    )
    conversation = _r.scalar_one_or_none()
    if conversation:
        return conversation

    conversation = Conversation(
        organization_id=current_user.organization_id,
        admin_id=admin.id,
        driver_id=driver.id,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def _count_unread_messages(
    db: AsyncSession,
    conversation: Conversation,
    current_user: User,
) -> int:
    last_read_at = (
        conversation.admin_last_read_at
        if current_user.id == conversation.admin_id
        else conversation.driver_last_read_at
    )
    stmt = select(func.count(Message.id)).where(
        Message.conversation_id == conversation.id,
        Message.sender_id != current_user.id,
    )
    if last_read_at:
        stmt = stmt.where(Message.created_at > last_read_at)
    _r = await db.execute(stmt)
    return int(_r.scalar_one() or 0)


def _chat_message_event(message: Message, conversation: Conversation) -> dict:
    return {
        "type": "chat.message",
        "conversation_id": str(conversation.id),
        "admin_id": str(conversation.admin_id),
        "driver_id": str(conversation.driver_id),
        "message": _message_schema(message),
    }


def _chat_read_event(conversation: Conversation, reader: User) -> dict:
    return {
        "type": "chat.read",
        "conversation_id": str(conversation.id),
        "reader_id": str(reader.id),
        "admin_last_read_at": conversation.admin_last_read_at.isoformat() if conversation.admin_last_read_at else None,
        "driver_last_read_at": conversation.driver_last_read_at.isoformat() if conversation.driver_last_read_at else None,
    }


# ────────────────────────────────────────────────

@router.get("/chat/partners")
async def list_chat_partners(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.admin:
        partner_role = UserRole.driver
    elif current_user.role == UserRole.driver:
        partner_role = UserRole.admin
    else:
        raise HTTPException(403, "채팅은 관리자와 기사만 사용할 수 있습니다.")

    _r = await db.execute(
        select(User).where(
            User.organization_id == current_user.organization_id,
            User.role == partner_role,
        ).order_by(User.created_at.asc())
    )
    return [
        {"id": str(user.id), "username": user.username, "role": user.role.value}
        for user in _r.scalars().all()
    ]


@router.get("/chat/conversations")
async def list_chat_conversations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in (UserRole.admin, UserRole.driver):
        raise HTTPException(403, "채팅은 관리자와 기사만 사용할 수 있습니다.")

    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.admin), selectinload(Conversation.driver))
        .where(
            Conversation.organization_id == current_user.organization_id,
            or_(
                Conversation.admin_id == current_user.id,
                Conversation.driver_id == current_user.id,
            ),
        )
        .order_by(Conversation.updated_at.desc())
    )
    _r = await db.execute(stmt)
    conversations = _r.scalars().all()

    # 각 대화방의 최신 메시지 일괄 조회 (서브쿼리 1회)
    last_msg_map: dict = {}
    if conversations:
        conv_ids = [c.id for c in conversations]
        sub = (
            select(Message.conversation_id, func.max(Message.created_at).label("max_at"))
            .where(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
            .subquery()
        )
        _r2 = await db.execute(
            select(Message).join(
                sub,
                (Message.conversation_id == sub.c.conversation_id) &
                (Message.created_at == sub.c.max_at),
            )
        )
        last_msg_map = {msg.conversation_id: msg for msg in _r2.scalars().all()}

    return [
        _conversation_schema(c, current_user, await _count_unread_messages(db, c, current_user), last_msg_map.get(c.id))
        for c in conversations
    ]


@router.post("/chat/conversations", status_code=201)
async def create_or_get_chat_conversation(
    req: ConversationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = await _get_user_by_id(db, req.partner_id)
    conversation = await _get_or_create_conversation(db, current_user, partner)
    conversation.admin = current_user if current_user.role == UserRole.admin else partner
    conversation.driver = current_user if current_user.role == UserRole.driver else partner
    unread = await _count_unread_messages(db, conversation, current_user)
    _r2 = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    last_msg = _r2.scalar_one_or_none()
    return _conversation_schema(conversation, current_user, unread, last_msg)


@router.get("/chat/conversations/{conversation_id}/messages")
async def list_chat_messages(
    conversation_id: str,
    before_message_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = await _get_accessible_conversation(db, conversation_id, current_user)
    limit = max(1, min(limit, 100))
    stmt = select(Message).where(Message.conversation_id == conversation.id)

    if before_message_id:
        before_uuid = _as_uuid(before_message_id, "before_message_id")
        _before = await db.execute(
            select(Message).where(
                Message.id == before_uuid,
                Message.conversation_id == conversation.id,
            )
        )
        before_message = _before.scalar_one_or_none()
        if not before_message:
            raise HTTPException(404, "기준 메시지를 찾을 수 없습니다.")
        stmt = stmt.where(Message.created_at < before_message.created_at)

    _r = await db.execute(stmt.order_by(Message.created_at.desc()).limit(limit))
    messages = list(reversed(_r.scalars().all()))
    return [_message_schema(message) for message in messages]


@router.post("/chat/conversations/{conversation_id}/messages", status_code=201)
async def send_chat_message(
    conversation_id: str,
    req: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = await _get_accessible_conversation(db, conversation_id, current_user)
    content = req.content.strip()
    if not content:
        raise HTTPException(400, "메시지 내용을 입력해주세요.")
    if len(content) > 2000:
        raise HTTPException(400, "메시지는 2,000자 이하로 입력해주세요.")

    now = datetime.utcnow()
    message = Message(
        conversation_id=conversation.id,
        sender_id=current_user.id,
        content=content,
        created_at=now,
    )
    conversation.updated_at = now
    if current_user.id == conversation.admin_id:
        conversation.admin_last_read_at = now
    else:
        conversation.driver_last_read_at = now

    db.add(message)
    await db.commit()
    await db.refresh(message)
    await db.refresh(conversation)

    event = _chat_message_event(message, conversation)
    await chat_manager.send_to_many(
        [str(conversation.admin_id), str(conversation.driver_id)],
        event,
    )
    return _message_schema(message)


@router.post("/chat/conversations/{conversation_id}/read")
async def mark_chat_conversation_read(
    conversation_id: str,
    req: ReadConversationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conversation = await _get_accessible_conversation(db, conversation_id, current_user)
    read_at = datetime.utcnow()

    if req.last_read_message_id:
        message_uuid = _as_uuid(req.last_read_message_id, "last_read_message_id")
        _r = await db.execute(
            select(Message).where(
                Message.id == message_uuid,
                Message.conversation_id == conversation.id,
            )
        )
        message = _r.scalar_one_or_none()
        if not message:
            raise HTTPException(404, "읽음 처리할 메시지를 찾을 수 없습니다.")
        read_at = message.created_at

    if current_user.id == conversation.admin_id:
        conversation.admin_last_read_at = read_at
    else:
        conversation.driver_last_read_at = read_at

    await db.commit()
    await db.refresh(conversation)
    event = _chat_read_event(conversation, current_user)
    await chat_manager.send_to_many(
        [str(conversation.admin_id), str(conversation.driver_id)],
        event,
    )
    return {"ok": True, "conversation": _conversation_schema(conversation, current_user, 0)}

@router.websocket("/ws/chat")
async def ws_chat(
    ws: WebSocket,
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    async def _chat_reject():
        await ws.accept()
        await ws.close(code=1008)

    if not token:
        await _chat_reject(); return
    try:
        current_user = await get_current_user_from_token(token, db)
    except HTTPException:
        await _chat_reject(); return
    if current_user.role not in (UserRole.admin, UserRole.driver):
        await _chat_reject(); return

    user_id = str(current_user.id)
    await chat_manager.connect(user_id, ws)

    async def chat_heartbeat():
        try:
            while True:
                await asyncio.sleep(20)
                await ws.send_json({"type": "ping"})
        except Exception:
            pass

    hb = asyncio.create_task(chat_heartbeat())
    try:
        await ws.send_json({"type": "chat.ready", "user_id": user_id})
        while True:
            try:
                data = await ws.receive_text()
            except WebSocketDisconnect:
                raise
            if data == "ping":
                await ws.send_text("pong")
            else:
                try:
                    import json
                    payload = json.loads(data)
                    if payload.get("type") == "ping":
                        await ws.send_json({"type": "pong"})
                except Exception:
                    pass
    except WebSocketDisconnect:
        hb.cancel()
        chat_manager.disconnect(user_id, ws)
