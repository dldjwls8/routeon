"""
RouteOn — 카카오 모빌리티 API 연동 (비동기)
카카오 모빌리티 API: https://apis-navi.kakaomobility.com/v1
"""

import asyncio
import os
from datetime import datetime
from math import atan2, cos, radians, sin, sqrt
from typing import Any

import httpx
from cachetools import TTLCache

KAKAO_BASE     = "https://apis-navi.kakaomobility.com/v1"
KAKAO_REST_KEY = os.getenv("KAKAO_REST_API_KEY", "")

# 경로 탐색 실패 시 대체값 — TSP에서 사실상 제외
_UNREACHABLE_SEC = 10_800_000
_LOCAL_RADIUS_M  = 10_000

# TTL 캐시 (1시간)
_cache_realtime: TTLCache = TTLCache(maxsize=2_000, ttl=3_600)
_cache_future:   TTLCache = TTLCache(maxsize=2_000, ttl=3_600)
_cache_multi:    TTLCache = TTLCache(maxsize=500,   ttl=3_600)


# ────────────────────────────────────────────────
# 내부 API 호출 함수
# ────────────────────────────────────────────────
async def _get_route_time_future(
    client: httpx.AsyncClient,
    origin_lat: float, origin_lon: float,
    dest_lat:   float, dest_lon:   float,
    *,
    departure_time: str,
    car_type: int = 4,
) -> tuple[int, int]:
    """미래 운행 정보 API → (소요시간초, 거리m)"""
    try:
        dt     = datetime.fromisoformat(departure_time)
        dt_str = dt.strftime("%Y%m%d%H%M")
    except ValueError:
        dt_str = departure_time[:12]

    cache_key = (round(origin_lat, 5), round(origin_lon, 5),
                 round(dest_lat, 5),   round(dest_lon, 5), dt_str, car_type)
    if cache_key in _cache_future:
        return _cache_future[cache_key]

    resp = await client.get(
        f"{KAKAO_BASE}/future/directions",
        params={
            "origin":         f"{origin_lon},{origin_lat}",
            "destination":    f"{dest_lon},{dest_lat}",
            "departure_time": dt_str,
            "car_type":       car_type,
            "summary":        "true",
        },
        headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
    )
    resp.raise_for_status()
    route = resp.json()["routes"][0]
    if route.get("result_code", -1) != 0:
        result = (_UNREACHABLE_SEC, 0)
    else:
        s = route["summary"]
        result = (int(s["duration"]), int(s["distance"]))
    _cache_future[cache_key] = result
    return result


async def _get_route_time_realtime(
    client: httpx.AsyncClient,
    origin_lat: float, origin_lon: float,
    dest_lat:   float, dest_lon:   float,
    car_type: int = 4,
) -> tuple[int, int]:
    """실시간 자동차 길찾기 API → (소요시간초, 거리m)"""
    cache_key = (round(origin_lat, 5), round(origin_lon, 5),
                 round(dest_lat, 5),   round(dest_lon, 5), car_type)
    if cache_key in _cache_realtime:
        return _cache_realtime[cache_key]

    resp = await client.get(
        f"{KAKAO_BASE}/directions",
        params={
            "origin":      f"{origin_lon},{origin_lat}",
            "destination": f"{dest_lon},{dest_lat}",
            "car_type":    car_type,
            "summary":     "true",
        },
        headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
    )
    resp.raise_for_status()
    route = resp.json()["routes"][0]
    if route.get("result_code", -1) != 0:
        result = (_UNREACHABLE_SEC, 0)
    else:
        s = route["summary"]
        result = (int(s["duration"]), int(s["distance"]))
    _cache_realtime[cache_key] = result
    return result


async def _get_row_times_multi_dest(
    client: httpx.AsyncClient,
    origin: dict,
    destinations: list[dict],
    dest_indices: list[int],
) -> list[tuple[int, int, int]]:
    """다중 목적지 API → [(dest_index, duration_sec, distance_m), ...]"""
    orig_key  = (round(origin["lat"], 5), round(origin["lon"], 5))
    dest_keys = tuple((round(d["lat"], 5), round(d["lon"], 5)) for d in destinations)
    cache_key = (orig_key, dest_keys)

    if cache_key in _cache_multi:
        cached_dur, cached_dist = _cache_multi[cache_key]
        return [(dest_indices[i], cached_dur[i], cached_dist[i]) for i in range(len(dest_indices))]

    body = {
        "origin": {"x": str(origin["lon"]), "y": str(origin["lat"])},
        "destinations": [
            {"x": str(d["lon"]), "y": str(d["lat"]), "key": str(idx)}
            for idx, d in zip(dest_indices, destinations)
        ],
        "radius":   _LOCAL_RADIUS_M,
        "priority": "TIME",
    }
    resp = await client.post(
        f"{KAKAO_BASE}/destinations/directions",
        json=body,
        headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
    )
    resp.raise_for_status()

    results:   list[tuple[int, int, int]] = []
    durations: list[int] = [_UNREACHABLE_SEC] * len(destinations)
    distances: list[int] = [0] * len(destinations)

    for route in resp.json()["routes"]:
        j = int(route["key"])
        if route.get("result_code", -1) == 0:
            dur  = int(route["summary"]["duration"])
            dist = int(route["summary"]["distance"])
        else:
            dur, dist = _UNREACHABLE_SEC, 0
        results.append((j, dur, dist))
        if j in dest_indices:
            pos = dest_indices.index(j)
            durations[pos] = dur
            distances[pos] = dist

    _cache_multi[cache_key] = (tuple(durations), tuple(distances))
    return results


