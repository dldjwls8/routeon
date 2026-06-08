"""
RouteOn — 시연용 기사·차량 GPS 좌표 시드

기존 demo 데이터에 좌표를 추가합니다:
- vehicles.last_lat / last_lon / last_gps_at
- locations (TimescaleDB) — 기사별 최근 위치 이력 1건

사용법:
    docker exec -it routeon-api python seeds/seed_demo_coords.py
"""

import asyncio
import random
import sys
from datetime import datetime, timedelta

sys.path.insert(0, "/app")

from sqlalchemy import select
from database import AsyncSessionLocal
from models import Organization, User, UserRole, Vehicle, Location

# ────────────────────────────────────────────────
# 데모용 좌표 (서울·수도권 중심 + 지방 주요 도시)
# ────────────────────────────────────────────────
COORDS = [
    # 서울/수원/인천
    {"lat": 37.4979, "lon": 127.0276, "addr": "서울 강남"},
    {"lat": 37.2636, "lon": 127.0286, "addr": "수원 팔달"},
    {"lat": 37.4042, "lon": 126.6810, "addr": "인천 연수"},
    {"lat": 37.5665, "lon": 126.9780, "addr": "서울 종로"},
    {"lat": 37.4563, "lon": 126.7052, "addr": "인천 부개"},
    # 부산/대구/울산
    {"lat": 35.1587, "lon": 129.1604, "addr": "부산 해운대"},
    {"lat": 35.8570, "lon": 128.6266, "addr": "대구 수성"},
    {"lat": 35.5384, "lon": 129.3114, "addr": "울산 남구"},
    # 광주/대전/성남/천안
    {"lat": 35.1520, "lon": 126.8895, "addr": "광주 서구"},
    {"lat": 36.3640, "lon": 127.3451, "addr": "대전 유성"},
    {"lat": 37.3802, "lon": 127.1156, "addr": "성남 분당"},
    {"lat": 36.8151, "lon": 127.1139, "addr": "천안 서북"},
]


def _jitter(coord, max_km=3.0):
    """좌표를 중심으로 max_km 범위 내에서 무작위 흔들기"""
    # 대략 1° ≈ 111 km
    jitter_deg = max_km / 111.0
    return {
        "lat": coord["lat"] + random.uniform(-jitter_deg, jitter_deg),
        "lon": coord["lon"] + random.uniform(-jitter_deg, jitter_deg),
        "addr": coord["addr"],
    }


async def seed_coords():
    async with AsyncSessionLocal() as db:
        # 기업 찾기
        result = await db.execute(
            select(Organization).where(Organization.org_code == "DEMO001")
        )
        org = result.scalar_one_or_none()
        if not org:
            print("❌ 데모 기업(DEMO001)이 존재하지 않습니다. 먼저 seed_demo.py를 실행하세요.")
            return

        org_id = org.id

        # 기사 10명
        result = await db.execute(
            select(User).where(
                User.organization_id == org_id,
                User.role == UserRole.driver,
            )
        )
        drivers = result.scalars().all()
        if not drivers:
            print("❌ 데모 기사가 없습니다.")
            return
        print(f"📍 {len(drivers)}명의 기사 좌표 등록 시작...")

        # 차량 10대
        result = await db.execute(
            select(Vehicle).where(Vehicle.organization_id == org_id)
        )
        vehicles = result.scalars().all()
        vehicle_by_id = {v.id: v for v in vehicles}

        now = datetime.utcnow()

        for idx, driver in enumerate(drivers):
            # 좌표 선택 (순환 + 무작위 흔들기)
            base = COORDS[idx % len(COORDS)]
            pos = _jitter(base, max_km=2.5)

            # 1) Vehicle 좌표 갱신
            if driver.vehicle_id and driver.vehicle_id in vehicle_by_id:
                vehicle = vehicle_by_id[driver.vehicle_id]
                vehicle.last_lat = round(pos["lat"], 6)
                vehicle.last_lon = round(pos["lon"], 6)
                vehicle.last_gps_at = now
                db.add(vehicle)
                print(f"  🚚 {vehicle.plate_number} → {pos['addr']} ({vehicle.last_lat}, {vehicle.last_lon})")

            # 2) Location 이력 삽입 (TimescaleDB hypertable)
            loc = Location(
                user_id=driver.id,
                lat=round(pos["lat"], 6),
                lon=round(pos["lon"], 6),
                speed=round(random.uniform(0, 80), 1),
                recorded_at=now,
            )
            db.add(loc)
            print(f"  👤 {driver.name} ({driver.username}) → {pos['addr']} ({loc.lat}, {loc.lon})")

            # 약간의 시간차 부여 (과거 기록이 섞이지 않도록)
            now -= timedelta(seconds=random.randint(5, 30))

        await db.commit()
        print(f"\n✅ {len(drivers)}명 기사 / {len(vehicles)}대 차량 좌표 등록 완료")


if __name__ == "__main__":
    asyncio.run(seed_coords())
