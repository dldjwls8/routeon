from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, update, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from core.managers import manager, redis
from models import Delivery, DeliveryStatus, Location, Trip, TripStatus, User, UserRole, Vehicle
from serializers.trip import (
    apply_delivery_to_waypoint,
    destination_waypoint,
    same_unloading_point,
)
from services.cargo_capacity import validate_vehicle_capacity_for_waypoints
from services.order_events import record_order_event

TRIP_PHASES = {
    "waiting",
    "en_route_to_loading",
    "loading_arrived",
    "loading_completed",
    "en_route_to_unloading",
    "unloading_arrived",
    "unloading_completed",
    "completed",
    "cancelled",
}


def assert_trip_access(t: Trip, current_user: User) -> None:
    if current_user.role == UserRole.driver:
        if str(t.driver_id) != str(current_user.id):
            raise HTTPException(403, "본인 운행만 조회할 수 있습니다.")
        return
    if current_user.role == UserRole.superadmin:
        return
    if not current_user.organization_id:
        raise HTTPException(403, "소속 조직이 없습니다.")
    if not t.driver or t.driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직 운행에는 접근할 수 없습니다.")


async def freeze_vehicle_position_from_driver(
    db: AsyncSession,
    *,
    vehicle_id: Optional[int],
    driver_id,
) -> None:
    if vehicle_id is None or driver_id is None:
        return
    vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))).scalar_one_or_none()
    if not vehicle:
        return

    now = datetime.utcnow()
    val = redis.get(f"location:{driver_id}")
    if val:
        lat_s, lon_s = val.split(",")
        vehicle.last_lat = float(lat_s)
        vehicle.last_lon = float(lon_s)
        vehicle.last_gps_at = now
        return

    loc = (await db.execute(
        select(Location)
        .where(Location.user_id == driver_id)
        .order_by(Location.recorded_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if loc:
        vehicle.last_lat = loc.lat
        vehicle.last_lon = loc.lon
        vehicle.last_gps_at = loc.recorded_at


async def cancel_trip_and_deliveries(
    db: AsyncSession,
    t: Trip,
    *,
    reason: Optional[str] = None,
    cancelled_by: Optional[str] = None,
    actor_user: Optional[User] = None,
    org_id: Optional[int] = None,
    notify: bool = True,
) -> None:
    t.status = TripStatus.cancelled
    t.current_phase = "cancelled"
    t.phase_updated_at = datetime.utcnow()
    t.cancel_requested = False
    if reason is not None:
        t.cancel_request_reason = reason

    await freeze_vehicle_position_from_driver(db, vehicle_id=t.vehicle_id, driver_id=t.driver_id)

    affected_deliveries = (await db.execute(
        select(Delivery).where(
            Delivery.trip_id == t.id,
            Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.in_progress]),
        )
    )).scalars().all()

    await db.execute(
        update(Delivery)
        .where(
            Delivery.trip_id == t.id,
            Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.in_progress]),
        )
        .values(status=DeliveryStatus.cancelled)
    )

    for delivery in affected_deliveries:
        record_order_event(
            db,
            organization_id=org_id,
            delivery_id=delivery.id,
            trip_id=t.id,
            actor=actor_user,
            actor_id=cancelled_by,
            event_type="trip.cancelled",
            summary="운행 취소",
            details={"reason": reason or ""},
        )

    if notify and org_id:
        payload = {
            "type": "trip.cancelled",
            "trip_id": str(t.id),
            "driver_id": str(t.driver_id),
            "reason": reason or "",
            "cancelled_by": cancelled_by or "",
            "message": "배차가 취소되었습니다.",
        }
        await manager.broadcast_replan_to_org(org_id, payload)
        await manager.broadcast_to_org(org_id, payload)


