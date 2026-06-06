import uuid as uuid_lib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import (
    User, Trip, Vehicle, RestStop, Delivery,
    TripStatus, DeliveryStatus, UserRole,
)
from auth import get_current_user
from services.optimizer import solve_tsp, validate_tsp_constraints
from services.rest_stop_inserter import RouteNode, insert_rest_stops
from services import graphhopper as gh_svc
from core.managers import manager, redis
from core.utils import _coord_to_address
from schemas import WaypointSchema

router = APIRouter()

class ExtraStopSchema(BaseModel):
    stop_type: str   # waypoint | destination | rest_preferred
    name: str
    lat:  float
    lon:  float
    note: Optional[str] = None

class OptimizeRequest(BaseModel):
    trip_id:           str
    origin_name:       Optional[str]   = None   # 미입력 시 Redis 현재위치 사용
    origin_lat:        Optional[float] = None
    origin_lon:        Optional[float] = None
    initial_drive_sec: int   = 0
    is_emergency:      bool  = False
    route_mode:        str   = "auto"   # auto | local | long_distance
    vehicle_height_m:  Optional[float] = None
    vehicle_weight_kg: Optional[float] = None
    vehicle_length_cm: Optional[float] = None
    vehicle_width_cm:  Optional[float] = None
    extra_stops:       Optional[list[ExtraStopSchema]] = None
    dest_name:         Optional[str]   = None   # 기사가 직접 지정하는 도착지 (선택)
    dest_lat:          Optional[float] = None
    dest_lon:          Optional[float] = None

class ReplanRequest(BaseModel):
    trip_id:             str
    current_name:        Optional[str] = None
    current_lat:         float
    current_lon:         float
    current_drive_sec:   int
    remaining_waypoints: list[WaypointSchema]
    dest_name:           str
    dest_lat:            float
    dest_lon:            float
    is_emergency:        bool = False
    route_mode:          str  = "auto"   # auto | local | long_distance

def _resolve_dest(
    req: "OptimizeRequest",
    t: "Trip",
    waypoints_raw: list[dict],
) -> tuple[str, float, float, int | None]:
    """
    도착지 결정 우선순위:
    1. req.dest_* (기사 직접 지정)
    2. t.dest_* (관리자가 설정한 기존 목적지)
    3. waypoints_raw 중 type=unloading 인 마지막 항목 (자동)
    4. waypoints_raw 중 type=loading  인 마지막 항목 (자동 폴백)
    반환: (dest_name, dest_lat, dest_lon, auto_selected_index or None)
    """
    if req.dest_name and req.dest_lat is not None and req.dest_lon is not None:
        # 기사가 지정한 좌표와 일치하는 waypoint가 있으면 pop해서 중복 방지
        for i, w in enumerate(waypoints_raw):
            if abs(w["lat"] - req.dest_lat) < 1e-6 and abs(w["lon"] - req.dest_lon) < 1e-6:
                return req.dest_name, req.dest_lat, req.dest_lon, i
        return req.dest_name, req.dest_lat, req.dest_lon, None
    if t.dest_name and t.dest_lat is not None and t.dest_lon is not None:
        # 관리자 설정 도착지도 같은 방식으로 중복 체크
        for i, w in enumerate(waypoints_raw):
            if abs(w["lat"] - t.dest_lat) < 1e-6 and abs(w["lon"] - t.dest_lon) < 1e-6:
                return t.dest_name, t.dest_lat, t.dest_lon, i
        return t.dest_name, t.dest_lat, t.dest_lon, None
    # 자동 선택: 마지막 unloading → 없으면 마지막 loading
    for wp_type in ("unloading", "loading"):
        for i in range(len(waypoints_raw) - 1, -1, -1):
            w = waypoints_raw[i]
            if w.get("type", "unloading") == wp_type:
                return w["name"], w["lat"], w["lon"], i
    raise HTTPException(400, "도착지를 지정하거나 하차지를 1개 이상 추가해주세요.")



