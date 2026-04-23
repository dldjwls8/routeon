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