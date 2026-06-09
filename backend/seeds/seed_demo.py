"""
RouteOn — 시연용 데모 데이터 시드 스크립트

생성 항목:
- 기업(Organization) 1개
- 기업 대표(owner) 1명  (role=admin, is_org_owner=true)
- 부관리자(sub-admin) 1명 (role=admin, is_org_owner=false)
- 기사(Driver) 10명
- 차량(Vehicle) 10대 (기사 1:1 매핑)
- 고객(Customer) 20명
- 휴식지(Rest Stops) 253건 (졸음쉼터)

사용법:
    docker exec -it routeon-api python seeds/seed_demo.py
"""

import asyncio
import csv
import uuid
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, "/app")

from sqlalchemy import select, delete, text

from database import AsyncSessionLocal, engine, Base
from models import (
    Organization,
    OrgStatus,
    User,
    UserRole,
    AccountStatus,
    Vehicle,
    Customer,
    Location,
)
from auth import hash_password

# ────────────────────────────────────────────────
# 설정
# ────────────────────────────────────────────────
ORG = {
    "name": "데모물류",
    "org_code": "RT-TEST01",
    "status": OrgStatus.approved,
    "auto_approve_drivers": True,
    "auto_approve_admins": True,
}

SUPERADMIN = {
    "username": "superadmin",
    "password": "superadmin",
    "name": "루트온 관리자",
    "email": "superadmin@routeon.com",
    "role": UserRole.superadmin,
    "is_org_owner": False,
    "account_status": AccountStatus.approved,
}

OWNER = {
    "username": "admin1",
    "password": "admin1",
    "name": "김대표",
    "email": "owner@demo.com",
    "phone": "010-1000-0001",
    "role": UserRole.admin,
    "is_org_owner": True,
    "account_status": AccountStatus.approved,
}

SUB_ADMIN = {
    "username": "admin2",
    "password": "admin2",
    "name": "이부관리자",
    "email": "admin@demo.com",
    "phone": "010-1000-0002",
    "role": UserRole.admin,
    "is_org_owner": False,
    "account_status": AccountStatus.approved,
}

# ── 전국 주요 도시 좌표 (기사/차량 분산 배치) ──
CITY_COORDS = [
    ("서울",     37.5665, 126.9780),
    ("부산",     35.1796, 129.0756),
    ("대구",     35.8714, 128.6014),
    ("인천",     37.4563, 126.7052),
    ("광주",     35.1595, 126.8526),
    ("대전",     36.3504, 127.3845),
    ("울산",     35.5384, 129.3114),
    ("세종",     36.4800, 127.2890),
    ("수원",     37.2636, 127.0286),
    ("춘천",     37.8813, 127.7298),
]

DRIVERS = [
    {
        "username": f"driver{i}",
        "password": f"driver{i}",
        "name": f"기사{i:02d}",
        "phone": f"010-2000-{i:04d}",
        "lat": CITY_COORDS[i - 1][1],
        "lon": CITY_COORDS[i - 1][2],
    }
    for i in range(1, 11)
]