@router.post("/optimize")
async def optimize(req: OptimizeRequest, db: AsyncSession = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    """기사가 출발 시 호출. 경유지 순서 최적화 + 휴게소 삽입 후 최적 경로 반환."""
    import uuid as uuid_lib
    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(req.trip_id)))
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    # 출발지 결정: 직접입력 우선, 미입력 시 Redis 현재위치 사용
    origin_name = req.origin_name
    origin_lat  = req.origin_lat
    origin_lon  = req.origin_lon
    if origin_lat is None or origin_lon is None:
        loc_val = redis.get(f"location:{current_user.id}")
        if not loc_val:
            raise HTTPException(
                400,
                "현재 위치 정보가 없습니다. GPS를 활성화하거나 출발지를 직접 입력해주세요."
            )
        lat_str, lon_str = loc_val.split(",")
        origin_lat  = float(lat_str)
        origin_lon  = float(lon_str)
    if not origin_name:
        origin_name = await _coord_to_address(origin_lat, origin_lon)

    # 노드 구성 (extra_stops 처리 포함)
    waypoints_raw: list[dict] = list(t.waypoints or [])
    extra_stops    = req.extra_stops or []
    new_dest_extra = None
    preferred_rest: list[dict] = []

    for es in extra_stops:
        if es.stop_type == "waypoint":
            waypoints_raw.append({"name": es.name, "lat": es.lat, "lon": es.lon, "type": "unloading"})
        elif es.stop_type == "destination":
            if t.dest_name:
                waypoints_raw.append({"name": t.dest_name, "lat": t.dest_lat, "lon": t.dest_lon, "type": "unloading"})
            new_dest_extra = es
        elif es.stop_type == "rest_preferred":
            preferred_rest.append({"name": es.name, "latitude": es.lat, "longitude": es.lon, "is_active": True})

    # B2 수정: 도착지 자동 선택 시 waypoints_raw에서 해당 항목 제거
    if new_dest_extra:
        dest_name = new_dest_extra.name
        dest_lat  = new_dest_extra.lat
        dest_lon  = new_dest_extra.lon
        auto_idx  = None
    else:
        dest_name, dest_lat, dest_lon, auto_idx = _resolve_dest(req, t, waypoints_raw)
        if auto_idx is not None:
            waypoints_raw.pop(auto_idx)

    nodes = [{"name": origin_name, "lat": origin_lat, "lon": origin_lon}]
    nodes += waypoints_raw
    nodes.append({"name": dest_name, "lat": dest_lat, "lon": dest_lon})

    try:
        time_matrix, dist_matrix = await gh_svc.build_time_matrix(nodes, profile="truck")
    except Exception as e:
        raise HTTPException(502, f"GraphHopper API 오류: {e}")

    # task_group 기반 pickup_deliveries 추출
    # (origin=index 0, dest=마지막 index는 제외)
    _tg_loadings: dict[int, int] = {}
    _tg_unloadings: dict[int, list[int]] = {}
    for _ni, _nd in enumerate(nodes[1:-1], start=1):
        tg = _nd.get("task_group")
        if tg is None:
            continue
        if _nd.get("type") == "loading":
            _tg_loadings[tg] = _ni
        else:
            _tg_unloadings.setdefault(tg, []).append(_ni)
    pickup_deliveries = [
        (ld_idx, ul_idx)
        for tg, ld_idx in _tg_loadings.items()
        for ul_idx in _tg_unloadings.get(tg, [])
    ] or None

    node_names = [n["name"] for n in nodes]
    violation = validate_tsp_constraints(
        time_matrix, pickup_deliveries=pickup_deliveries, node_names=node_names
    )
    if violation:
        code, msg = violation
        raise HTTPException(code, msg)

    tsp_order = solve_tsp(time_matrix, pickup_deliveries=pickup_deliveries)
    if tsp_order is None:
        raise HTTPException(422, "경로 계산 실패: 가능한 경로가 없습니다.")
    dest_idx = len(nodes) - 1
    k        = len(tsp_order)
    ordered  = [
        RouteNode(
            type="origin" if idx == 0 else "waypoint",
            name=nodes[idx]["name"],
            lat=nodes[idx]["lat"],
            lon=nodes[idx]["lon"],
            node_type=nodes[idx].get("type", "unloading") if idx != 0 else "loading",
        )
        for idx in tsp_order
    ] + [RouteNode(type="destination", name=dest_name, lat=dest_lat, lon=dest_lon)]

    # 시간·거리 행렬 재배열
    n_o            = len(ordered)
    reordered      = [[0] * n_o for _ in range(n_o)]
    reordered_dist = [[0] * n_o for _ in range(n_o)]
    for i in range(k):
        for j in range(k):
            reordered[i][j]      = time_matrix[tsp_order[i]][tsp_order[j]]
            reordered_dist[i][j] = dist_matrix[tsp_order[i]][tsp_order[j]]
        reordered[i][k]      = time_matrix[tsp_order[i]][dest_idx]
        reordered_dist[i][k] = dist_matrix[tsp_order[i]][dest_idx]

    # 휴게소 조회 (highway_rest만 사용)
    _rr = await db.execute(
        select(RestStop).where(RestStop.is_active == True, RestStop.type == "highway_rest")
    )
    rest_candidates = preferred_rest + [
        {"name": r.name, "latitude": r.latitude, "longitude": r.longitude, "is_active": True,
         "type": r.type}
        for r in _rr.scalars().all()
    ]

    final_route = await insert_rest_stops(
        ordered, reordered, rest_candidates,
        initial_drive_sec=req.initial_drive_sec,
        is_emergency=req.is_emergency,
        time_fn=gh_svc.get_travel_time,
    )

    # 총 거리·시간 계산
    total_sec     = sum(reordered[i][i + 1] for i in range(len(ordered) - 1))
    total_dist_km = sum(reordered_dist[i][i + 1] for i in range(len(ordered) - 1)) / 1000

    route_dicts = [node.to_dict() for node in final_route]
    t.optimized_route = {
        "route": route_dicts,
        "estimated_duration_min": round(total_sec / 60, 1),
        "total_distance_km": round(total_dist_km, 2),
    }
    t.origin_name = origin_name
    t.origin_lat  = origin_lat
    t.origin_lon  = origin_lon
    t.status      = TripStatus.in_progress
    t.current_phase = "en_route_to_loading"
    t.phase_updated_at = datetime.utcnow()
    t.is_emergency = req.is_emergency
    if not t.started_at:
        t.started_at = datetime.utcnow()

    for i, node in enumerate(final_route):
        if node.type == "waypoint":
            _r2 = await db.execute(
                select(Delivery).where(
                    Delivery.trip_id == t.id,
                    Delivery.lat.between(node.lat - 0.0001, node.lat + 0.0001),
                    Delivery.lon.between(node.lon - 0.0001, node.lon + 0.0001),
                )
            )
            for d in _r2.scalars().all():
                d.sequence = i
                d.status   = DeliveryStatus.in_progress
    await db.commit()
    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "type": "trip.started",
            "driver_id": str(current_user.id),
            "trip_id": str(t.id),
        })

    return {
        "trip_id":                str(t.id),
        "route":                  route_dicts,
        "total_distance_km":      round(total_dist_km, 2),
        "estimated_duration_min": round(total_sec / 60, 1),
        "rest_stops_count":       sum(1 for nd in final_route if nd.type == "rest_stop"),
        "is_emergency":           req.is_emergency,
    }

