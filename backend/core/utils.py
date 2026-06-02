import math
from typing import Any

import httpx

from core.config import KAKAO_BASE, KAKAO_REST_KEY


def _haversine(a: Any, b: Any) -> float:
    """두 LatLng 사이의 거리(미터)를 반환."""
    R = 6_371_000
    lat1, lon1 = math.radians(a.lat), math.radians(a.lon)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lon)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(h))


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 좌표 사이의 거리(km)를 반환."""
    R = 6_371.0
    rlat1, rlon1 = math.radians(lat1), math.radians(lon1)
    rlat2, rlon2 = math.radians(lat2), math.radians(lon2)
    dlat, dlon = rlat2 - rlat1, rlon2 - rlon1
    h = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(h))

async def _coord_to_address(lat: float, lon: float) -> str:
    """카카오 역지오코딩 — 좌표 → 도로명주소(없으면 지번주소) 반환. 실패 시 좌표 문자열 폴백."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{KAKAO_BASE}/v2/local/geo/coord2address.json",
                params={"x": lon, "y": lat},
                headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
            )
        docs = r.json().get("documents", [])
        if docs:
            addr = docs[0]
            road = addr.get("road_address")
            if road:
                return road.get("address_name", "")
            return addr.get("address", {}).get("address_name", "")
    except Exception:
        pass
    return f"{lat:.5f}, {lon:.5f}"
