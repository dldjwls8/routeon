"""
RouteOn Backend — FastAPI
경로 최적화 + 배송 관리 + GPS 위치 수신
"""

import os
import math
import httpx
import redis as redis_client
import shutil
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db, init_db
from models import (
    User, Delivery, Trip, Vehicle, RestStop, Location, Organization,
    DeliveryStatus, TripStatus, RestStopType, UserRole, OrgStatus
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, require_admin, require_driver, require_superadmin,
)
from services.optimizer import solve_tsp
from services.rest_stop_inserter import RouteNode, insert_rest_stops
from services.email_service import send_approved, send_rejected
from services import kakao_mobility

# ────────────────────────────────────────────────
# Redis 연결
# ────────────────────────────────────────────────
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
redis      = redis_client.Redis(host=REDIS_HOST, port=6379, decode_responses=True)

ARRIVAL_RADIUS_M = 50  # 도착 감지 반경 (m)

# 파일 업로드 설정
UPLOAD_DIR      = Path("/app/uploads/docs")
ALLOWED_EXTS    = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE   = 10 * 1024 * 1024  # 10MB
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ────────────────────────────────────────────────
# WebSocket 연결 관리
# ────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        """연결된 모든 관리자 웹에 위치 데이터 전송"""
        import json
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(json.dumps(data, ensure_ascii=False))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

# ────────────────────────────────────────────────
# 앱 시작 시 DB 초기화
# ────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

# ────────────────────────────────────────────────
# 앱 설정
# ────────────────────────────────────────────────
app = FastAPI(
    title="RouteOn API",
    description="배송 최적화 서비스 — 경로 최적화 + 배송 관리 + GPS",
    version="0.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# 500 에러에도 CORS 헤더가 붙도록 exception handler 추가
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )

KAKAO_BASE = "https://dapi.kakao.com"
KAKAO_REST_KEY = os.getenv("KAKAO_REST_API_KEY", "")
KAKAO_JS_KEY   = os.getenv("KAKAO_JS_KEY", "")



# ────────────────────────────────────────────────
# 스키마
# ────────────────────────────────────────────────
class LatLng(BaseModel):
    lat: float
    lon: float
    name: Optional[str] = None

class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    waypoints: list[LatLng] = []
    vehicle_type: str = "car"
    optimize: bool = True

class OptimizeRequest(BaseModel):
    stops: list[LatLng]
    vehicle_type: str = "car"
    rest_interval: int = 5
    max_drive_minutes: int = 60

class RestSearchRequest(BaseModel):
    lat: float
    lon: float
    radius: int = 300
    category: str = "CE7"

class LocationUpdate(BaseModel):
    user_id: str
    lat: float
    lon: float
    speed: Optional[float] = None

class OrgCreate(BaseModel):
    name:     str   # 기업명
    username: str
    password: str
    phone:    str
    email:    str   # 승인/반려 알림 수신 이메일

class RegisterRequest(BaseModel):
    username: str
    password: str
    phone:    str
    org_code: str   # 기사/관리자 추가 가입 시 조직코드 입력
    role: str = "driver"

class LoginRequest(BaseModel):
    username: str
    password: str


# ────────────────────────────────────────────────
# 헬스체크 + 설정
# ────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status":        "ok",
        "kakao_key_set": bool(KAKAO_REST_KEY),
    }

@app.get("/config")
async def config():
    if not KAKAO_JS_KEY:
        raise HTTPException(503, "KAKAO_JS_KEY가 설정되지 않았습니다.")
    return {"kakao_js_key": KAKAO_JS_KEY}


# ────────────────────────────────────────────────
# 차량 (vehicles)
# ────────────────────────────────────────────────
class VehicleCreate(BaseModel):
    plate_number: str
    vehicle_type: str
    height_m:     float
    weight_kg:    float
    length_cm:    Optional[float] = None
    width_cm:     Optional[float] = None

@app.get("/vehicles")
async def get_vehicles(db: AsyncSession = Depends(get_db),
                 current_user: User = Depends(require_admin)):
    _r = await db.execute(select(Vehicle).where(Vehicle.is_active == True))
    return _r.scalars().all()

@app.post("/vehicles", status_code=201)
async def create_vehicle(req: VehicleCreate, db: AsyncSession = Depends(get_db),
                   current_user: User = Depends(require_admin)):
    v = Vehicle(**req.model_dump())
    db.add(v); await db.commit(); await db.refresh(v)
    return v

@app.delete("/vehicles/{vehicle_id}", status_code=204)
async def delete_vehicle(vehicle_id: int, db: AsyncSession = Depends(get_db),
                   current_user: User = Depends(require_admin)):
    _r = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    v = _r.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "차량을 찾을 수 없습니다.")
    v.is_active = False
    await db.commit()


# ────────────────────────────────────────────────
# 휴게소 (rest-stops)
# ────────────────────────────────────────────────
class RestStopCreate(BaseModel):
    name:      str
    type:      str
    latitude:  float
    longitude: float
    direction: Optional[str] = None
    note:      Optional[str] = None

@app.get("/rest-stops")
async def get_rest_stops(db: AsyncSession = Depends(get_db)):
    _r = await db.execute(select(RestStop).where(RestStop.is_active == True))
    return _r.scalars().all()