VEHICLES = [
    {"plate_number": "123가4567", "vehicle_type": "카고",     "height_m": 2.5, "weight_kg": 3500, "length_cm": 620, "width_cm": 210, "last_lat": CITY_COORDS[0][1], "last_lon": CITY_COORDS[0][2]},
    {"plate_number": "234나5678", "vehicle_type": "윙바디",   "height_m": 2.8, "weight_kg": 5000, "length_cm": 750, "width_cm": 230, "last_lat": CITY_COORDS[1][1], "last_lon": CITY_COORDS[1][2]},
    {"plate_number": "345다6789", "vehicle_type": "탑차",     "height_m": 2.2, "weight_kg": 2500, "length_cm": 550, "width_cm": 200, "last_lat": CITY_COORDS[2][1], "last_lon": CITY_COORDS[2][2]},
    {"plate_number": "456라7890", "vehicle_type": "냉동",     "height_m": 2.6, "weight_kg": 4000, "length_cm": 650, "width_cm": 215, "last_lat": CITY_COORDS[3][1], "last_lon": CITY_COORDS[3][2]},
    {"plate_number": "567마8901", "vehicle_type": "플랫폼",   "height_m": 1.8, "weight_kg": 1500, "length_cm": 450, "width_cm": 180, "last_lat": CITY_COORDS[4][1], "last_lon": CITY_COORDS[4][2]},
    {"plate_number": "678바9012", "vehicle_type": "카고",     "height_m": 2.5, "weight_kg": 3500, "length_cm": 620, "width_cm": 210, "last_lat": CITY_COORDS[5][1], "last_lon": CITY_COORDS[5][2]},
    {"plate_number": "789사0123", "vehicle_type": "윙바디",   "height_m": 2.8, "weight_kg": 5000, "length_cm": 750, "width_cm": 230, "last_lat": CITY_COORDS[6][1], "last_lon": CITY_COORDS[6][2]},
    {"plate_number": "890아1234", "vehicle_type": "탑차",     "height_m": 2.2, "weight_kg": 2500, "length_cm": 550, "width_cm": 200, "last_lat": CITY_COORDS[7][1], "last_lon": CITY_COORDS[7][2]},
    {"plate_number": "901자2345", "vehicle_type": "냉동",     "height_m": 2.6, "weight_kg": 4000, "length_cm": 650, "width_cm": 215, "last_lat": CITY_COORDS[8][1], "last_lon": CITY_COORDS[8][2]},
    {"plate_number": "012차3456", "vehicle_type": "카고",     "height_m": 2.5, "weight_kg": 3500, "length_cm": 620, "width_cm": 210, "last_lat": CITY_COORDS[9][1], "last_lon": CITY_COORDS[9][2]},
    {"plate_number": "345하6789", "vehicle_type": "리프트",   "height_m": 2.4, "weight_kg": 4000, "length_cm": 700, "width_cm": 220, "last_lat": 33.4996, "last_lon": 126.5312},  # 제주 (예비)
]

CUSTOMERS = [
    {"name": "데모물류",      "phone": "010-1111-2222", "address": "경기 화성시 팔탄면 덕충산길 11",              "lat": 37.1208, "lon": 126.9023},
    {"name": "삼성전자",      "phone": "010-2222-3333", "address": "경기도 수원시 영통구 삼성로 129",             "lat": 37.2571, "lon": 127.0536},
    {"name": "LG생활건강",    "phone": "010-3333-4444", "address": "서울특별시 강서구 마곡중앙6로 72",            "lat": 37.5585, "lon": 126.8291},
    {"name": "CJ대한통운",    "phone": "010-4444-5555", "address": "경기도 이천시 호법면 중부대로 310",           "lat": 37.2484, "lon": 127.4235},
    {"name": "현대제철",      "phone": "010-5555-6666", "address": "충청남도 당진시 송악읍 현대제철로 1",         "lat": 36.9100, "lon": 126.6430},
    {"name": "포스코",        "phone": "010-6666-7777", "address": "경상북도 포항시 남구 동해문로 148",           "lat": 36.0190, "lon": 129.3435},
    {"name": "한국타이어",    "phone": "010-7777-8888", "address": "충청남도 금산군 금산읍 무극로 215",           "lat": 36.1060, "lon": 127.4883},
    {"name": "기아자동차",    "phone": "010-8888-9999", "address": "광주광역시 북구 하남대로 757",                "lat": 35.1608, "lon": 126.8820},
    {"name": "롯데칠성",      "phone": "010-9999-0000", "address": "경기도 화성시 팔탄면 에이스로 100",           "lat": 37.1208, "lon": 126.9023},
    {"name": "아모레퍼시픽",  "phone": "010-0000-1111", "address": "경기도 용인시 수지구 신수로 100",             "lat": 37.3228, "lon": 127.0971},
    {"name": "네이버",        "phone": "010-1212-2323", "address": "경기도 성남시 분당구 정자일로 95",            "lat": 37.3595, "lon": 127.1054},
    {"name": "카카오",        "phone": "010-2323-3434", "address": "경기도 성남시 분당구 판교역로 166",           "lat": 37.3943, "lon": 127.1101},
    {"name": "쿠팡",          "phone": "010-3434-4545", "address": "경기도 이천시 마장면 배터지로 100",           "lat": 37.2484, "lon": 127.4235},
    {"name": "이마트",        "phone": "010-4545-5656", "address": "서울특별시 성동구 뚝섬로 377",                "lat": 37.5443, "lon": 127.0560},
    {"name": "GS리테일",      "phone": "010-5656-6767", "address": "경기도 김포시 양촌읍 양촌역로 100",           "lat": 37.6152, "lon": 126.6289},
    {"name": "한진",          "phone": "010-6767-7878", "address": "경기도 화성시 팔탄면 에이스로 200",           "lat": 37.1208, "lon": 126.9023},
    {"name": "동원산업",      "phone": "010-7878-8989", "address": "부산광역시 강서구 녹산산업중로 333",          "lat": 35.1110, "lon": 128.8360},
    {"name": "오뚜기",        "phone": "010-8989-9090", "address": "충청북도 청주시 흥덕구 오송읍 오송생명로 183", "lat": 36.6801, "lon": 127.4010},
    {"name": "농심",          "phone": "010-9090-0101", "address": "서울특별시 동작구 여의대방로 112",            "lat": 37.4985, "lon": 126.9390},
    {"name": "하이트진로",    "phone": "010-0101-1212", "address": "서울특별시 강남구 영동대로 714",              "lat": 37.5142, "lon": 127.0603},
]