@router.post("/optimize/replan")
async def replan(req: ReplanRequest, db: AsyncSession = Depends(get_db),
           current_user: User = Depends(get_current_user)):
    """운행 중 재경로 계산."""
    import uuid as uuid_lib
    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(req.trip_id)))
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    current_name = req.current_name or await _coord_to_address(req.current_lat, req.current_lon)
    nodes = [{"name": current_name, "lat": req.current_lat, "lon": req.current_lon}]
    nodes += [{"name": w.name, "lat": w.lat, "lon": w.lon,
               "type": w.type, "task_group": w.task_group} for w in req.remaining_waypoints]
    nodes.append({"name": req.dest_name, "lat": req.dest_lat, "lon": req.dest_lon})

    try:
        time_matrix, dist_matrix = await gh_svc.build_time_matrix(nodes, profile="truck")
    except Exception as e:
        raise HTTPException(502, f"GraphHopper API 오류: {e}")

    # task_group 기반 pickup_deliveries 추출
    _tg_l2: dict[int, int] = {}
    _tg_u2: dict[int, list[int]] = {}
    for _ni, _nd in enumerate(nodes[1:-1], start=1):
        tg = _nd.get("task_group")
        if tg is None:
            continue
        if _nd.get("type") == "loading":
            _tg_l2[tg] = _ni
        else:
            _tg_u2.setdefault(tg, []).append(_ni)
    replan_pd = [
        (ld, ul)
        for tg, ld in _tg_l2.items()
        for ul in _tg_u2.get(tg, [])
    ] or None

    tsp_order = solve_tsp(time_matrix, pickup_deliveries=replan_pd)
    if tsp_order is None:
        raise HTTPException(422, "재경로 계산 실패: 가능한 경로가 없습니다.")
    dest_idx  = len(nodes) - 1
    k         = len(tsp_order)
    ordered   = [
        RouteNode(type="origin" if idx == 0 else "waypoint",
                  name=nodes[idx]["name"], lat=nodes[idx]["lat"], lon=nodes[idx]["lon"])
        for idx in tsp_order
    ] + [RouteNode(type="destination", name=req.dest_name, lat=req.dest_lat, lon=req.dest_lon)]

    n_o            = len(ordered)
    reordered      = [[0] * n_o for _ in range(n_o)]
    reordered_dist = [[0] * n_o for _ in range(n_o)]
    for i in range(k):
        for j in range(k):
            reordered[i][j]      = time_matrix[tsp_order[i]][tsp_order[j]]
            reordered_dist[i][j] = dist_matrix[tsp_order[i]][tsp_order[j]]
        reordered[i][k]      = time_matrix[tsp_order[i]][dest_idx]
        reordered_dist[i][k] = dist_matrix[tsp_order[i]][dest_idx]

    _rr = await db.execute(
        select(RestStop).where(RestStop.is_active == True, RestStop.type == "highway_rest")
    )
    rest_candidates = [
        {"name": r.name, "latitude": r.latitude, "longitude": r.longitude, "is_active": True,
         "type": r.type}
        for r in _rr.scalars().all()
    ]
    final_route = await insert_rest_stops(
        ordered, reordered, rest_candidates,
        initial_drive_sec=req.current_drive_sec,
        is_emergency=req.is_emergency,
        time_fn=gh_svc.get_travel_time,
    )

    total_sec     = sum(reordered[i][i + 1] for i in range(len(ordered) - 1))
    total_dist_km = sum(reordered_dist[i][i + 1] for i in range(len(ordered) - 1)) / 1000

    route_dicts = [node.to_dict() for node in final_route]
    t.optimized_route = {
        "route": route_dicts,
        "estimated_duration_min": round(total_sec / 60, 1),
        "total_distance_km": round(total_dist_km, 2),
    }
    t.is_emergency = req.is_emergency
    await db.commit()
    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "type": "trip.replanned",
            "driver_id": str(current_user.id),
            "trip_id": str(t.id),
        })

    return {
        "trip_id":                str(t.id),
        "route":                  route_dicts,
        "total_distance_km":      round(total_dist_km, 2),
        "estimated_duration_min": round(total_sec / 60, 1),
        "rest_stops_count":       sum(1 for nd in final_route if nd.type == "rest_stop"),
        "is_emergency":           req.is_emergency,
    }


# ────────────────────────────────────────────────