@app.post("/rest-stops", status_code=201)
async def create_rest_stop(req: RestStopCreate, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    try:
        stop_type = RestStopType(req.type)
    except ValueError:
        raise HTTPException(400, f"올바르지 않은 type: {req.type}")
    rs = RestStop(name=req.name, type=stop_type, latitude=req.latitude,
                  longitude=req.longitude, direction=req.direction, note=req.note)
    db.add(rs); await db.commit(); await db.refresh(rs)
    return rs

@app.delete("/rest-stops/{stop_id}", status_code=204)
async def delete_rest_stop(stop_id: int, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(require_admin)):
    _r = await db.execute(select(RestStop).where(RestStop.id == stop_id))
    rs = _r.scalar_one_or_none()
    if not rs:
        raise HTTPException(404, "휴게소를 찾을 수 없습니다.")
    rs.is_active = False
    await db.commit()


# ────────────────────────────────────────────────
# 운행 (trips)
# ────────────────────────────────────────────────
class WaypointSchema(BaseModel):
    name: str
    lat:  float
    lon:  float

class TripCreate(BaseModel):
    driver_id:         str
    vehicle_id:        Optional[int]   = None
    dest_name:         str
    dest_lat:          float
    dest_lon:          float
    waypoints:         Optional[list[WaypointSchema]] = None
    departure_time:    Optional[str]   = None
    vehicle_height_m:  Optional[float] = None
    vehicle_weight_kg: Optional[float] = None
    vehicle_length_cm: Optional[float] = None
    vehicle_width_cm:  Optional[float] = None

@app.get("/trips")
async def get_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    driver_id: Optional[str] = None,
    status: Optional[str] = None,
):
    import uuid as uuid_lib
    stmt = select(Trip)
    if current_user.role == UserRole.driver:
        # 기사: 본인 운행만
        stmt = stmt.where(Trip.driver_id == current_user.id)
    else:
        # 관리자: 같은 기업 기사의 운행만
        _r = await db.execute(
            select(User.id).where(
                User.organization_id == current_user.organization_id,
                User.role == UserRole.driver,
            )
        )
        driver_ids = [row[0] for row in _r.all()]
        if driver_id:
            stmt = stmt.where(Trip.driver_id == uuid_lib.UUID(driver_id))
        else:
            stmt = stmt.where(Trip.driver_id.in_(driver_ids))
    if status:
        stmt = stmt.where(Trip.status == status)
    stmt = stmt.order_by(Trip.created_at.desc())
    _r = await db.execute(stmt)
    return [_trip_schema(t) for t in _r.scalars().all()]

@app.post("/trips", status_code=201)
async def create_trip(req: TripCreate, db: AsyncSession = Depends(get_db),
                current_user: User = Depends(require_admin)):
    import uuid as uuid_lib
    waypoints_json = [w.model_dump() for w in req.waypoints] if req.waypoints else []
    t = Trip(
        driver_id=uuid_lib.UUID(req.driver_id), vehicle_id=req.vehicle_id,
        dest_name=req.dest_name, dest_lat=req.dest_lat, dest_lon=req.dest_lon,
        waypoints=waypoints_json, departure_time=req.departure_time,
        vehicle_height_m=req.vehicle_height_m, vehicle_weight_kg=req.vehicle_weight_kg,
        vehicle_length_cm=req.vehicle_length_cm, vehicle_width_cm=req.vehicle_width_cm,
    )
    db.add(t); await db.commit(); await db.refresh(t)
    return _trip_schema(t)

@app.get("/trips/{trip_id}")
async def get_trip(trip_id: str, db: AsyncSession = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    import uuid as uuid_lib
    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(trip_id)))
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")
    return _trip_schema(t)


@app.get("/trips/{trip_id}/polyline")
async def get_trip_polyline(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    운행의 최적화된 경로를 실제 도로 폴리라인 좌표로 반환합니다.
    관리자 웹 지도에서 경로선을 그릴 때 사용합니다.

    Returns:
        {
            "trip_id": "...",
            "polyline": [{"lat": ..., "lon": ...}, ...],
            "nodes": [{"type": ..., "name": ..., "lat": ..., "lon": ...}, ...]
        }
    """
    import uuid as uuid_lib
    import httpx

    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(trip_id)))
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    route_data = t.optimized_route
    if not route_data or not route_data.get("route"):
        raise HTTPException(400, "아직 경로 최적화가 완료되지 않은 운행입니다.")

    nodes = route_data["route"]  # [{type, name, lat, lon}, ...]

    # rest_stop 제외한 실제 경유 노드만 추출 (카카오 경유지 최대 5개 제한)
    drive_nodes = [n for n in nodes if n["type"] != "rest_stop"]

    if len(drive_nodes) < 2:
        return {"trip_id": trip_id, "polyline": [], "nodes": nodes}

    # 카카오 모빌리티 directions API로 실제 도로 좌표 요청
    KAKAO_BASE = "https://apis-navi.kakaomobility.com/v1"
    headers    = {"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}
    polyline: list[dict] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 노드가 많으면 구간별로 나눠서 호출 (카카오 경유지 최대 5개)
        origin = drive_nodes[0]
        dest   = drive_nodes[-1]
        middle = drive_nodes[1:-1]

        # 경유지 5개 초과 시 청크로 분할
        chunk_size = 5
        chunks = [middle[i:i+chunk_size] for i in range(0, max(len(middle), 1), chunk_size)] if middle else [[]]

        for chunk in chunks:
            params = {
                "origin":      f"{origin['lon']},{origin['lat']}",
                "destination": f"{dest['lon']},{dest['lat']}",
                "summary":     "false",
            }
            if chunk:
                params["waypoints"] = "|".join(
                    f"{w['lon']},{w['lat']}" for w in chunk
                )

            try:
                resp = await client.get(
                    f"{KAKAO_BASE}/directions", params=params, headers=headers
                )
                if resp.status_code != 200:
                    continue

                data = resp.json()
                sections = data.get("routes", [{}])[0].get("sections", [])
                for section in sections:
                    for road in section.get("roads", []):
                        coords = road.get("vertexes", [])
                        # vertexes: [lon, lat, lon, lat, ...]
                        for i in range(0, len(coords) - 1, 2):
                            polyline.append({
                                "lat": coords[i + 1],
                                "lon": coords[i],
                            })

                # 청크가 여러 개면 origin을 마지막 경유지로 이동
                if chunk:
                    origin = chunk[-1]

            except Exception:
                continue

    # 폴리라인 좌표가 없으면 직선 연결 fallback
    if not polyline:
        polyline = [{"lat": n["lat"], "lon": n["lon"]} for n in drive_nodes]

    return {
        "trip_id":  trip_id,
        "polyline": polyline,
        "nodes":    nodes,
    }


@app.patch("/trips/{trip_id}/waypoints")
async def add_waypoint(
    trip_id: str,
    req: WaypointSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    운행 중 경유지를 추가합니다 (원격 배차).
    1. trips.waypoints에 경유지 추가
    2. WebSocket으로 해당 기사 앱에 재경로 요청 알림 전송

    앱은 이 알림을 수신하면 POST /optimize/replan을 호출해야 합니다.
    """
    import uuid as uuid_lib

    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(trip_id)))
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    # waypoints 배열에 추가
    current_waypoints = list(t.waypoints or [])
    new_waypoint = {"name": req.name, "lat": req.lat, "lon": req.lon}
    current_waypoints.append(new_waypoint)
    t.waypoints = current_waypoints
    await db.commit()
    await db.refresh(t)

    # WebSocket으로 해당 기사에게 재경로 요청 알림
    await manager.broadcast({
        "type":        "replan_requested",
        "trip_id":     trip_id,
        "driver_id":   str(t.driver_id),
        "new_waypoint": new_waypoint,
        "waypoints":   current_waypoints,
        "message":     f"새 경유지 '{req.name}'이 추가됐습니다. 경로를 재계산하세요.",
    })

    return {
        "trip_id":   trip_id,
        "waypoints": current_waypoints,
        "added":     new_waypoint,
    }


