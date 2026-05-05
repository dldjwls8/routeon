"""
RouteOn — GraphHopper 라우팅 엔진 연동 (비동기)
GH HTTP API: http://<GH_BASE>/route
"""

import asyncio
import os
from math import atan2, cos, radians, sin, sqrt

import httpx

GH_BASE = os.getenv("GRAPHHOPPER_BASE_URL", "http://localhost:8989")

_UNREACHABLE_SEC = 10_800_000


async def _call_route(
    client: httpx.AsyncClient,
    origin: dict,
    dest: dict,
    profile: str,
) -> tuple[int, int]:
    """GraphHopper /route API 단일 호출 → (시간초, 거리m)."""
    try:
        resp = await client.get(
            f"{GH_BASE}/route",
            params=[
                ("profile", profile),
                ("point", f"{origin['lat']},{origin['lon']}"),
                ("point", f"{dest['lat']},{dest['lon']}"),
                ("points_encoded", "false"),
                ("type", "json"),
            ],
            timeout=30.0,
        )
        resp.raise_for_status()
        path = resp.json()["paths"][0]
        return int(path["time"] / 1000), int(path["distance"])
    except Exception:
        return _UNREACHABLE_SEC, 0


async def build_time_matrix(
    nodes: list[dict],
    profile: str = "truck",
) -> tuple[list[list[int]], list[list[int]]]:
    """N²-N 병렬 호출로 NxN 시간(초)·거리(m) 행렬을 반환합니다."""
    n = len(nodes)
    pairs = [(i, j) for i in range(n) for j in range(n) if i != j]

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[
            _call_route(client, nodes[i], nodes[j], profile)
            for i, j in pairs
        ])

    time_matrix = [[0] * n for _ in range(n)]
    dist_matrix = [[0] * n for _ in range(n)]
    for (i, j), (t, d) in zip(pairs, results):
        time_matrix[i][j] = t
        dist_matrix[i][j] = d

    return time_matrix, dist_matrix


async def get_route_geometry(
    nodes: list[dict],
    profile: str = "truck",
) -> list[list[float]]:
    """노드 순서대로 경유하는 경로의 [[lat, lon], ...] 좌표를 반환합니다."""
    geo, _, _ = await get_route_with_stats(nodes, profile=profile)
    return geo


async def get_route_with_stats(
    nodes: list[dict],
    profile: str = "truck",
) -> tuple[list[list[float]], int, int]:
    """노드 순서대로 경유하는 경로의 폴리라인·시간(초)·거리(m)를 반환합니다."""
    params = [("profile", profile), ("points_encoded", "false"), ("type", "json")]
    for node in nodes:
        params.append(("point", f"{node['lat']},{node['lon']}"))

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(f"{GH_BASE}/route", params=params)
        resp.raise_for_status()

    path = resp.json()["paths"][0]
    polyline = [[c[1], c[0]] for c in path["points"]["coordinates"]]
    time_sec = int(path["time"] / 1000)
    dist_m = int(path["distance"])
    return polyline, time_sec, dist_m


async def get_travel_time(
    origin: dict, dest: dict, profile: str = "truck"
) -> int:
    """두 지점 간 실제 도로 이동시간(초)을 GH API로 반환합니다."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        t, _ = await _call_route(client, origin, dest, profile)
    return t


def filter_rest_by_route(
    rest_candidates: list[dict],
    polyline: list[list[float]],
    max_km: float = 15.0,
    stride: int = 15,
) -> list[dict]:
    """폴리라인 샘플 점으로부터 max_km 이내 휴게소만 반환합니다. 후보 없으면 전체 반환."""
    if not polyline or not rest_candidates:
        return rest_candidates

    sampled = polyline[::stride]
    if sampled[-1] != polyline[-1]:
        sampled = sampled + [polyline[-1]]

    R = 6_371.0

    def _near(clat: float, clon: float) -> bool:
        clatR = radians(clat)
        for p in sampled:
            dlat = radians(p[0]) - clatR
            dlon = radians(p[1]) - radians(clon)
            a = sin(dlat / 2) ** 2 + cos(clatR) * cos(radians(p[0])) * sin(dlon / 2) ** 2
            if 2 * R * atan2(sqrt(a), sqrt(1 - a)) <= max_km:
                return True
        return False

    filtered = [c for c in rest_candidates if _near(c["latitude"], c["longitude"])]
    return filtered if filtered else rest_candidates
