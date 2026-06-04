"""
RouteOn — DB 연결 + 초기화 (비동기)
"""

import os
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy import text

POSTGRES_USER     = os.getenv("POSTGRES_USER", "routeon")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")
POSTGRES_HOST     = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT     = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_DB       = os.getenv("POSTGRES_DB", "routeon")

DATABASE_URL = (
    f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,       # 쿼리 전 연결 유효성 확인 → 끊긴 연결 자동 교체
    pool_recycle=1800,        # 30분마다 연결 갱신
)

AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


# ────────────────────────────────────────────────
# DB 세션 의존성 (FastAPI Depends)
# ────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ────────────────────────────────────────────────
# 테이블 생성 + TimescaleDB 설정
# ────────────────────────────────────────────────
async def init_db():
    import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # TimescaleDB extension
        await conn.execute(text(
            "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"
        ))

        # hypertable 변환
        await conn.execute(text("""
            SELECT create_hypertable(
                'locations', 'recorded_at',
                if_not_exists => TRUE
            );
        """))

        # 7일 retention policy
        await conn.execute(text("""
            SELECT add_retention_policy(
                'locations',
                INTERVAL '7 days',
                if_not_exists => TRUE
            );
        """))

        # users.name 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(50);"
        ))

        # organizations.auto_approve_drivers 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
            "auto_approve_drivers BOOLEAN NOT NULL DEFAULT FALSE;"
        ))

        # trips.dest_* 컬럼 NOT NULL 제거 (상차지/하차지 플로우 지원)
        await conn.execute(text(
            "ALTER TABLE trips ALTER COLUMN dest_name DROP NOT NULL;"
        ))
        await conn.execute(text(
            "ALTER TABLE trips ALTER COLUMN dest_lat DROP NOT NULL;"
        ))
        await conn.execute(text(
            "ALTER TABLE trips ALTER COLUMN dest_lon DROP NOT NULL;"
        ))

        # vehicles.status 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT '가용';"
        ))
        await conn.execute(text(
            "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);"
        ))
        await conn.execute(text("""
            UPDATE vehicles v
               SET organization_id = u.organization_id
              FROM users u
             WHERE v.organization_id IS NULL
               AND u.vehicle_id = v.id
               AND u.organization_id IS NOT NULL;
        """))
        await conn.execute(text("""
            UPDATE vehicles
               SET organization_id = (SELECT id FROM organizations ORDER BY id LIMIT 1)
             WHERE organization_id IS NULL
               AND EXISTS (SELECT 1 FROM organizations);
        """))

        # users.vehicle_id / users.driver_status 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL;"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_status VARCHAR(20);"
        ))

        # deliveries.organization_id 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS shipper_phone VARCHAR(20);"
        ))
        await conn.execute(text("""
            UPDATE deliveries d
               SET organization_id = u.organization_id
              FROM users u
             WHERE d.organization_id IS NULL
               AND d.assigned_to = u.id
               AND u.organization_id IS NOT NULL;
        """))
        await conn.execute(text("""
            UPDATE deliveries d
               SET organization_id = u.organization_id
              FROM trips t
              JOIN users u ON u.id = t.driver_id
             WHERE d.organization_id IS NULL
               AND d.trip_id = t.id
               AND u.organization_id IS NOT NULL;
        """))
        await conn.execute(text("""
            UPDATE deliveries
               SET organization_id = (SELECT id FROM organizations ORDER BY id LIMIT 1)
             WHERE organization_id IS NULL
               AND EXISTS (SELECT 1 FROM organizations);
        """))

        # trips 상세 진행 상태 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_phase VARCHAR(40) NOT NULL DEFAULT 'waiting';"
        ))
        await conn.execute(text(
            "ALTER TABLE trips ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMP;"
        ))