# ────────────────────────────────────────────────
# N×N 시간·거리 행렬
# ────────────────────────────────────────────────
def auto_detect_route_mode(nodes: list[dict]) -> str:
    """노드 간 최대 직선 거리로 local / long_distance 자동 결정 (50km 기준)"""
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            if _haversine_km(nodes[i]["lat"], nodes[i]["lon"],
                             nodes[j]["lat"], nodes[j]["lon"]) >= 50.0:
                return "long_distance"
    return "local"


async def build_time_matrix(
    nodes: list[dict],
    *,
    route_mode: str = "auto",
    departure_time: str | None = None,
    car_type: int = 4,
    height_m: float | None = None,
    weight_kg: float | None = None,
    length_cm: float | None = None,
    width_cm: float | None = None,
) -> tuple[list[list[int]], list[list[int]]]:
    """
    N×N (시간 행렬, 거리 행렬) 반환.

    route_mode:
      - "auto"          : 노드 간 거리로 자동 결정
      - "local"         : 다중 목적지 API (반경 10km 이내)
      - "long_distance" : 개별 길찾기 API (N²-N회)
    """
    if route_mode == "auto":
        route_mode = auto_detect_route_mode(nodes)

    n           = len(nodes)
    matrix      = [[0] * n for _ in range(n)]
    dist_matrix = [[0] * n for _ in range(n)]

    async with httpx.AsyncClient(timeout=15.0) as client:
        if departure_time:
            async def fetch_future(i: int, j: int) -> tuple[int, int, int, int]:
                dur, dist = await _get_route_time_future(
                    client,
                    nodes[i]["lat"], nodes[i]["lon"],
                    nodes[j]["lat"], nodes[j]["lon"],
                    departure_time=departure_time, car_type=car_type,
                )
                return i, j, dur, dist

            tasks = [fetch_future(i, j) for i in range(n) for j in range(n) if i != j]
            for i, j, dur, dist in await asyncio.gather(*tasks):
                matrix[i][j]      = dur
                dist_matrix[i][j] = dist

        elif route_mode == "local":
            async def fetch_row(i: int) -> tuple[int, list[tuple[int, int, int]]]:
                dest_indices = [j for j in range(n) if j != i]
                dest_nodes   = [nodes[j] for j in dest_indices]
                return i, await _get_row_times_multi_dest(client, nodes[i], dest_nodes, dest_indices)

            rows = await asyncio.gather(*[fetch_row(i) for i in range(n)])
            for i, row_results in rows:
                for j, dur, dist in row_results:
                    matrix[i][j]      = dur
                    dist_matrix[i][j] = dist

        else:  # long_distance
            async def fetch_long(i: int, j: int) -> tuple[int, int, int, int]:
                dur, dist = await _get_route_time_realtime(
                    client,
                    nodes[i]["lat"], nodes[i]["lon"],
                    nodes[j]["lat"], nodes[j]["lon"],
                    car_type=car_type,
                )
                return i, j, dur, dist

            tasks = [fetch_long(i, j) for i in range(n) for j in range(n) if i != j]
            for i, j, dur, dist in await asyncio.gather(*tasks):
                matrix[i][j]      = dur
                dist_matrix[i][j] = dist

    return matrix, dist_matrix


# ────────────────────────────────────────────────
# 유틸리티
# ────────────────────────────────────────────────
def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R    = 6_371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a    = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


async def find_best_rest_stop(
    prev: Any,
    nxt: Any,
    candidates: list[dict],
    pre_filter_km: float = 50.0,
) -> dict | None:
    """
    2단계 휴게소 후보 선택:
    1. Haversine으로 구간 중간지점 기준 pre_filter_km 이내 사전 필터
    2. 다중 목적지 API로 실제 도로 소요시간 기준 최적 후보 반환
    API 실패 시 Haversine fallback
    """
    active = [c for c in candidates if c.get("is_active", True)]
    if not active:
        return None

    # 1. Haversine 사전 필터
    mid_lat = (prev.lat + nxt.lat) / 2
    mid_lon = (prev.lon + nxt.lon) / 2
    filtered = [
        c for c in active
        if _haversine_km(mid_lat, mid_lon, c["latitude"], c["longitude"]) <= pre_filter_km
    ]
    if not filtered:
        return min(active, key=lambda c: (
            _haversine_km(prev.lat, prev.lon, c["latitude"], c["longitude"]) +
            _haversine_km(c["latitude"], c["longitude"], nxt.lat, nxt.lon)
        ))

    # 2. 다중 목적지 API로 최적 후보 선택
    _BATCH    = 30
    prev_dict = {"lat": prev.lat, "lon": prev.lon}
    nxt_dict  = {"lat": nxt.lat,  "lon": nxt.lon}
    times: dict[int, list[int]] = {
        i: [_UNREACHABLE_SEC, _UNREACHABLE_SEC] for i in range(len(filtered))
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            for start in range(0, len(filtered), _BATCH):
                batch      = filtered[start: start + _BATCH]
                indices    = list(range(start, start + len(batch)))
                dest_nodes = [{"lat": c["latitude"], "lon": c["longitude"]} for c in batch]

                for idx, t, _ in await _get_row_times_multi_dest(client, prev_dict, dest_nodes, indices):
                    times[idx][0] = t
                for idx, t, _ in await _get_row_times_multi_dest(client, nxt_dict, dest_nodes, indices):
                    times[idx][1] = t
    except Exception:
        return min(filtered, key=lambda c: (
            _haversine_km(prev.lat, prev.lon, c["latitude"], c["longitude"]) +
            _haversine_km(c["latitude"], c["longitude"], nxt.lat, nxt.lon)
        ))

    best_idx = min(times, key=lambda i: times[i][0] + times[i][1])
    return filtered[best_idx]