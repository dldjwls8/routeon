"""
졸음쉼터 시드 스크립트
팀원 A 코드 기반, 우리 환경변수 체계에 맞게 수정

실행:
    sudo docker exec routeon-api python seeds/seed_rest_stops.py
"""
import asyncio
import csv
import os
from pathlib import Path

import asyncpg

# ── DB 연결 설정 ──────────────────────────────────────────────
POSTGRES_USER     = os.getenv("POSTGRES_USER", "routeon")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")
POSTGRES_HOST     = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT     = os.getenv("POSTGRES_PORT", "5433")
POSTGRES_DB       = os.getenv("POSTGRES_DB", "routeon")

DATABASE_URL = (
    f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

SEEDS_DIR  = Path(__file__).parent
DROWSY_CSV = SEEDS_DIR / "한국도로공사_졸음쉼터_20260225.csv"


async def seed() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        inserted = 0
        skipped  = 0

        if not DROWSY_CSV.exists():
            print(f"❌ CSV 파일 없음: {DROWSY_CSV}")
            return

        with open(DROWSY_CSV, encoding="euc-kr", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    lat  = float(row.get("위도") or 0)
                    lon  = float(row.get("경도") or 0)
                    name = row.get("졸음쉼터명") or "졸음쉼터"
                    direction = row.get("도로노선방향") or None
                    if direction:
                        direction = direction[:10]  # VARCHAR(10) 제한

                    if lat == 0 or lon == 0:
                        skipped += 1
                        continue

                    await conn.execute(
                        """
                        INSERT INTO rest_stops
                            (name, type, latitude, longitude, direction, is_active, note, created_at)
                        VALUES ($1, 'drowsy_shelter', $2, $3, $4, true, $5, NOW())
                        ON CONFLICT DO NOTHING
                        """,
                        name, lat, lon, direction,
                        row.get("소재지지번주소") or None,
                    )
                    inserted += 1

                except (ValueError, KeyError) as e:
                    skipped += 1
                    continue

        print(f"✅ 졸음쉼터 삽입 완료: {inserted}건 / 스킵: {skipped}건")

        # 총 건수 확인
        total = await conn.fetchval("SELECT COUNT(*) FROM rest_stops")
        print(f"📊 rest_stops 총 {total}건")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())