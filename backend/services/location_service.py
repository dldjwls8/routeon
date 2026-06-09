from datetime import datetime
import uuid as uuid_lib

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import ARRIVAL_RADIUS_M, REST_STOP_RADIUS_M, REST_STOP_MIN_DWELL_SEC
from core.managers import manager, redis
from core.utils import _haversine_km
from models import Delivery, DeliveryStatus, Location, OrderEvent, Trip, TripStatus, User, Vehicle


async def record_driver_location(
    db: AsyncSession,
    current_user: User,
    *,
    user_id: str,
    lat: float | None,
    lon: float | None,
    speed: float | None,
) -> dict:
    if lat is None or lon is None:
        await db.commit()
        return {"ok": True}

    try:
        driver_uuid = uuid_lib.UUID(user_id)
    except ValueError:
        raise HTTPException(400, "유효하지 않은 user_id 형식입니다.")

    redis.setex(f"location:{user_id}", 300, f"{lat},{lon}")

    location = Location(
        user_id=driver_uuid,
        lat=lat,
        lon=lon,
        speed=speed,
        recorded_at=datetime.utcnow(),
    )
    db.add(location)
    await db.flush()

    active_vehicle_trip = (await db.execute(
        select(Trip).where(
            Trip.driver_id == driver_uuid,
            Trip.status == TripStatus.in_progress,
            Trip.vehicle_id != None,
        ).order_by(
            Trip.started_at.desc().nullslast(),
            Trip.created_at.desc(),
        ).limit(1)
    )).scalar_one_or_none()
    if active_vehicle_trip:
        vehicle = (await db.execute(
            select(Vehicle).where(Vehicle.id == active_vehicle_trip.vehicle_id)
        )).scalar_one_or_none()
        if vehicle:
            vehicle.last_lat = lat
            vehicle.last_lon = lon
            vehicle.last_gps_at = location.recorded_at

    arrived_delivery_ids = []
    if active_vehicle_trip:
        # 도착(하차) 자동 처리는 "현재 진행 중인 운행"에 속한 배송만 대상으로 한다.
        # (전체 in_progress 배송을 대상으로 하면, 직전 운행을 마친 좌표 부근에서 새로 배차된
        #  배송이 운행 시작 전부터 곧바로 '완료'로 잘못 처리되는 문제가 생긴다 — RO-260607-D49F35 사례)
        pending_deliveries = (await db.execute(
            select(Delivery).where(
                Delivery.trip_id == active_vehicle_trip.id,
                Delivery.assigned_to == driver_uuid,
                Delivery.status == DeliveryStatus.in_progress,
            ).order_by(Delivery.sequence)
        )).scalars().all()
        waypoints = active_vehicle_trip.waypoints or []

        def _loading_departed(delivery_id) -> bool:
            wp = next((w for w in waypoints
                       if w.get('type') == 'loading' and w.get('delivery_id') == str(delivery_id)), None)
            return bool(wp.get('departed_at')) if wp else True

        for delivery in pending_deliveries:
            if delivery.lat is None or delivery.lon is None:
                continue
            distance_m = _haversine_km(lat, lon, delivery.lat, delivery.lon) * 1000
            if distance_m > ARRIVAL_RADIUS_M:
                continue
            # 상차 경유지를 아직 출발하지 않았다면 하차지 도착으로 보지 않는다 (적재 전 조기 완료 방지)
            if not _loading_departed(delivery.id):
                continue
            delivery.status = DeliveryStatus.done
            delivery.completed_at = datetime.utcnow()
            arrived_delivery_ids.append(str(delivery.id))

    await db.commit()

    eta_remaining_min = None
    active_trip_id = None
    active_trip = (await db.execute(
        select(Trip).where(
            Trip.driver_id == driver_uuid,
            Trip.status == TripStatus.in_progress,
        )
    )).scalar_one_or_none()

    if active_trip and active_trip.optimized_route:
        active_trip_id = str(active_trip.id)
        if arrived_delivery_ids:
            active_trip.current_phase = "unloading_completed"
            active_trip.phase_updated_at = datetime.utcnow()

        # ── 휴게소 체류 시간 감시 ──────────────────────────────
        route = active_trip.optimized_route.get("route", [])
        rest_nodes = [(i, n) for i, n in enumerate(route) if n.get("type") == "rest_stop"]
        now = datetime.utcnow()

        for idx, node in rest_nodes:
            checked_key = f"rest_checked:{active_trip_id}:{idx}"
            if redis.exists(checked_key):
                continue

            enter_key = f"rest_enter:{active_trip_id}:{idx}"
            rest_lat = node.get("lat")
            rest_lon = node.get("lon")
            if rest_lat is None or rest_lon is None:
                continue

            dist_m = _haversine_km(lat, lon, rest_lat, rest_lon) * 1000
            if dist_m <= REST_STOP_RADIUS_M:
                if not redis.exists(enter_key):
                    redis.setex(enter_key, 43200, now.isoformat())
            else:
                if redis.exists(enter_key):
                    entered_at_str = redis.get(enter_key)
                    redis.delete(enter_key)
                    try:
                        entered_at = datetime.fromisoformat(entered_at_str)
                        dwell_sec = (now - entered_at).total_seconds()
                    except Exception:
                        dwell_sec = 0

                    if dwell_sec < REST_STOP_MIN_DWELL_SEC:
                        if not active_trip.safety_issue:
                            active_trip.safety_issue = True
                        event = OrderEvent(
                            organization_id=current_user.organization_id,
                            trip_id=active_trip.id,
                            actor_id=driver_uuid,
                            actor_role="driver",
                            event_type="safety_rest_violation",
                            summary=f"{node.get('name', '휴게소')} {REST_STOP_MIN_DWELL_SEC // 60}분 미휴식 위반",
                            details={
                                "rest_name": node.get("name"),
                                "rest_lat": rest_lat,
                                "rest_lon": rest_lon,
                                "dwell_sec": round(dwell_sec, 1),
                                "threshold_sec": REST_STOP_MIN_DWELL_SEC,
                                "radius_m": REST_STOP_RADIUS_M,
                            },
                        )
                        db.add(event)
                    redis.setex(checked_key, 43200, "1")

        # ── 남은 경로 ETA 계산 ─────────────────────────────────
        route = active_trip.optimized_route.get("route", [])
        done_rows = (await db.execute(
            select(Delivery.lat, Delivery.lon).where(
                Delivery.trip_id == active_trip.id,
                Delivery.status.in_([DeliveryStatus.done, DeliveryStatus.done_manual]),
            )
        )).all()
        done_coordinates = [(row.lat, row.lon) for row in done_rows]
        remaining = [
            node for node in route
            if node.get("type") in ("waypoint", "destination")
            and not any(
                abs(node["lat"] - done_lat) < 0.001
                and abs(node["lon"] - done_lon) < 0.001
                for done_lat, done_lon in done_coordinates
            )
        ]

        if remaining:
            previous_lat, previous_lon = lat, lon
            total_km = 0.0
            for node in remaining:
                total_km += _haversine_km(
                    previous_lat,
                    previous_lon,
                    node["lat"],
                    node["lon"],
                )
                previous_lat, previous_lon = node["lat"], node["lon"]
            eta_remaining_min = round(total_km, 1)
        else:
            eta_remaining_min = 0.0

        redis.setex(f"eta:{active_trip.id}", 600, str(eta_remaining_min))
        if arrived_delivery_ids:
            await db.commit()

    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "user_id": user_id,
            "lat": lat,
            "lon": lon,
            "speed": speed,
            "arrived_deliveries": arrived_delivery_ids,
            "eta_remaining_min": eta_remaining_min,
            "trip_id": active_trip_id,
        })

    return {
        "received": True,
        "arrived_deliveries": arrived_delivery_ids,
        "eta_remaining_min": eta_remaining_min,
    }