# ────────────────────────────────────────────────
# 시드 로직
# ────────────────────────────────────────────────
async def seed():
    # ── 데모 관련 데이터만 선택 삭제 (users 테이블의 루트 계정 보존) ──
    print("⚠️  데모 데이터를 삭제합니다...")
    async with engine.begin() as conn:
        # 1) users를 참조하는 FK가 있는 테이블들 먼저 TRUNCATE
        truncate_tables = [
            t.name for t in Base.metadata.sorted_tables
            if t.name != "users"
        ]
        if truncate_tables:
            tables_sql = ", ".join(f'"{t}"' for t in truncate_tables)
            await conn.execute(text(f"TRUNCATE TABLE {tables_sql} RESTART IDENTITY CASCADE"))

        # 2) users 테이블에서는 데모 계정만 삭제 (superadmin 보존)
        demo_usernames = ["admin1", "admin2"] + [f"driver{i}" for i in range(1, 11)]
        placeholders = ", ".join(f":u{i}" for i in range(len(demo_usernames)))
        params = {f"u{i}": u for i, u in enumerate(demo_usernames)}
        await conn.execute(
            text(f"DELETE FROM users WHERE username IN ({placeholders}) AND role != 'superadmin'"),
            params,
        )
    print("✅ 데이터 삭제 완료")

    async with AsyncSessionLocal() as db:
        # 0) superadmin 계정 확인 / 생성 (없으면 자동 생성)
        superadmin = await _create_user(db, SUPERADMIN, None)

        # 1) 기업 확인 / 생성
        result = await db.execute(
            select(Organization).where(Organization.org_code == ORG["org_code"])
        )
        org = result.scalar_one_or_none()
        if org:
            print(f"[SKIP] 기업 '{org.name}' ({org.org_code}) 이미 존재 — id={org.id}")
        else:
            org = Organization(**ORG)
            db.add(org)
            await db.commit()
            await db.refresh(org)
            print(f"[CREATE] 기업 '{org.name}' ({org.org_code}) — id={org.id}")

        org_id = org.id

        # 2) Owner admin
        owner = await _create_user(db, OWNER, org_id)

        # 3) Sub admin
        sub_admin = await _create_user(db, SUB_ADMIN, org_id)

        # 4) Drivers + Locations
        drivers = []
        for d in DRIVERS:
            user = await _create_user(
                db,
                {
                    "username": d["username"],
                    "password": d["password"],
                    "name": d["name"],
                    "phone": d["phone"],
                    "role": UserRole.driver,
                    "is_org_owner": False,
                    "account_status": AccountStatus.approved,
                    "driver_status": "운행가능",
                },
                org_id,
            )
            # 기사 위치(Location) 생성
            loc = Location(
                user_id=user.id,
                lat=d["lat"],
                lon=d["lon"],
                speed=0.0,
                recorded_at=datetime.utcnow(),
            )
            db.add(loc)
            await db.commit()
            print(f"[LOCATION] 기사 {user.name} 위치 ({d['lat']}, {d['lon']}) 저장")
            drivers.append(user)

        # 5) Vehicles (기사 1:1)
        vehicles = []
        for idx, vdata in enumerate(VEHICLES):
            result = await db.execute(
                select(Vehicle).where(Vehicle.plate_number == vdata["plate_number"])
            )
            vehicle = result.scalar_one_or_none()

            # lat/lon 분리
            last_lat = vdata.pop("last_lat", None)
            last_lon = vdata.pop("last_lon", None)

            if vehicle:
                print(f"[SKIP] 차량 {vehicle.plate_number} 이미 존재 — id={vehicle.id}")
            else:
                vehicle = Vehicle(
                    organization_id=org_id,
                    last_lat=last_lat,
                    last_lon=last_lon,
                    **vdata,
                )
                db.add(vehicle)
                await db.commit()
                await db.refresh(vehicle)
                print(f"[CREATE] 차량 {vehicle.plate_number} ({vehicle.vehicle_type}) — id={vehicle.id}")

            # 기사와 차량 연결 (기사 수만큼만)
            if idx < len(drivers):
                driver = drivers[idx]
                if driver.vehicle_id != vehicle.id:
                    driver.vehicle_id = vehicle.id
                    db.add(driver)
                    await db.commit()
                    print(f"[LINK] 기사 {driver.name} → 차량 {vehicle.plate_number}")
            else:
                print(f"[STANDBY] 차량 {vehicle.plate_number} (예비)")
            vehicles.append(vehicle)

        # 6) Customers
        del_result = await db.execute(
            delete(Customer).where(Customer.organization_id == org_id)
        )
        await db.commit()
        print(f"[DELETE] 기존 고객 {del_result.rowcount}건 삭제 완료")

        for cdata in CUSTOMERS:
            customer = Customer(organization_id=org_id, **cdata)
            db.add(customer)
            await db.commit()
            await db.refresh(customer)
            print(f"[CREATE] 고객 '{customer.name}' — id={customer.id}")

        # 7) 휴식지(졸음쉼터) 삽입
        await seed_rest_stops()

        print("\n✅ 시연용 데모 데이터 구성 완료")
        print(f"   기업: {org.name} ({org.org_code})")
        print(f"   대표: {owner.username} / {OWNER['password']}")
        print(f"   부관리자: {sub_admin.username} / {SUB_ADMIN['password']}")
        print(f"   기사: {len(drivers)}명 (driver1~10)")
        print(f"   차량: {len(vehicles)}대")
        print(f"   고객: {len(CUSTOMERS)}명")


