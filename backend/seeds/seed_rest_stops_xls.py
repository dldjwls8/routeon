"""
휴게소·공영차고지·물류단지 XLS → DB 시드 스크립트
주소 → 좌표: 카카오 로컬 API (geocoding)

실행:
    sudo docker exec routeon-api python seeds/seed_rest_stops_xls.py
"""
import asyncio
import os
from pathlib import Path

import asyncpg
import aiohttp
import xlrd

POSTGRES_USER     = os.getenv("POSTGRES_USER", "routeon")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")
POSTGRES_HOST     = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT     = os.getenv("POSTGRES_PORT", "5433")
POSTGRES_DB       = os.getenv("POSTGRES_DB", "routeon")
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")

DATABASE_URL = (
    f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
    f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
)

SEEDS_DIR = Path(__file__).parent

# (파일명, 타입, 주소컬럼, 이름컬럼, 상태컬럼, 허용상태목록)
FILES = [
    (
        "휴게소정보_260325.xls",
        "highway_rest",
        "주소",
        "휴게소명",
        "구분",
        {"운영중"},
    ),
    (
        "공영차고지정보_260325.xls",
        "truck_yard",
        "주소",
        "공영차고지명",
        "구분",
        {"운영중"},
    ),
    (
        "물류단지정보_260325.xls",
        "logistics_park",
        "주소",
        "물류시설명",
        "구분",
        {"운영중"},
    ),
]


async def geocode(session: aiohttp.ClientSession, address: str) -> tuple[float, float] | None:
    """카카오 로컬 API로 주소를 좌표로 변환. 실패 시 None 반환."""
    url = "https://dapi.kakao.com/v2/local/search/address.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    try:
        async with session.get(url, params={"query": address}, headers=headers) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            docs = data.get("documents", [])
            if not docs:
                # 주소 검색 실패 시 키워드 검색으로 재시도
                url2 = "https://dapi.kakao.com/v2/local/search/keyword.json"
                async with session.get(url2, params={"query": address}, headers=headers) as resp2:
                    if resp2.status != 200:
                        return None
                    data2 = await resp2.json()
                    docs2 = data2.get("documents", [])
                    if not docs2:
                        return None
                    return float(docs2[0]["y"]), float(docs2[0]["x"])
            return float(docs[0]["y"]), float(docs[0]["x"])
    except Exception:
        return None


async def seed_file(
    conn: asyncpg.Connection,
    session: aiohttp.ClientSession,
    fname: str,
    rs_type: str,
    addr_col: str,
    name_col: str,
    status_col: str,
    allowed_status: set[str],
) -> tuple[int, int, int]:
    path = SEEDS_DIR / fname
    if not path.exists():
        print(f"  ❌ 파일 없음: {path}")
        return 0, 0, 0

    wb = xlrd.open_workbook(str(path))
    ws = wb.sheet_by_index(0)
    headers = ws.row_values(0)

    try:
        name_idx   = headers.index(name_col)
        addr_idx   = headers.index(addr_col)
        status_idx = headers.index(status_col)
    except ValueError as e:
        print(f"  ❌ 컬럼 없음: {e}")
        return 0, 0, 0

    inserted = skipped_status = skipped_geocode = 0

    for r in range(1, ws.nrows):
        row = ws.row_values(r)
        status = str(row[status_idx]).strip()
        if status not in allowed_status:
            skipped_status += 1
            continue

        name    = str(row[name_idx]).strip() or "이름없음"
        address = str(row[addr_idx]).strip()
        if not address:
            skipped_geocode += 1
            continue

        coords = await geocode(session, address)
        if coords is None:
            print(f"  ⚠️  좌표 변환 실패: {name} ({address})")
            skipped_geocode += 1
            continue

        lat, lon = coords
        await conn.execute(
            """
            INSERT INTO rest_stops
                (name, type, latitude, longitude, direction, is_active, note, created_at)
            VALUES ($1, $2, $3, $4, NULL, true, $5, NOW())
            ON CONFLICT DO NOTHING
            """,
            name, rs_type, lat, lon, address,
        )
        inserted += 1

    return inserted, skipped_status, skipped_geocode


async def main() -> None:
    if not KAKAO_REST_API_KEY:
        print("❌ KAKAO_REST_API_KEY 환경변수가 없습니다.")
        return

    conn = await asyncpg.connect(DATABASE_URL)
    async with aiohttp.ClientSession() as session:
        for fname, rs_type, addr_col, name_col, status_col, allowed in FILES:
            print(f"\n▶ {fname} ({rs_type})")
            ins, sk_st, sk_geo = await seed_file(
                conn, session, fname, rs_type, addr_col, name_col, status_col, allowed
            )
            print(f"  ✅ 삽입: {ins}건 | 상태 필터: {sk_st}건 | 좌표 실패: {sk_geo}건")

    total = await conn.fetchval("SELECT COUNT(*) FROM rest_stops")
    print(f"\n📊 rest_stops 총 {total}건")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