async def create_trip_record(
    db: AsyncSession,
    current_user: User,
    *,
    driver_id: str,
    vehicle_id: Optional[int],
    dest_name: Optional[str],
    dest_lat: Optional[float],
    dest_lon: Optional[float],
    waypoints: list[dict],
    departure_time: Optional[str],
    vehicle_height_m: Optional[float],
    vehicle_weight_kg: Optional[float],
    vehicle_length_cm: Optional[float],
    vehicle_width_cm: Optional[float],
) -> Trip:
    try:
        driver_uuid = uuid_lib.UUID(driver_id)
    except ValueError:
        raise HTTPException(400, "유효하지 않은 driver_id 형식입니다.")

    driver = (await db.execute(select(User).where(User.id == driver_uuid))).scalar_one_or_none()
    if not driver:
        raise HTTPException(404, "기사를 찾을 수 없습니다.")
    if driver.role != UserRole.driver:
        raise HTTPException(400, "지정한 사용자는 기사가 아닙니다.")
    if driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직의 기사에게 배차할 수 없습니다.")

    existing = (await db.execute(
        select(Trip).where(
            Trip.driver_id == driver_uuid,
            Trip.status.in_([TripStatus.scheduled, TripStatus.in_progress]),
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "해당 기사에게 이미 진행 중인 배차가 있습니다.")

    vehicle = None
    if vehicle_id is not None:
        vehicle = (await db.execute(
            select(Vehicle).where(
                Vehicle.id == vehicle_id,
                Vehicle.organization_id == current_user.organization_id,
            )
        )).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(404, "차량을 찾을 수 없습니다.")
        if not vehicle.is_active:
            raise HTTPException(400, "비활성화된 차량입니다.")

    waypoints_json = [dict(w) for w in waypoints]
    if dest_name and dest_lat is not None and dest_lon is not None:
        has_dest_waypoint = any(same_unloading_point(w, dest_lat, dest_lon) for w in waypoints_json)
        if not has_dest_waypoint:
            waypoints_json.append(destination_waypoint(dest_name, dest_lat, dest_lon))
    if not waypoints_json:
        raise HTTPException(400, "상차지 또는 하차지를 1개 이상 입력해주세요.")
    if vehicle:
        validate_vehicle_capacity_for_waypoints(vehicle, waypoints_json)

    delivery_ids: list[uuid_lib.UUID] = []
    for waypoint in waypoints_json:
        raw_delivery_id = waypoint.get("delivery_id")
        if raw_delivery_id:
            try:
                delivery_ids.append(uuid_lib.UUID(str(raw_delivery_id)))
            except ValueError:
                raise HTTPException(400, "유효하지 않은 delivery_id 형식입니다.")
            continue
        if waypoint.get("type") != "unloading" or waypoint.get("lat") is None or waypoint.get("lon") is None:
            continue
        matched_delivery = (await db.execute(
            select(Delivery).where(
                Delivery.organization_id == current_user.organization_id,
                or_(Delivery.assigned_to == driver_uuid, Delivery.assigned_to == None),
                Delivery.trip_id == None,
                Delivery.status.in_([DeliveryStatus.pending, DeliveryStatus.accepted, DeliveryStatus.in_progress]),
                Delivery.lat.between(float(waypoint["lat"]) - 0.0001, float(waypoint["lat"]) + 0.0001),
                Delivery.lon.between(float(waypoint["lon"]) - 0.0001, float(waypoint["lon"]) + 0.0001),
            ).order_by(Delivery.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        if matched_delivery:
            waypoint["delivery_id"] = str(matched_delivery.id)
            apply_delivery_to_waypoint(waypoint, matched_delivery)
            delivery_ids.append(matched_delivery.id)

    trip = Trip(
        driver_id=driver_uuid,
        vehicle_id=vehicle_id,
        dest_name=dest_name,
        dest_lat=dest_lat,
        dest_lon=dest_lon,
        waypoints=waypoints_json,
        departure_time=departure_time or datetime.utcnow().isoformat(),
        vehicle_height_m=vehicle_height_m if vehicle_height_m is not None else (vehicle.height_m if vehicle else None),
        vehicle_weight_kg=vehicle_weight_kg if vehicle_weight_kg is not None else (vehicle.weight_kg if vehicle else None),
        vehicle_length_cm=vehicle_length_cm if vehicle_length_cm is not None else (vehicle.length_cm if vehicle else None),
        vehicle_width_cm=vehicle_width_cm if vehicle_width_cm is not None else (vehicle.width_cm if vehicle else None),
    )
    db.add(trip)
    await db.flush()

    if delivery_ids:
        await db.execute(
            update(Delivery)
            .where(
                Delivery.id.in_(delivery_ids),
                Delivery.organization_id == current_user.organization_id,
            )
            .values(
                trip_id=trip.id,
                assigned_to=driver_uuid,
                status=DeliveryStatus.in_progress,
            )
        )
        for delivery_id in delivery_ids:
            record_order_event(
                db,
                organization_id=current_user.organization_id,
                delivery_id=delivery_id,
                trip_id=trip.id,
                actor=current_user,
                event_type="trip.assigned",
                summary=f"배차 생성: {driver.name or driver.username}",
                details={
                    "driver_id": str(driver_uuid),
                    "driver_name": driver.name or driver.username,
                    "vehicle_id": vehicle_id,
                },
            )

    await db.commit()
    await db.refresh(trip)
    return trip


async def change_trip_status(
    db: AsyncSession,
    trip: Trip,
    current_user: User,
    *,
    status: str,
) -> None:
    if status not in ("completed", "cancelled"):
        raise HTTPException(400, "status는 'completed' 또는 'cancelled'만 가능합니다.")
    if trip.status == TripStatus.completed:
        raise HTTPException(400, "이미 완료된 운행입니다.")
    if trip.status == TripStatus.cancelled:
        raise HTTPException(400, "이미 취소된 운행입니다.")

    if status == "completed":
        now = datetime.utcnow()
        trip.status = TripStatus.completed
        trip.current_phase = "completed"
        trip.phase_updated_at = now
        trip.completed_at = now
        await freeze_vehicle_position_from_driver(db, vehicle_id=trip.vehicle_id, driver_id=trip.driver_id)

        deliveries = (await db.execute(
            select(Delivery).where(
                Delivery.trip_id == trip.id,
                Delivery.status == DeliveryStatus.in_progress,
            )
        )).scalars().all()
        for delivery in deliveries:
            delivery.status = DeliveryStatus.done_manual
            delivery.completed_at = now
            record_order_event(
                db,
                organization_id=trip.driver.organization_id if trip.driver else current_user.organization_id,
                delivery_id=delivery.id,
                trip_id=trip.id,
                actor=current_user,
                event_type="trip.completed",
                summary="운행 완료",
                details={"completed_at": delivery.completed_at.isoformat()},
            )
    else:
        org_id = trip.driver.organization_id if trip.driver else current_user.organization_id
        cancel_reason = (
            "기사 앱에서 운행 취소"
            if current_user.role == UserRole.driver
            else "관리자 웹에서 배차 취소"
        )
        await cancel_trip_and_deliveries(
            db,
            trip,
            reason=cancel_reason,
            cancelled_by=str(current_user.id),
            actor_user=current_user,
            org_id=org_id,
        )

    await db.commit()
    await db.refresh(trip)


def _phase_from_waypoint_event(waypoint: dict, event: str) -> str:
    is_loading = waypoint.get("type") == "loading"
    if event == "arrived":
        return "loading_arrived" if is_loading else "unloading_arrived"
    if event in ("departed", "completed"):
        return "loading_completed" if is_loading else "unloading_completed"
    raise HTTPException(400, "event는 arrived, departed, completed 중 하나여야 합니다.")


def _waypoint_event_summary(waypoint: dict, event: str) -> str:
    is_loading = waypoint.get("type") == "loading"
    place = waypoint.get("name") or ("상차지" if is_loading else "하차지")
    if event == "arrived":
        return f"{'상차' if is_loading else '하차'} 도착: {place}"
    return f"{'상차' if is_loading else '하차'} 완료: {place}"


async def update_trip_progress_state(
    db: AsyncSession,
    trip: Trip,
    current_user: User,
    *,
    phase: Optional[str],
    waypoint_index: Optional[int],
    event: Optional[str],
    event_time: Optional[str],
) -> None:
    if trip.status in (TripStatus.completed, TripStatus.cancelled):
        raise HTTPException(400, "완료/취소된 운행은 진행 상태를 변경할 수 없습니다.")

    resolved_event_time = event_time or datetime.utcnow().isoformat()
    waypoints = list(trip.waypoints or [])
    resolved_phase = phase
    event_waypoint = None
    event_name = None

    if waypoint_index is not None:
        idx = int(waypoint_index)
        if idx < 0 or idx >= len(waypoints):
            raise HTTPException(400, "waypoint_index가 범위를 벗어났습니다.")
        event_name = event or "arrived"
        if event_name not in ("arrived", "departed", "completed"):
            raise HTTPException(400, "event는 arrived, departed, completed 중 하나여야 합니다.")
        key = "arrived_at" if event_name == "arrived" else "departed_at"
        waypoints[idx][key] = resolved_event_time
        event_waypoint = dict(waypoints[idx])
        resolved_phase = resolved_phase or _phase_from_waypoint_event(waypoints[idx], event_name)
        trip.waypoints = waypoints
        flag_modified(trip, "waypoints")

    if not resolved_phase:
        raise HTTPException(400, "phase 또는 waypoint_index/event를 입력해주세요.")
    if resolved_phase not in TRIP_PHASES:
        raise HTTPException(400, f"올바르지 않은 phase: {resolved_phase}")

    if trip.status == TripStatus.scheduled:
        trip.status = TripStatus.in_progress
        trip.started_at = trip.started_at or datetime.utcnow()
        for delivery in trip.deliveries:
            record_order_event(
                db,
                organization_id=trip.driver.organization_id if trip.driver else current_user.organization_id,
                delivery_id=delivery.id,
                trip_id=trip.id,
                actor=current_user,
                event_type="trip.started",
                summary="기사 운행 시작",
                details={"started_at": trip.started_at.isoformat()},
            )
    trip.current_phase = resolved_phase
    trip.phase_updated_at = datetime.utcnow()

    if event_waypoint:
        record_order_event(
            db,
            organization_id=trip.driver.organization_id if trip.driver else current_user.organization_id,
            delivery_id=event_waypoint.get("delivery_id"),
            trip_id=trip.id,
            actor=current_user,
            event_type=f"trip.waypoint_{event_name}",
            summary=_waypoint_event_summary(event_waypoint, event_name),
            details={
                "waypoint_index": waypoint_index,
                "event": event_name,
                "event_time": resolved_event_time,
                "waypoint": event_waypoint,
                "phase": resolved_phase,
            },
        )

    await db.commit()
    await db.refresh(trip)

    if trip.driver and trip.driver.organization_id:
        await manager.broadcast_to_org(trip.driver.organization_id, {
            "type": "trip.progress_updated",
            "trip_id": str(trip.id),
            "driver_id": str(trip.driver_id),
            "current_phase": trip.current_phase,
            "waypoint_index": waypoint_index,
            "event": event,
        })


async def reassign_trip_record(
    db: AsyncSession,
    trip: Trip,
    current_user: User,
    *,
    new_driver_id: Optional[str],
    new_vehicle_id: Optional[int],
    transfer_remaining: bool,
) -> Optional[str]:
    if not new_driver_id and new_vehicle_id is None:
        raise HTTPException(400, "교체할 기사 ID 또는 차량 ID를 입력해주세요.")
    if not trip.driver or trip.driver.organization_id != current_user.organization_id:
        raise HTTPException(403, "다른 조직 운행은 교체할 수 없습니다.")
    if trip.status not in (TripStatus.scheduled, TripStatus.in_progress):
        raise HTTPException(400, "완료되거나 취소된 운행은 교체할 수 없습니다.")

    new_trip_id = None

    if new_driver_id:
        try:
            new_driver_uuid = uuid_lib.UUID(new_driver_id)
        except ValueError:
            raise HTTPException(400, "유효하지 않은 new_driver_id 형식입니다.")
        new_driver = (await db.execute(
            select(User).where(User.id == new_driver_uuid)
        )).scalar_one_or_none()
        if not new_driver:
            raise HTTPException(404, "교체할 기사를 찾을 수 없습니다.")
        if new_driver.role != UserRole.driver:
            raise HTTPException(400, "지정한 사용자는 기사가 아닙니다.")
        if new_driver.organization_id != current_user.organization_id:
            raise HTTPException(403, "다른 조직의 기사로 교체할 수 없습니다.")

        if transfer_remaining:
            if new_vehicle_id is not None:
                vehicle = (await db.execute(
                    select(Vehicle).where(
                        Vehicle.id == new_vehicle_id,
                        Vehicle.organization_id == current_user.organization_id,
                    )
                )).scalar_one_or_none()
                if not vehicle:
                    raise HTTPException(404, "차량을 찾을 수 없습니다.")
                if not vehicle.is_active:
                    raise HTTPException(400, "비활성화된 차량입니다.")

            await cancel_trip_and_deliveries(
                db,
                trip,
                reason="기사·차량 교체로 기존 배차 취소",
                cancelled_by=str(current_user.id),
                actor_user=current_user,
                org_id=current_user.organization_id,
            )
            chosen_vehicle = new_vehicle_id if new_vehicle_id is not None else trip.vehicle_id
            new_trip = Trip(
                driver_id=new_driver_uuid,
                vehicle_id=chosen_vehicle,
                dest_name=trip.dest_name,
                dest_lat=trip.dest_lat,
                dest_lon=trip.dest_lon,
                waypoints=list(trip.waypoints or []),
                departure_time=trip.departure_time,
            )
            db.add(new_trip)
            await db.flush()
            new_trip_id = str(new_trip.id)

            delivery_ids = []
            for waypoint in list(trip.waypoints or []):
                raw_delivery_id = waypoint.get("delivery_id") if isinstance(waypoint, dict) else None
                if not raw_delivery_id:
                    continue
                try:
                    delivery_ids.append(uuid_lib.UUID(str(raw_delivery_id)))
                except ValueError:
                    pass
            if delivery_ids:
                await db.execute(
                    update(Delivery)
                    .where(
                        Delivery.id.in_(delivery_ids),
                        Delivery.organization_id == current_user.organization_id,
                    )
                    .values(
                        trip_id=new_trip.id,
                        assigned_to=new_driver_uuid,
                        status=DeliveryStatus.in_progress,
                    )
                )
                for delivery_id in delivery_ids:
                    record_order_event(
                        db,
                        organization_id=current_user.organization_id,
                        delivery_id=delivery_id,
                        trip_id=new_trip.id,
                        actor=current_user,
                        event_type="trip.reassigned",
                        summary=f"잔여 운행 이관: {new_driver.name or new_driver.username}",
                        details={
                            "old_trip_id": str(trip.id),
                            "new_trip_id": str(new_trip.id),
                            "new_driver_id": str(new_driver_uuid),
                            "new_vehicle_id": chosen_vehicle,
                        },
                    )
        else:
            existing = (await db.execute(
                select(Trip).where(
                    Trip.driver_id == new_driver_uuid,
                    Trip.status.in_([TripStatus.scheduled, TripStatus.in_progress]),
                )
            )).scalar_one_or_none()
            if existing:
                raise HTTPException(409, "해당 기사에게 이미 진행 중인 배차가 있습니다.")
            trip.driver_id = new_driver_uuid
            for delivery in trip.deliveries:
                record_order_event(
                    db,
                    organization_id=current_user.organization_id,
                    delivery_id=delivery.id,
                    trip_id=trip.id,
                    actor=current_user,
                    event_type="trip.reassigned",
                    summary=f"기사 교체: {new_driver.name or new_driver.username}",
                    details={"new_driver_id": str(new_driver_uuid)},
                )

    if new_vehicle_id is not None and not transfer_remaining:
        vehicle = (await db.execute(
            select(Vehicle).where(
                Vehicle.id == new_vehicle_id,
                Vehicle.organization_id == current_user.organization_id,
            )
        )).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(404, "차량을 찾을 수 없습니다.")
        if not vehicle.is_active:
            raise HTTPException(400, "비활성화된 차량입니다.")
        trip.vehicle_id = new_vehicle_id
        for delivery in trip.deliveries:
            record_order_event(
                db,
                organization_id=current_user.organization_id,
                delivery_id=delivery.id,
                trip_id=trip.id,
                actor=current_user,
                event_type="trip.vehicle_changed",
                summary=f"차량 교체: {new_vehicle_id}",
                details={"new_vehicle_id": new_vehicle_id},
            )

    await db.commit()

    if current_user.organization_id:
        await manager.broadcast_to_org(current_user.organization_id, {
            "type": "trip.reassigned",
            "trip_id": str(trip.id),
            "driver_id": str(trip.driver_id),
            "new_trip_id": new_trip_id,
        })
    return new_trip_id