async def seed_rest_stops():
    """졸음쉼터 CSV를 읽어 rest_stops 테이블에 삽입 (중복 무시)"""
    csv_path = Path(__file__).parent / "한국도로공사_졸음쉼터_20260225.csv"
    if not csv_path.exists():
        print(f"[SKIP] 휴식지 CSV 없음: {csv_path}")
        return

    inserted = 0
    skipped = 0

    with open(csv_path, encoding="euc-kr", newline="") as f:
        reader = csv.DictReader(f)
        async with engine.begin() as conn:
            for row in reader:
                try:
                    lat = float(row.get("위도") or 0)
                    lon = float(row.get("경도") or 0)
                    name = row.get("졸음쉼터명") or "졸음쉼터"
                    direction = row.get("도로노선방향") or None
                    if direction:
                        direction = direction[:10]

                    if lat == 0 or lon == 0:
                        skipped += 1
                        continue

                    await conn.execute(
                        text("""
                            INSERT INTO rest_stops
                                (name, type, latitude, longitude, direction, is_active, note, created_at)
                            VALUES (:name, 'drowsy_shelter', :lat, :lon, :direction, true, :note, NOW())
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "name": name,
                            "lat": lat,
                            "lon": lon,
                            "direction": direction,
                            "note": row.get("소재지지번주소") or None,
                        },
                    )
                    inserted += 1
                except (ValueError, KeyError):
                    skipped += 1
                    continue

    print(f"[REST_STOP] 졸음쉼터 삽입 완료: {inserted}건 / 스킵: {skipped}건")


async def _create_user(db, data, org_id):
    result = await db.execute(select(User).where(User.username == data["username"]))
    user = result.scalar_one_or_none()
    if user:
        print(f"[SKIP] 사용자 '{user.username}' ({user.name}) 이미 존재 — id={user.id}")
        return user

    payload = data.copy()
    password = payload.pop("password")
    user = User(
        id=uuid.uuid4(),
        organization_id=org_id,
        password_hash=hash_password(password),
        **payload,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    print(f"[CREATE] 사용자 '{user.username}' ({user.name}, {user.role.value}) — id={user.id}")
    return user


if __name__ == "__main__":
    asyncio.run(seed())