@app.patch("/trips/{trip_id}/status")
async def update_trip_status(
    trip_id: str,
    status: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    운행 상태 변경.

    쿼리 파라미터:
      - status=completed : 운행 완료
      - status=cancelled : 운행 취소

    예시: PATCH /trips/{id}/status?status=completed
    """
    import uuid as uuid_lib
    from datetime import datetime

    if status not in ("completed", "cancelled"):
        raise HTTPException(400, "status는 'completed' 또는 'cancelled'만 가능합니다.")

    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(trip_id)))
    t  = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    if t.status == TripStatus.completed:
        raise HTTPException(400, "이미 완료된 운행입니다.")
    if t.status == TripStatus.cancelled:
        raise HTTPException(400, "이미 취소된 운행입니다.")

    # 권한 확인 — 기사는 본인 운행만 완료 처리 가능
    if current_user.role == UserRole.driver and str(t.driver_id) != str(current_user.id):
        raise HTTPException(403, "본인 운행만 처리할 수 있습니다.")

    t.status = TripStatus(status)
    if status == "completed":
        t.completed_at = datetime.utcnow()

        # 소속 배송지 중 미완료 건 일괄 완료 처리
        _rd = await db.execute(
            select(Delivery).where(
                Delivery.trip_id == t.id,
                Delivery.status  == DeliveryStatus.in_progress,
            )
        )
        for d in _rd.scalars().all():
            d.status       = DeliveryStatus.done_manual
            d.completed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(t)

    return {
        "trip_id":      str(t.id),
        "status":       t.status,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }

def _trip_schema(t: Trip) -> dict:
    return {
        "id": str(t.id), "driver_id": str(t.driver_id), "vehicle_id": t.vehicle_id,
        "dest_name": t.dest_name, "dest_lat": t.dest_lat, "dest_lon": t.dest_lon,
        "waypoints": t.waypoints or [], "optimized_route": t.optimized_route,
        "status": t.status, "departure_time": t.departure_time,
        "is_emergency": t.is_emergency, "created_at": t.created_at.isoformat(),
    }


# ────────────────────────────────────────────────
# 경로 최적화
# ────────────────────────────────────────────────
class ExtraStopSchema(BaseModel):
    stop_type: str   # waypoint | destination | rest_preferred
    name: str
    lat:  float
    lon:  float
    note: Optional[str] = None

class OptimizeRequest(BaseModel):
    trip_id:           str
    origin_name:       str
    origin_lat:        float
    origin_lon:        float
    initial_drive_sec: int   = 0
    is_emergency:      bool  = False
    route_mode:        str   = "auto"   # auto | local | long_distance
    vehicle_height_m:  Optional[float] = None
    vehicle_weight_kg: Optional[float] = None
    vehicle_length_cm: Optional[float] = None
    vehicle_width_cm:  Optional[float] = None
    extra_stops:       Optional[list[ExtraStopSchema]] = None

class ReplanRequest(BaseModel):
    trip_id:             str
    current_name:        str
    current_lat:         float
    current_lon:         float
    current_drive_sec:   int
    remaining_waypoints: list[WaypointSchema]
    dest_name:           str
    dest_lat:            float
    dest_lon:            float
    is_emergency:        bool = False
    route_mode:          str  = "auto"   # auto | local | long_distance

@app.post("/optimize")
async def optimize(req: OptimizeRequest, db: AsyncSession = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    """기사가 출발 시 호출. 경유지 순서 최적화 + 휴게소 삽입 후 최적 경로 반환."""
    import uuid as uuid_lib
    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(req.trip_id)))
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    # 노드 구성 (extra_stops 처리 포함)
    waypoints_raw: list[dict] = list(t.waypoints or [])
    extra_stops    = req.extra_stops or []
    new_dest       = None
    preferred_rest: list[dict] = []

    for es in extra_stops:
        if es.stop_type == "waypoint":
            waypoints_raw.append({"name": es.name, "lat": es.lat, "lon": es.lon})
        elif es.stop_type == "destination":
            waypoints_raw.append({"name": t.dest_name, "lat": t.dest_lat, "lon": t.dest_lon})
            new_dest = es
        elif es.stop_type == "rest_preferred":
            preferred_rest.append({"name": es.name, "latitude": es.lat, "longitude": es.lon, "is_active": True})

    dest_name = new_dest.name if new_dest else t.dest_name
    dest_lat  = new_dest.lat  if new_dest else t.dest_lat
    dest_lon  = new_dest.lon  if new_dest else t.dest_lon

    nodes = [{"name": req.origin_name, "lat": req.origin_lat, "lon": req.origin_lon}]
    nodes += waypoints_raw
    nodes.append({"name": dest_name, "lat": dest_lat, "lon": dest_lon})

    try:
        time_matrix, dist_matrix = await kakao_mobility.build_time_matrix(
            nodes,
            route_mode=req.route_mode,
            departure_time=t.departure_time,
        )
    except Exception as e:
        raise HTTPException(502, f"카카오 모빌리티 API 오류: {e}")

    tsp_order = solve_tsp(time_matrix)
    dest_idx  = len(nodes) - 1
    k         = len(tsp_order)
    ordered   = [
        RouteNode(
            type="origin" if idx == 0 else "waypoint",
            name=nodes[idx]["name"],
            lat=nodes[idx]["lat"],
            lon=nodes[idx]["lon"],
        )
        for idx in tsp_order
    ] + [RouteNode(type="destination", name=dest_name, lat=dest_lat, lon=dest_lon)]

    # 시간·거리 행렬 재배열
    n_o           = len(ordered)
    reordered     = [[0] * n_o for _ in range(n_o)]
    reordered_dist = [[0] * n_o for _ in range(n_o)]
    for i in range(k):
        for j in range(k):
            reordered[i][j]      = time_matrix[tsp_order[i]][tsp_order[j]]
            reordered_dist[i][j] = dist_matrix[tsp_order[i]][tsp_order[j]]
        reordered[i][k]      = time_matrix[tsp_order[i]][dest_idx]
        reordered_dist[i][k] = dist_matrix[tsp_order[i]][dest_idx]

    # 휴게소 조회 (depot 제외)
    _rr = await db.execute(
        select(RestStop).where(RestStop.is_active == True, RestStop.type != "depot")
    )
    rest_candidates = preferred_rest + [
        {"name": r.name, "latitude": r.latitude, "longitude": r.longitude, "is_active": True}
        for r in _rr.scalars().all()
    ]

    final_route = await insert_rest_stops(
        ordered, reordered, rest_candidates,
        initial_drive_sec=req.initial_drive_sec,
        is_emergency=req.is_emergency,
        picker=kakao_mobility.find_best_rest_stop,
    )

    # 총 거리·시간 계산
    total_sec  = sum(reordered[i][i + 1] for i in range(len(ordered) - 1))
    total_dist_km = sum(reordered_dist[i][i + 1] for i in range(len(ordered) - 1)) / 1000

    route_dicts = [node.to_dict() for node in final_route]
    t.optimized_route = {
        "route": route_dicts,
        "estimated_duration_min": round(total_sec / 60, 1),
        "total_distance_km": round(total_dist_km, 2),
    }
    t.origin_name = req.origin_name
    t.origin_lat  = req.origin_lat
    t.origin_lon  = req.origin_lon
    t.status      = TripStatus.in_progress
    t.is_emergency = req.is_emergency

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

    return {
        "trip_id":              str(t.id),
        "route":                route_dicts,
        "total_distance_km":    round(total_dist_km, 2),
        "estimated_duration_min": round(total_sec / 60, 1),
        "rest_stops_count":     sum(1 for nd in final_route if nd.type == "rest_stop"),
        "is_emergency":         req.is_emergency,
    }

@app.post("/optimize/replan")
async def replan(req: ReplanRequest, db: AsyncSession = Depends(get_db),
           current_user: User = Depends(get_current_user)):
    """운행 중 재경로 계산."""
    import uuid as uuid_lib
    _r = await db.execute(select(Trip).where(Trip.id == uuid_lib.UUID(req.trip_id)))
    t = _r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "운행을 찾을 수 없습니다.")

    nodes = [{"name": req.current_name, "lat": req.current_lat, "lon": req.current_lon}]
    nodes += [{"name": w.name, "lat": w.lat, "lon": w.lon} for w in req.remaining_waypoints]
    nodes.append({"name": req.dest_name, "lat": req.dest_lat, "lon": req.dest_lon})

    try:
        time_matrix, dist_matrix = await kakao_mobility.build_time_matrix(
            nodes, route_mode=req.route_mode
        )
    except Exception as e:
        raise HTTPException(502, f"카카오 모빌리티 API 오류: {e}")

    tsp_order = solve_tsp(time_matrix)
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
        select(RestStop).where(RestStop.is_active == True, RestStop.type != "depot")
    )
    rest_candidates = [
        {"name": r.name, "latitude": r.latitude, "longitude": r.longitude, "is_active": True}
        for r in _rr.scalars().all()
    ]
    final_route = await insert_rest_stops(
        ordered, reordered, rest_candidates,
        initial_drive_sec=req.current_drive_sec,
        is_emergency=req.is_emergency,
        picker=kakao_mobility.find_best_rest_stop,
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

    return {
        "trip_id":                str(t.id),
        "route":                  route_dicts,
        "total_distance_km":      round(total_dist_km, 2),
        "estimated_duration_min": round(total_sec / 60, 1),
        "rest_stops_count":       sum(1 for nd in final_route if nd.type == "rest_stop"),
        "is_emergency":           req.is_emergency,
    }


# ────────────────────────────────────────────────
# 기업 (organizations)
# ────────────────────────────────────────────────
@app.post("/organizations", status_code=201)
async def create_organization(
    name:     str       = Form(...),
    username: str       = Form(...),
    password: str       = Form(...),
    phone:    str       = Form(...),
    email:    str       = Form(...),
    doc_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    기업 최초 등록 + 관리자 계정 동시 생성.
    - 사업자등록증 등 첨부파일 필수 (PDF, JPG, PNG, 10MB 이하)
    - 등록 후 status=pending_review → 슈퍼 관리자 승인 후 이용 가능
    """
    import random, string
    from datetime import datetime

    # 파일 확장자 확인
    ext = Path(doc_file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"허용된 파일 형식: PDF, JPG, PNG")

    # 파일 크기 확인
    contents = await doc_file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(400, "파일 크기는 10MB 이하여야 합니다.")

    # 아이디 중복 확인
    _r = await db.execute(select(User).where(User.username == username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {username}")

    # 조직코드 생성
    while True:
        org_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        _o = await db.execute(select(Organization).where(Organization.org_code == org_code))
        if not _o.scalar_one_or_none():
            break

    # 기업 생성 (심사 중)
    org = Organization(
        name   = name,
        org_code = org_code,
        status = OrgStatus.pending_review,
    )
    db.add(org)
    await db.flush()  # org.id 확보

    # 파일 저장
    org_upload_dir = UPLOAD_DIR / str(org.id)
    org_upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{org.id}{ext}"
    file_path = org_upload_dir / safe_filename
    with open(file_path, "wb") as f:
        f.write(contents)

    org.doc_filename = doc_file.filename
    org.doc_path     = str(file_path)

    # 관리자 계정 생성
    admin = User(
        username        = username,
        password_hash   = hash_password(password),
        role            = UserRole.admin,
        phone           = phone,
        email           = email,
        organization_id = org.id,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(org)
    await db.refresh(admin)

    return {
        "org_id":           org.id,
        "org_name":         org.name,
        "org_code":         org.org_code,
        "status":           org.status,
        "admin_id":         str(admin.id),
        "admin_username":   admin.username,
        "message":          "기업 등록 완료. 서류 심사 후 이용 가능합니다.",
    }


# ── 슈퍼 관리자 전용 ──────────────────────────────

@app.get("/superadmin/organizations")
async def list_organizations(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 전체 기업 목록 조회. ?status=pending_review|approved|rejected"""
    stmt = select(Organization)
    if status:
        try:
            stmt = stmt.where(Organization.status == OrgStatus(status))
        except ValueError:
            raise HTTPException(400, "status 값이 올바르지 않습니다.")
    stmt = stmt.order_by(Organization.created_at.desc())
    _r = await db.execute(stmt)
    orgs = _r.scalars().all()
    return [
        {
            "id":           o.id,
            "name":         o.name,
            "org_code":     o.org_code,
            "status":       o.status,
            "doc_filename": o.doc_filename,
            "reject_reason":o.reject_reason,
            "reviewed_at":  o.reviewed_at.isoformat() if o.reviewed_at else None,
            "created_at":   o.created_at.isoformat(),
        }
        for o in orgs
    ]


@app.get("/superadmin/organizations/{org_id}/doc")
async def download_org_doc(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 첨부 서류 다운로드"""
    _r = await db.execute(select(Organization).where(Organization.id == org_id))
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    if not org.doc_path or not Path(org.doc_path).exists():
        raise HTTPException(404, "첨부 파일이 없습니다.")
    return FileResponse(
        path     = org.doc_path,
        filename = org.doc_filename or "document",
    )


@app.post("/superadmin/organizations/{org_id}/approve")
async def approve_organization(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 승인"""
    from datetime import datetime
    _r = await db.execute(select(Organization).where(Organization.id == org_id))
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    if org.status == OrgStatus.approved:
        raise HTTPException(400, "이미 승인된 기업입니다.")

    org.status      = OrgStatus.approved
    org.reviewed_at = datetime.utcnow()
    await db.commit()

    # 관리자 이메일로 승인 알림 발송
    _u = await db.execute(
        select(User).where(
            User.organization_id == org.id,
            User.role == UserRole.admin,
        )
    )
    admin = _u.scalars().first()
    if admin and admin.email:
        import asyncio
        asyncio.create_task(send_approved(admin.email, org.name, org.org_code))

    return {"org_id": org.id, "org_name": org.name, "status": org.status}


class RejectRequest(BaseModel):
    reason: str

@app.post("/superadmin/organizations/{org_id}/reject")
async def reject_organization(
    org_id: int,
    req: RejectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 기업 반려 + 사유 저장"""
    from datetime import datetime
    _r = await db.execute(select(Organization).where(Organization.id == org_id))
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")

    org.status        = OrgStatus.rejected
    org.reject_reason = req.reason
    org.reviewed_at   = datetime.utcnow()
    await db.commit()

    # 관리자 이메일로 반려 알림 발송
    _u = await db.execute(
        select(User).where(
            User.organization_id == org.id,
            User.role == UserRole.admin,
        )
    )
    admin = _u.scalars().first()
    if admin and admin.email:
        import asyncio
        asyncio.create_task(send_rejected(admin.email, org.name, req.reason))

    return {"org_id": org.id, "org_name": org.name, "status": org.status, "reason": org.reject_reason}


class SuperAdminCreate(BaseModel):
    username: str
    password: str
    phone:    str = ""

@app.post("/superadmin/create-account", status_code=201)
async def create_superadmin_account(
    req: SuperAdminCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_superadmin),
):
    """슈퍼 관리자: 새 슈퍼어드민 계정 생성"""
    _r = await db.execute(select(User).where(User.username == req.username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")

    user = User(
        username      = req.username,
        password_hash = hash_password(req.password),
        role          = UserRole.superadmin,
        phone         = req.phone,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": str(user.id), "username": user.username, "role": user.role}




@app.get("/organizations/me")
async def get_my_organization(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 내 기업 정보 + 조직코드 조회"""
    if not current_user.organization_id:
        raise HTTPException(404, "소속 기업이 없습니다.")
    _r = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    return {
        "id":       org.id,
        "name":     org.name,
        "org_code": org.org_code,
    }


@app.post("/organizations/regen-code")
async def regen_org_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 조직코드 재발급"""
    import random, string

    if not current_user.organization_id:
        raise HTTPException(404, "소속 기업이 없습니다.")
    _r = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = _r.scalar_one_or_none()

    while True:
        new_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        _o = await db.execute(select(Organization).where(Organization.org_code == new_code))
        if not _o.scalar_one_or_none():
            break

    org.org_code = new_code
    await db.commit()
    return {"org_code": org.org_code}


@app.get("/organizations/lookup")
async def lookup_organization(
    org_code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    조직코드로 기업 정보 조회 (인증 불필요).
    기사 앱 가입 화면에서 코드 입력 시 기업명 미리 표시할 때 사용.

    예시: GET /organizations/lookup?org_code=RT-ABC123
    """
    _r = await db.execute(
        select(Organization).where(Organization.org_code == org_code)
    )
    org = _r.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "존재하지 않는 조직코드입니다.")
    return {
        "org_id":   org.id,
        "org_name": org.name,
        "org_code": org.org_code,
    }


@app.get("/auth/check-username")
async def check_username(
    username: str,
    db: AsyncSession = Depends(get_db),
):
    """
    아이디 중복 확인 (인증 불필요).
    가입 전 사용 가능 여부 확인.

    예시: GET /auth/check-username?username=driver1
    """
    _r = await db.execute(select(User).where(User.username == username))
    exists = _r.scalar_one_or_none() is not None
    return {
        "username":   username,
        "available":  not exists,
        "message":    "사용 가능한 아이디입니다." if not exists else "이미 사용 중인 아이디입니다.",
    }


# ────────────────────────────────────────────────
# 인증 (회원가입 / 로그인)
# ────────────────────────────────────────────────
@app.post("/auth/register", status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    기사 또는 관리자 추가 가입.
    - org_code로 소속 기업 확인 후 가입
    - role=driver  → pending (관리자 승인 필요)
    - role=admin   → admin 즉시 (같은 기업 관리자 추가)
    """
    if req.role not in ("driver", "admin"):
        raise HTTPException(400, "role은 'driver' 또는 'admin'이어야 합니다.")
    if not req.phone:
        raise HTTPException(400, "전화번호는 필수입니다.")
    if not req.org_code:
        raise HTTPException(400, "조직 코드는 필수입니다.")

    # 조직코드로 기업 조회
    _o = await db.execute(
        select(Organization).where(Organization.org_code == req.org_code)
    )
    org = _o.scalar_one_or_none()
    if not org:
        raise HTTPException(404, "올바르지 않은 조직 코드입니다.")

    # 아이디 중복 확인
    _r = await db.execute(select(User).where(User.username == req.username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")

    actual_role = UserRole.admin if req.role == "admin" else UserRole.pending

    user = User(
        username        = req.username,
        password_hash   = hash_password(req.password),
        role            = actual_role,
        phone           = req.phone,
        organization_id = org.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id":         str(user.id),
        "username":   user.username,
        "role":       user.role,
        "org_name":   org.name,
        "created_at": user.created_at,
    }


@app.post("/auth/approve/{user_id}")
async def approve_driver(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: pending 기사를 승인하여 driver로 변경 (같은 기업만)"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(User.id == uuid_lib.UUID(user_id)))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if user.organization_id != current_user.organization_id:
        raise HTTPException(403, "같은 기업의 기사만 승인할 수 있습니다.")
    if user.role != UserRole.pending:
        raise HTTPException(400, "승인 대기 중인 계정이 아닙니다.")

    user.role = UserRole.driver
    await db.commit()
    await db.refresh(user)

    return {"id": str(user.id), "username": user.username, "role": user.role}
    """계정 생성.
    - role=admin: 관리자 웹 가입 페이지에서 호출. 즉시 admin으로 생성.
    - role=driver: 기사 앱에서 호출. pending으로 생성 후 관리자 승인 필요.
    """
    if req.role not in ("driver", "admin"):
        raise HTTPException(400, "role은 'driver' 또는 'admin'이어야 합니다.")
    if not req.phone:
        raise HTTPException(400, "전화번호는 필수입니다.")

    _r = await db.execute(select(User).where(User.username == req.username))
    if _r.scalar_one_or_none():
        raise HTTPException(409, f"이미 존재하는 아이디입니다: {req.username}")

    # 기사 가입 시 pending으로 저장 (관리자 승인 필요)
    actual_role = UserRole.admin if req.role == "admin" else UserRole.pending

    # 조직코드 자동 생성 (미전달 시)
    import random, string
    org_code = req.org_code or "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

    user = User(
        username       = req.username,
        password_hash  = hash_password(req.password),
        role           = actual_role,
        phone          = req.phone,
        license_number = org_code,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id":         str(user.id),
        "username":   user.username,
        "role":       user.role,
        "org_code":   user.license_number,  # 자동 생성된 조직코드
        "created_at": user.created_at,
    }


@app.post("/auth/approve/{user_id}")
async def approve_driver(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: pending 기사를 승인하여 driver로 변경"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(User.id == uuid_lib.UUID(user_id)))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if user.role != UserRole.pending:
        raise HTTPException(400, "승인 대기 중인 계정이 아닙니다.")

    user.role = UserRole.driver
    await db.commit()
    await db.refresh(user)

    return {
        "id":       str(user.id),
        "username": user.username,
        "role":     user.role,
    }


@app.post("/auth/reissue-org-code")
async def reissue_org_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 조직코드 재발급 (새 랜덤 코드로 변경)"""
    import random, string
    new_code = "RT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    current_user.license_number = new_code
    await db.commit()
    await db.refresh(current_user)
    return {"org_code": new_code}


@app.post("/auth/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """로그인 → JWT 액세스 토큰 발급"""
    _r = await db.execute(select(User).where(User.username == req.username))
    user = _r.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "아이디 또는 비밀번호가 올바르지 않습니다.")

    token = create_token(str(user.id), user.role.value)
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user_id":      str(user.id),
        "username":     user.username,
        "role":         user.role,
    }


@app.get("/auth/me")
async def me(current_user: User = Depends(get_current_user)):
    """현재 로그인된 유저 정보 확인"""
    return {
        "id":       str(current_user.id),
        "username": current_user.username,
        "role":     current_user.role,
        "phone":    current_user.phone,
        "org_code": current_user.license_number,
    }


class UpdateMeRequest(BaseModel):
    phone:            Optional[str] = None
    current_password: Optional[str] = None
    new_password:     Optional[str] = None


@app.patch("/auth/me")
async def update_me(
    req: UpdateMeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 정보 수정 — 전화번호 및 비밀번호 변경"""
    if not req.phone and not req.new_password:
        raise HTTPException(400, "변경할 정보를 입력해주세요.")

    # 비밀번호 변경
    if req.new_password:
        if not req.current_password:
            raise HTTPException(400, "비밀번호 변경 시 현재 비밀번호가 필요합니다.")
        if not verify_password(req.current_password, current_user.password_hash):
            raise HTTPException(401, "현재 비밀번호가 올바르지 않습니다.")
        if len(req.new_password) < 4:
            raise HTTPException(400, "새 비밀번호는 4자 이상이어야 합니다.")
        current_user.password_hash = hash_password(req.new_password)

    # 전화번호 변경
    if req.phone:
        current_user.phone = req.phone

    await db.commit()
    await db.refresh(current_user)

    return {
        "id":       str(current_user.id),
        "username": current_user.username,
        "role":     current_user.role,
        "phone":    current_user.phone,
    }


@app.get("/users")
async def get_users(
    role: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 같은 기업 유저 목록 조회"""
    stmt = select(User).where(User.organization_id == current_user.organization_id)
    if role:
        try:
            stmt = stmt.where(User.role == UserRole(role))
        except ValueError:
            raise HTTPException(400, f"올바르지 않은 role 값: {role}")
    stmt = stmt.order_by(User.created_at.desc())
    _r = await db.execute(stmt)
    users = _r.scalars().all()
    return [
        {
            "id":       str(u.id),
            "username": u.username,
            "role":     u.role,
            "phone":    u.phone,
            "org_code": None,  # organization 기반으로 변경됨
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@app.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 기사 계정 삭제"""
    import uuid as uuid_lib
    _r = await db.execute(select(User).where(User.id == uuid_lib.UUID(user_id)))
    user = _r.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "유저를 찾을 수 없습니다.")
    if str(user.id) == str(current_user.id):
        raise HTTPException(400, "자기 자신은 삭제할 수 없습니다.")
    await db.delete(user)
    await db.commit()


# ────────────────────────────────────────────────
# 배송 CRUD
# ────────────────────────────────────────────────

class DeliveryCreate(BaseModel):
    address:  str
    lat:      float
    lon:      float
    deadline: Optional[str] = None   # "YYYY-MM-DD HH:MM"

class DeliveryAssign(BaseModel):
    driver_id: str   # UUID 문자열


@app.post("/deliveries", status_code=201)
async def create_delivery(
    req: DeliveryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송지 단건 등록"""
    from datetime import datetime
    deadline = None
    if req.deadline:
        try:
            deadline = datetime.strptime(req.deadline, "%Y-%m-%d %H:%M")
        except ValueError:
            raise HTTPException(400, "deadline 형식: 'YYYY-MM-DD HH:MM'")

    delivery = Delivery(
        address  = req.address,
        lat      = req.lat,
        lon      = req.lon,
        deadline = deadline,
    )
    db.add(delivery)
    await db.commit()
    await db.refresh(delivery)
    return _delivery_schema(delivery)


@app.post("/deliveries/batch", status_code=201)
async def create_deliveries_batch(
    reqs: list[DeliveryCreate],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송지 여러 개 한 번에 등록"""
    from datetime import datetime
    deliveries = []
    for req in reqs:
        deadline = None
        if req.deadline:
            try:
                deadline = datetime.strptime(req.deadline, "%Y-%m-%d %H:%M")
            except ValueError:
                raise HTTPException(400, f"deadline 형식 오류: {req.deadline}")
        d = Delivery(address=req.address, lat=req.lat, lon=req.lon, deadline=deadline)
        db.add(d)
        deliveries.append(d)
    await db.commit()
    for d in deliveries:
        await db.refresh(d)
    return [_delivery_schema(d) for d in deliveries]


@app.patch("/deliveries/{delivery_id}/assign")
async def assign_delivery(
    delivery_id: str,
    req: DeliveryAssign,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송지에 기사 배정"""
    import uuid as uuid_lib
    _r = await db.execute(select(Delivery).where(Delivery.id == uuid_lib.UUID(delivery_id)))
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")

    _r2 = await db.execute(select(User).where(User.id == uuid_lib.UUID(req.driver_id)))
    driver = _r2.scalar_one_or_none()
    if not driver:
        raise HTTPException(404, "기사를 찾을 수 없습니다.")

    delivery.assigned_to = driver.id
    delivery.status      = DeliveryStatus.in_progress
    await db.commit()
    await db.refresh(delivery)
    return _delivery_schema(delivery)


@app.delete("/deliveries/{delivery_id}", status_code=204)
async def delete_delivery(
    delivery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """관리자: 배송 취소 (삭제)"""
    import uuid as uuid_lib
    _r = await db.execute(select(Delivery).where(Delivery.id == uuid_lib.UUID(delivery_id)))
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    if delivery.status == DeliveryStatus.done:
        raise HTTPException(400, "완료된 배송은 삭제할 수 없습니다.")
    await db.delete(delivery)
    await db.commit()


@app.get("/deliveries")
async def get_deliveries(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    기사: 본인에게 배정된 in_progress 배송 목록
    관리자: 전체 배송 목록
    """
    stmt = select(Delivery)
    if current_user.role == UserRole.driver:
        stmt = stmt.where(
            Delivery.assigned_to == current_user.id,
            Delivery.status == DeliveryStatus.in_progress,
        )
    stmt = stmt.order_by(Delivery.sequence, Delivery.created_at)
    _r = await db.execute(stmt)
    deliveries = _r.scalars().all()
    return [_delivery_schema(d) for d in deliveries]


@app.get("/deliveries/{delivery_id}")
async def get_delivery(
    delivery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """배송 상세 조회"""
    import uuid as uuid_lib
    _r = await db.execute(select(Delivery).where(Delivery.id == uuid_lib.UUID(delivery_id)))
    delivery = _r.scalar_one_or_none()
    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    # 기사는 본인 배송만 조회 가능
    if current_user.role == UserRole.driver and delivery.assigned_to != current_user.id:
        raise HTTPException(403, "접근 권한이 없습니다.")
    return _delivery_schema(delivery)


def _delivery_schema(d: Delivery) -> dict:
    """Delivery 모델 → dict 변환 헬퍼"""
    return {
        "id":           str(d.id),
        "address":      d.address,
        "lat":          d.lat,
        "lon":          d.lon,
        "status":       d.status,
        "sequence":     d.sequence,
        "assigned_to":  str(d.assigned_to) if d.assigned_to else None,
        "deadline":     d.deadline.isoformat()     if d.deadline     else None,
        "completed_at": d.completed_at.isoformat() if d.completed_at else None,
        "created_at":   d.created_at.isoformat(),
    }


@app.post("/rest-spots")
async def find_rest_spots(req: RestSearchRequest):
    """
    현재 위치 근처 휴식 가능 장소 검색.
    카카오 로컬 API - 카테고리로 장소 검색 사용.
    category: CE7=카페, CS2=편의점, FD6=음식점
    """
    if not KAKAO_REST_KEY:
        raise HTTPException(503, "KAKAO_REST_API_KEY가 설정되지 않았습니다.")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{KAKAO_BASE}/v2/local/search/category.json",
            params={
                "category_group_code": req.category,  # CE7, CS2 등
                "x":      str(req.lon),
                "y":      str(req.lat),
                "radius": req.radius,
                "sort":   "distance",
                "size":   5,
            },
            headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"카카오 장소 검색 오류: {resp.text}")

    documents = resp.json().get("documents", [])
    results = []
    for doc in documents:
        results.append({
            "name":     doc.get("place_name"),
            "lat":      float(doc.get("y", 0)),
            "lon":      float(doc.get("x", 0)),
            "address":  doc.get("road_address_name") or doc.get("address_name"),
            "phone":    doc.get("phone"),
            "url":      doc.get("place_url"),
            "dist_m":   int(doc.get("distance") or 0),
            "category": doc.get("category_group_name"),
        })
    return {"spots": results}


# ────────────────────────────────────────────────
# 주소 → 좌표 변환 (카카오 로컬 API)
# ────────────────────────────────────────────────

class AddressRequest(BaseModel):
    query: str   # 검색할 주소


@app.get("/address/coord")
async def address_to_coord(query: str):
    """
    주소 문자열 → 위도/경도 변환.
    관리자가 배송지 주소 입력 시 좌표 자동 변환에 활용.
    """
    if not KAKAO_REST_KEY:
        raise HTTPException(503, "KAKAO_REST_API_KEY가 설정되지 않았습니다.")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{KAKAO_BASE}/v2/local/search/address.json",
            params={"query": query, "size": 1},
            headers={"Authorization": f"KakaoAK {KAKAO_REST_KEY}"},
        )

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"카카오 주소 검색 오류: {resp.text}")

    documents = resp.json().get("documents", [])
    if not documents:
        raise HTTPException(404, f"주소를 찾을 수 없습니다: {query}")

    doc = documents[0]
    return {
        "address": doc.get("address_name"),
        "lat":     float(doc.get("y", 0)),
        "lon":     float(doc.get("x", 0)),
        "road_address": doc.get("road_address", {}).get("address_name") if doc.get("road_address") else None,
    }


# ────────────────────────────────────────────────
# GPS 위치 수신 + 도착 감지
# ────────────────────────────────────────────────

@app.post("/location-logs", status_code=201)
async def create_location_log(
    req: LocationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Android 앱에서 주기적으로 현재 위치를 전송.
    1. Redis에 현재 위치 저장 (덮어씀)
    2. TimescaleDB에 이력 저장
    3. 진행 중 배송지와 거리 계산 → 50m 이내 시 자동 완료
    """
    import uuid as uuid_lib
    from datetime import datetime

    # 1. Redis — 현재 위치 갱신 (TTL 5분)
    redis.setex(
        f"location:{req.user_id}",
        300,
        f"{req.lat},{req.lon}"
    )

    # 2. TimescaleDB — 이력 저장
    loc = Location(
        user_id     = uuid_lib.UUID(req.user_id),
        lat         = req.lat,
        lon         = req.lon,
        speed       = req.speed,
        recorded_at = datetime.utcnow(),
    )
    db.add(loc)
    await db.flush()

    # 3. 도착 감지 — 해당 기사의 in_progress 배송지 조회
    current = LatLng(lat=req.lat, lon=req.lon)
    _r = await db.execute(
        select(Delivery).where(
            Delivery.assigned_to == uuid_lib.UUID(req.user_id),
            Delivery.status == DeliveryStatus.in_progress,
        ).order_by(Delivery.sequence)
    )
    pending = _r.scalars().all()

    arrived = []
    for delivery in pending:
        dest = LatLng(lat=delivery.lat, lon=delivery.lon)
        dist = _haversine(current, dest)
        if dist <= ARRIVAL_RADIUS_M:
            delivery.status       = DeliveryStatus.done
            delivery.completed_at = datetime.utcnow()
            arrived.append(str(delivery.id))

    await db.commit()

    # 4. WebSocket 브로드캐스트 — 연결된 관리자 웹에 실시간 전송
    await manager.broadcast({
        "user_id": req.user_id,
        "lat":     req.lat,
        "lon":     req.lon,
        "speed":   req.speed,
        "arrived_deliveries": arrived,
    })

    return {
        "received": True,
        "arrived_deliveries": arrived,
    }


@app.websocket("/ws/location")
async def ws_location(ws: WebSocket):
    """
    관리자 웹이 연결하는 WebSocket 엔드포인트.
    기사가 POST /location-logs 호출 시 실시간으로 위치 데이터를 수신합니다.

    메시지 형식:
    {
        "user_id": "uuid",
        "lat": 37.123,
        "lon": 127.456,
        "speed": 60.0,
        "arrived_deliveries": []
    }
    """
    await manager.connect(ws)
    try:
        while True:
            # 클라이언트로부터 ping 수신 (연결 유지용)
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.get("/location-logs/{user_id}")
async def get_location_logs(
    user_id: str,
    current_user: User = Depends(require_admin),
):
    """Redis에서 기사의 현재 위치 조회 (관리자 웹용)"""
    val = redis.get(f"location:{user_id}")
    if not val:
        raise HTTPException(404, "위치 정보가 없습니다. (미전송 또는 TTL 만료)")
    lat, lon = val.split(",")
    return {"user_id": user_id, "lat": float(lat), "lon": float(lon)}


@app.patch("/deliveries/{delivery_id}/complete")
async def manual_complete(
    delivery_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_driver),
):
    """
    GPS 미감지 시 기사가 수동으로 배송 완료 처리.
    status → done_manual
    """
    import uuid as uuid_lib
    from datetime import datetime

    _r = await db.execute(select(Delivery).where(Delivery.id == uuid_lib.UUID(delivery_id)))
    delivery = _r.scalar_one_or_none()

    if not delivery:
        raise HTTPException(404, "배송을 찾을 수 없습니다.")
    if delivery.status in (DeliveryStatus.done, DeliveryStatus.done_manual):
        raise HTTPException(400, "이미 완료된 배송입니다.")

    delivery.status       = DeliveryStatus.done_manual
    delivery.completed_at = datetime.utcnow()
    await db.commit()

    return {"id": delivery_id, "status": delivery.status}