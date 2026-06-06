from datetime import datetime
import uuid as uuid_lib

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import ARRIVAL_RADIUS_M
from core.managers import manager, redis
from core.utils import _haversine_km
from models import Delivery, DeliveryStatus, Location, Trip, TripStatus, User, Vehicle


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

    pending_deliveries = (await db.execute(
        select(Delivery).where(
            Delivery.assigned_to == driver_uuid,
            Delivery.status == DeliveryStatus.in_progress,
        ).order_by(Delivery.sequence)
    )).scalars().all()

    arrived_delivery_ids = []
    for delivery in pending_deliveries:
        if delivery.lat is None or delivery.lon is None:
            continue
        distance_m = _haversine_km(lat, lon, delivery.lat, delivery.lon) * 1000
        if distance_m <= ARRIVAL_RADIUS_M:
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
