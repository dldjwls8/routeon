"""
RouteOn — 법정 휴게소 자동 삽입 로직 (비동기)

법적 근거: 화물자동차 운수사업법 시행규칙 [별표3]
- 2시간(7,200초) 연속 운전 시 15분 이상 의무 휴식
- 1시간 40분(6,000초) 도달 시 선제적으로 휴게소 삽입
- 긴급 예외: 최대 3시간 연속 허용, 30분 휴식
"""
from dataclasses import dataclass, field
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Callable, Awaitable

# 법정 상수
REST_PLAN_SEC: int = 6_000    # 1시간 40분 — 선제적 휴게 삽입 임계값
MAX_DRIVE_SEC: int = 7_200    # 2시간 — 법정 최대 연속 운전
MIN_REST_MIN: int  = 15       # 법정 최소 휴식 시간 (분)

# 긴급 예외 상수
EMERGENCY_EXTEND_SEC: int = 3_600   # 1시간 연장 → 최대 3시간
EMERGENCY_REST_MIN: int   = 30      # 긴급 시 의무 휴식 시간 (분)

# Kakao API 미반환 구간 대체값 (kakao_mobility.py와 동일)
_UNREACHABLE_SEC: int = 10_800_000


@dataclass
class RouteNode:
    type: str   # origin | waypoint | destination | rest_stop
    name: str
    lat:  float
    lon:  float
    min_rest_minutes: int | None = field(default=None)

    def to_dict(self) -> dict:
        d = {"type": self.type, "name": self.name, "lat": self.lat, "lon": self.lon}
        if self.min_rest_minutes is not None:
            d["min_rest_minutes"] = self.min_rest_minutes
        return d


def _haversine_sec(
    lat1: float, lon1: float,
    lat2: float, lon2: float,
    avg_speed_kmh: float = 80.0,
) -> int:
    """Haversine 거리 → 소요 시간(초)"""
    R    = 6_371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a    = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    dist_km = 2 * R * atan2(sqrt(a), sqrt(1 - a))
    return int(dist_km / avg_speed_kmh * 3600)


def _pick_best_rest(
    prev: RouteNode, nxt: RouteNode, candidates: list[dict]
) -> dict | None:
    """Haversine 우회 비용 최소 후보 반환 (동기 fallback)"""
    best: dict | None = None
    best_cost = float("inf")
    for c in candidates:
        if not c.get("is_active", True):
            continue
        cost = (
            _haversine_sec(prev.lat, prev.lon, c["latitude"], c["longitude"]) +
            _haversine_sec(c["latitude"], c["longitude"], nxt.lat, nxt.lon)
        )
        if cost < best_cost:
            best_cost = cost
            best = c
    return best


async def insert_rest_stops(
    ordered_nodes: list[RouteNode],
    time_matrix: list[list[int]],
    rest_candidates: list[dict],
    initial_drive_sec: int = 0,
    is_emergency: bool = False,
    picker: Callable[[Any, Any, list[dict]], Awaitable[dict | None]] | None = None,
) -> list[RouteNode]:
    """
    TSP 정렬된 노드 목록에 법정 휴게소를 삽입합니다.

    Args:
        ordered_nodes    : TSP 결과 순서 (출발지 포함 + 목적지 포함)
        time_matrix      : N×N 시간 행렬 (초)
        rest_candidates  : 활성 휴게소 목록
        initial_drive_sec: 현재 누적 운전 시간 (replan 시 전달)
        is_emergency     : 긴급 예외 적용 여부
        picker           : async (prev, nxt, candidates) → dict | None
                           None이면 Haversine 기반 fallback 사용
    """
    plan_threshold = REST_PLAN_SEC
    rest_minutes   = MIN_REST_MIN
    if is_emergency:
        plan_threshold = MAX_DRIVE_SEC + EMERGENCY_EXTEND_SEC  # 10,800초
        rest_minutes   = EMERGENCY_REST_MIN

    result:      list[RouteNode] = []
    accumulated: int             = initial_drive_sec

    for i in range(len(ordered_nodes) - 1):
        result.append(ordered_nodes[i])
        seg_time = time_matrix[i][i + 1]

        # API 미반환 구간은 실제 이동이 없으므로 누적에서 제외
        if seg_time >= _UNREACHABLE_SEC:
            continue

        if accumulated + seg_time >= plan_threshold:
            if picker is not None:
                best = await picker(ordered_nodes[i], ordered_nodes[i + 1], rest_candidates)
            else:
                best = _pick_best_rest(ordered_nodes[i], ordered_nodes[i + 1], rest_candidates)

            if best:
                result.append(RouteNode(
                    type="rest_stop",
                    name=best["name"],
                    lat=best["latitude"],
                    lon=best["longitude"],
                    min_rest_minutes=rest_minutes,
                ))
                accumulated = 0  # 삽입 성공 시만 리셋
            else:
                accumulated += seg_time  # 후보 없으면 계속 누적
        else:
            accumulated += seg_time

    result.append(ordered_nodes[-1])
    return result