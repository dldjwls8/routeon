"""
RouteOn — SQLAlchemy 모델 정의
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, Boolean,
    DateTime, Date, ForeignKey, Text, Enum as SAEnum,
    Index, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from database import Base
import enum


# ────────────────────────────────────────────────
# Enum
# ────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    superadmin = "superadmin"  # 루트온 팀 (전체 기업 관리)
    admin      = "admin"
    driver     = "driver"
    pending    = "pending"     # 레거시 데이터 마이그레이션용


class AccountStatus(str, enum.Enum):
    pending  = "pending"
    approved = "approved"
    rejected = "rejected"


class OrgStatus(str, enum.Enum):
    pending_review = "pending_review"  # 서류 심사 중
    approved       = "approved"        # 승인 완료
    rejected       = "rejected"        # 반려


class DeliveryStatus(str, enum.Enum):
    pending     = "pending"
    accepted    = "accepted"
    in_progress = "in_progress"
    done        = "done"
    done_manual = "done_manual"
    cancelled   = "cancelled"


class TripStatus(str, enum.Enum):
    scheduled   = "scheduled"
    in_progress = "in_progress"
    completed   = "completed"
    cancelled   = "cancelled"


class RestStopType(str, enum.Enum):
    highway_rest   = "highway_rest"
    drowsy_shelter = "drowsy_shelter"
    depot          = "depot"
    custom         = "custom"
    truck_yard     = "truck_yard"
    logistics_park = "logistics_park"


# ────────────────────────────────────────────────
# organizations  (기업 단위)
# ────────────────────────────────────────────────
class Organization(Base):
    __tablename__ = "organizations"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    name          = Column(String(100), nullable=False)
    org_code      = Column(String(20), unique=True, nullable=False)
    status        = Column(SAEnum(OrgStatus), nullable=False,
                           default=OrgStatus.pending_review)
    doc_filename  = Column(String(255))   # 업로드된 원본 파일명
    doc_path      = Column(String(512))   # 서버 저장 경로
    reject_reason         = Column(Text)          # 반려 사유
    reviewed_at           = Column(DateTime)      # 심사 완료 시각
    auto_approve_drivers  = Column(Boolean, nullable=False, default=False)
    auto_approve_admins   = Column(Boolean, nullable=False, default=False)
    created_at            = Column(DateTime, default=datetime.utcnow, nullable=False)

    users = relationship("User", back_populates="organization")


# ────────────────────────────────────────────────
# app_settings  (전역 운영 설정)
# ────────────────────────────────────────────────
class AppSetting(Base):
    __tablename__ = "app_settings"

    key        = Column(String(80), primary_key=True)
    value      = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# ────────────────────────────────────────────────
# users
# ────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username        = Column(String(50), unique=True, nullable=False, index=True)
    password_hash   = Column(String(255), nullable=False)
    role            = Column(SAEnum(UserRole), nullable=False, default=UserRole.driver)
    name            = Column(String(50))
    email           = Column(String(255))
    phone           = Column(String(20))
    profile_image   = Column(String(512))
    license_number  = Column(String(50))
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    vehicle_id      = Column(Integer, ForeignKey("vehicles.id"), nullable=True)
    driver_status   = Column(String(20), nullable=True, default='운행가능')
    is_org_owner    = Column(Boolean, nullable=False, default=False)
    permissions     = Column(JSONB, nullable=False, default=dict)
    account_status  = Column(SAEnum(AccountStatus), nullable=False,
                             default=AccountStatus.approved)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    organization = relationship("Organization", back_populates="users")
    deliveries   = relationship("Delivery", back_populates="driver",
                                foreign_keys="Delivery.assigned_to")
    trips        = relationship("Trip", back_populates="driver")
    locations    = relationship("Location", back_populates="user")
    admin_conversations = relationship(
        "Conversation",
        back_populates="admin",
        foreign_keys="Conversation.admin_id",
    )
    driver_conversations = relationship(
        "Conversation",
        back_populates="driver",
        foreign_keys="Conversation.driver_id",
    )
    sent_messages = relationship(
        "Message",
        back_populates="sender",
        foreign_keys="Message.sender_id",
    )


# ────────────────────────────────────────────────
# conversations / messages  (같은 기업 사용자 간 1:1 채팅)
# ────────────────────────────────────────────────
class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "admin_id", "driver_id",
            name="uq_conversations_org_admin_driver",
        ),
        Index("ix_conversations_admin_id", "admin_id"),
        Index("ix_conversations_driver_id", "driver_id"),
        Index("ix_conversations_org_updated", "organization_id", "updated_at"),
    )

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    admin_id            = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    driver_id           = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    admin_last_read_at  = Column(DateTime)
    driver_last_read_at = Column(DateTime)
    created_at          = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at          = Column(DateTime, default=datetime.utcnow, nullable=False)

    organization = relationship("Organization")
    admin        = relationship("User", back_populates="admin_conversations", foreign_keys=[admin_id])
    driver       = relationship("User", back_populates="driver_conversations", foreign_keys=[driver_id])
    messages     = relationship("Message", back_populates="conversation")


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
        Index("ix_messages_conversation_id_id", "conversation_id", "id"),
        Index("ix_messages_sender_id", "sender_id"),
    )

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    sender_id       = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content         = Column(Text, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    conversation = relationship("Conversation", back_populates="messages")
    sender       = relationship("User", back_populates="sent_messages", foreign_keys=[sender_id])


# ────────────────────────────────────────────────
# vehicles  (차량 마스터)
# ────────────────────────────────────────────────
class Vehicle(Base):
    __tablename__ = "vehicles"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    plate_number = Column(String(20), unique=True, nullable=False)
    vehicle_type = Column(String(50), nullable=False)
    height_m     = Column(Float, nullable=False)
    weight_kg    = Column(Float, nullable=False)
    length_cm    = Column(Float)
    width_cm     = Column(Float)
    status       = Column(String(20), nullable=False, server_default='가용')
    last_lat     = Column(Float)
    last_lon     = Column(Float)
    last_gps_at  = Column(DateTime)
    is_active    = Column(Boolean, nullable=False, default=True)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=False)

    trips = relationship("Trip", back_populates="vehicle")


# ────────────────────────────────────────────────
# rest_stops  (휴게소 / 졸음쉼터 POI)
# ────────────────────────────────────────────────
class RestStop(Base):
    __tablename__ = "rest_stops"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    name      = Column(String(100), nullable=False)
    type      = Column(SAEnum(RestStopType), nullable=False)
    latitude  = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    direction = Column(String(10))
    note      = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# ────────────────────────────────────────────────
# trips  (운행 단위)
# ────────────────────────────────────────────────
class Trip(Base):
    __tablename__ = "trips"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_id  = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=True)

    origin_name = Column(String(200))
    origin_lat  = Column(Float)
    origin_lon  = Column(Float)

    dest_name = Column(String(200), nullable=True)
    dest_lat  = Column(Float, nullable=True)
    dest_lon  = Column(Float, nullable=True)

    vehicle_height_m  = Column(Float)
    vehicle_weight_kg = Column(Float)
    vehicle_length_cm = Column(Float)
    vehicle_width_cm  = Column(Float)

    departure_time  = Column(String(50))
    waypoints       = Column(JSONB)
    optimized_route = Column(JSONB)
    status          = Column(SAEnum(TripStatus), nullable=False,
                              default=TripStatus.scheduled)
    current_phase   = Column(String(40), nullable=False, default="waiting")
    phase_updated_at = Column(DateTime)
    is_emergency    = Column(Boolean, default=False)
    cancel_requested        = Column(Boolean, nullable=False, default=False)
    cancel_request_reason   = Column(Text, nullable=True)
    safety_issue    = Column(Boolean, nullable=False, default=False)

    started_at   = Column(DateTime)
    completed_at = Column(DateTime)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=False)

    driver     = relationship("User", back_populates="trips")
    vehicle    = relationship("Vehicle", back_populates="trips")
    deliveries = relationship("Delivery", back_populates="trip")


# ────────────────────────────────────────────────
# deliveries  (배송지 단위)
# ────────────────────────────────────────────────
class Delivery(Base):
    __tablename__ = "deliveries"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id  = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    assigned_to      = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    trip_id          = Column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=True)
    address          = Column(String(255), nullable=False)   # 하차 주소
    lat              = Column(Float, nullable=True)           # 하차 위도
    lon              = Column(Float, nullable=True)           # 하차 경도
    pickup_address   = Column(String(255), nullable=True)    # 상차 주소
    pickup_lat       = Column(Float, nullable=True)
    pickup_lon       = Column(Float, nullable=True)
    shipper_name     = Column(String(100), nullable=True)    # 화주명
    contact_phone    = Column(String(20), nullable=True)     # 담당자 연락처
    shipper_phone    = Column(String(20), nullable=True)     # 화주 연락처
    mixed_load       = Column(Boolean, default=False, nullable=False)
    cargo_type       = Column(String(100), nullable=True)    # 하차 화물 종류
    cargo_size       = Column(String(100), nullable=True)    # 하차 화물 규격(예: 5톤, 3파레트)
    cargo_weight_ton = Column(Float, nullable=True)          # 하차 화물 중량(톤)
    pickup_cargo_type       = Column(String(100), nullable=True)    # 상차 화물 종류
    pickup_cargo_size       = Column(String(100), nullable=True)    # 상차 화물 규격
    pickup_cargo_weight_ton = Column(Float, nullable=True)          # 상차 화물 중량(톤)
    status           = Column(SAEnum(DeliveryStatus),
                               default=DeliveryStatus.pending, nullable=False)
    sequence         = Column(Integer)
    assigned_at      = Column(DateTime, nullable=True)
    started_at       = Column(DateTime, nullable=True)
    completed_at     = Column(DateTime, nullable=True)
    cancelled_at     = Column(DateTime, nullable=True)
    pickup_time      = Column(DateTime, nullable=True)
    unloading_time   = Column(DateTime, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False)

    driver = relationship("User", back_populates="deliveries",
                          foreign_keys=[assigned_to])
    trip   = relationship("Trip", back_populates="deliveries")


# ────────────────────────────────────────────────
# order_events  (오더·운행 처리 기록)
# ────────────────────────────────────────────────
class OrderEvent(Base):
    __tablename__ = "order_events"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True, index=True)
    delivery_id     = Column(UUID(as_uuid=True), ForeignKey("deliveries.id", ondelete="SET NULL"), nullable=True, index=True)
    trip_id         = Column(UUID(as_uuid=True), ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_role      = Column(String(20), nullable=True)
    actor_name      = Column(String(100), nullable=True)
    event_type      = Column(String(50), nullable=False, index=True)
    summary         = Column(String(255), nullable=False)
    details         = Column(JSONB, nullable=False, default=dict)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    organization = relationship("Organization")
    delivery     = relationship("Delivery")
    trip         = relationship("Trip")
    actor        = relationship("User")

    __table_args__ = (
        Index("ix_order_events_delivery_created", "delivery_id", "created_at"),
        Index("ix_order_events_trip_created", "trip_id", "created_at"),
    )


# ────────────────────────────────────────────────
# entity_events  (관리 마스터 수정 감사 기록)
# ────────────────────────────────────────────────
class EntityEvent(Base):
    __tablename__ = "entity_events"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    entity_type     = Column(String(30), nullable=False, index=True)
    entity_id       = Column(String(80), nullable=False, index=True)
    actor_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_name      = Column(String(100), nullable=True)
    action          = Column(String(30), nullable=False)
    summary         = Column(String(255), nullable=False)
    changes         = Column(JSONB, nullable=False, default=dict)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        Index("ix_entity_events_lookup", "organization_id", "entity_type", "entity_id", "created_at"),
    )


# ────────────────────────────────────────────────
# locations  (GPS 이동 이력 — TimescaleDB hypertable)
# ────────────────────────────────────────────────
class Location(Base):
    __tablename__ = "locations"

    id          = Column(UUID(as_uuid=True), default=uuid.uuid4, primary_key=True)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id"),
                         nullable=False, index=True)
    lat         = Column(Float, nullable=False)
    lon         = Column(Float, nullable=False)
    speed       = Column(Float)
    recorded_at = Column(DateTime, default=datetime.utcnow,
                         nullable=False, primary_key=True)

    user = relationship("User", back_populates="locations")


# ────────────────────────────────────────────────
# presets  (경유지 조합 프리셋)
# ────────────────────────────────────────────────
class Preset(Base):
    __tablename__ = "presets"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name            = Column(String(100), nullable=False)
    waypoints       = Column(JSONB, nullable=False, default=list)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    organization = relationship("Organization")


# ────────────────────────────────────────────────
# customers  (거래처 마스터)
# ────────────────────────────────────────────────
class Customer(Base):
    __tablename__ = "customers"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name            = Column(String(100), nullable=False)
    phone           = Column(String(20))
    address         = Column(String(255))
    lat             = Column(Float)
    lon             = Column(Float)
    memo            = Column(Text)
    temporary       = Column(Boolean, nullable=False, default=False)
    valid_date      = Column(Date)             # 임시 화주 유효일 (YYYY-MM-DD)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    organization    = relationship("Organization")
