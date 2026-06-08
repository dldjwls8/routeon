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
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image VARCHAR(512);"
        ))

        # organizations.auto_approve_drivers 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
            "auto_approve_drivers BOOLEAN NOT NULL DEFAULT FALSE;"
        ))
        await conn.execute(text(
            "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
            "auto_approve_admins BOOLEAN NOT NULL DEFAULT FALSE;"
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
        await conn.execute(text(
            "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_lat FLOAT;"
        ))
        await conn.execute(text(
            "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_lon FLOAT;"
        ))
        await conn.execute(text(
            "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_gps_at TIMESTAMP;"
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
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_org_owner BOOLEAN NOT NULL DEFAULT FALSE;"
        ))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;"
        ))
        await conn.execute(text("""
            DO $$
            BEGIN
                CREATE TYPE accountstatus AS ENUM ('pending', 'approved', 'rejected');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        """))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status "
            "accountstatus NOT NULL DEFAULT 'approved';"
        ))
        await conn.execute(text("""
            UPDATE users
               SET role = 'driver',
                   account_status = 'pending'
             WHERE role = 'pending';
        """))
        await conn.execute(text("""
            WITH ranked_admins AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY organization_id
                           ORDER BY created_at ASC, id ASC
                       ) AS rn
                  FROM users
                 WHERE role = 'admin'
                   AND organization_id IS NOT NULL
            )
            UPDATE users
               SET is_org_owner = TRUE
              FROM ranked_admins
             WHERE users.id = ranked_admins.id
               AND ranked_admins.rn = 1
               AND NOT EXISTS (
                   SELECT 1
                     FROM users owner_user
                    WHERE owner_user.organization_id = users.organization_id
                      AND owner_user.role = 'admin'
                      AND owner_user.is_org_owner = TRUE
               );
        """))

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
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cargo_size VARCHAR(100);"
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

        # customers 주소 좌표 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE customers ADD COLUMN IF NOT EXISTS lat FLOAT;"
        ))
        await conn.execute(text(
            "ALTER TABLE customers ADD COLUMN IF NOT EXISTS lon FLOAT;"
        ))

        # customers.contact(담당자명) 컬럼 제거
        await conn.execute(text(
            "ALTER TABLE customers DROP COLUMN IF EXISTS contact;"
        ))

        # deliveries 상차 화물 정보 컬럼 추가
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS pickup_cargo_type VARCHAR(100);"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS pickup_cargo_size VARCHAR(100);"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS pickup_cargo_weight_ton FLOAT;"
        ))

        # deliveries 불필요 컬럼 제거 (v1.0.123)
        await conn.execute(text(
            "ALTER TABLE deliveries DROP COLUMN IF EXISTS contact_name;"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries DROP COLUMN IF EXISTS recipient_name;"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries DROP COLUMN IF EXISTS deadline;"
        ))

        # deliveries 시간 추적 컬럼 추가 (v1.0.125)
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP;"
        ))
        await conn.execute(text(
            "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS unloading_time TIMESTAMP;"
        ))

        # DeliveryStatus enum에 accepted 추가 (v1.0.125)
        await conn.execute(text("""
            DO $$
            BEGIN
                ALTER TYPE deliverystatus ADD VALUE IF NOT EXISTS 'accepted';
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
        """))
