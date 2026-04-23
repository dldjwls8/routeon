"""
RouteOn — SQLAlchemy 모델 정의
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, Boolean,
    DateTime, ForeignKey, Text, Enum as SAEnum
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
    pending    = "pending"     # 승인 대기 중


class OrgStatus(str, enum.Enum):
    pending_review = "pending_review"  # 서류 심사 중
    approved       = "approved"        # 승인 완료
    rejected       = "rejected"        # 반려


class DeliveryStatus(str, enum.Enum):
    pending     = "pending"
    in_progress = "in_progress"
    done        = "done"
    done_manual = "done_manual"


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
    reject_reason = Column(Text)          # 반려 사유
    reviewed_at   = Column(DateTime)      # 심사 완료 시각
    created_at    = Column(DateTime, default=datetime.utcnow, nullable=False)

    users = relationship("User", back_populates="organization")


# ────────────────────────────────────────────────
# users
# ────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username        = Column(String(50), unique=True, nullable=False, index=True)
    password_hash   = Column(String(255), nullable=False)
    role            = Column(SAEnum(UserRole), nullable=False, default=UserRole.driver)
    email           = Column(String(255))
    phone           = Column(String(20))
    license_number  = Column(String(50))
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    organization = relationship("Organization", back_populates="users")
    deliveries   = relationship("Delivery", back_populates="driver",
                                foreign_keys="Delivery.assigned_to")
    trips        = relationship("Trip", back_populates="driver")
    locations    = relationship("Location", back_populates="user")


# ────────────────────────────────────────────────
# vehicles  (차량 마스터)
# ────────────────────────────────────────────────
class Vehicle(Base):
    __tablename__ = "vehicles"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    plate_number = Column(String(20), unique=True, nullable=False)
    vehicle_type = Column(String(50), nullable=False)
    height_m     = Column(Float, nullable=False)
    weight_kg    = Column(Float, nullable=False)
    length_cm    = Column(Float)
    width_cm     = Column(Float)
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

    dest_name = Column(String(200), nullable=False)
    dest_lat  = Column(Float, nullable=False)
    dest_lon  = Column(Float, nullable=False)

    vehicle_height_m  = Column(Float)
    vehicle_weight_kg = Column(Float)
    vehicle_length_cm = Column(Float)
    vehicle_width_cm  = Column(Float)

    departure_time  = Column(String(50))
    waypoints       = Column(JSONB)
    optimized_route = Column(JSONB)
    status          = Column(SAEnum(TripStatus), nullable=False,
                              default=TripStatus.scheduled)
    is_emergency    = Column(Boolean, default=False)

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

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assigned_to = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    trip_id     = Column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=True)
    address     = Column(String(255), nullable=False)
    lat         = Column(Float, nullable=False)
    lon         = Column(Float, nullable=False)
    status      = Column(SAEnum(DeliveryStatus),
                          default=DeliveryStatus.pending, nullable=False)
    sequence    = Column(Integer)
    deadline    = Column(DateTime)
    completed_at = Column(DateTime)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)

    driver = relationship("User", back_populates="deliveries",
                          foreign_keys=[assigned_to])
    trip   = relationship("Trip", back_populates="deliveries")


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