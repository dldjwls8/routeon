from datetime import datetime

from models import Delivery, Trip


def same_unloading_point(waypoint: dict, lat: float, lon: float) -> bool:
    if waypoint.get("type") == "loading":
        return False
    try:
        waypoint_lat = float(waypoint.get("lat"))
        waypoint_lon = float(waypoint.get("lon"))
    except (TypeError, ValueError):
        return False
    return abs(waypoint_lat - lat) < 1e-6 and abs(waypoint_lon - lon) < 1e-6


def destination_waypoint(name: str, lat: float, lon: float) -> dict:
    return {
        "name": name,
        "lat": lat,
        "lon": lon,
        "type": "unloading",
        "task_group": None,
        "recipient_name": None,
        "cargo_type": None,
        "cargo_size": None,
        "cargo_weight_ton": None,
        "shipper_name": None,
        "contact_name": None,
        "contact_phone": None,
        "shipper_phone": None,
        "delivery_id": None,
    }


def apply_delivery_to_waypoint(waypoint: dict, delivery: Delivery) -> None:
    stamp = (delivery.created_at or datetime.utcnow()).strftime("%y%m%d")
    waypoint["order_no"] = (
        waypoint.get("order_no")
        or f"RO-{stamp}-{str(delivery.id).replace('-', '')[-6:].upper()}"
    )
    waypoint["recipient_name"] = waypoint.get("recipient_name") or delivery.recipient_name
    waypoint["cargo_type"] = waypoint.get("cargo_type") or delivery.cargo_type
    waypoint["cargo_size"] = waypoint.get("cargo_size") or delivery.cargo_size
    waypoint["cargo_weight_ton"] = (
        waypoint.get("cargo_weight_ton")
        if waypoint.get("cargo_weight_ton") is not None
        else delivery.cargo_weight_ton
    )
    waypoint["shipper_name"] = waypoint.get("shipper_name") or delivery.shipper_name
    waypoint["contact_name"] = waypoint.get("contact_name") or delivery.contact_name
    waypoint["contact_phone"] = waypoint.get("contact_phone") or delivery.contact_phone
    waypoint["shipper_phone"] = (
        waypoint.get("shipper_phone")
        or delivery.shipper_phone
        or delivery.contact_phone
    )


def trip_waypoints_for_response(trip: Trip) -> list[dict]:
    response_waypoints = [dict(waypoint) for waypoint in (trip.waypoints or [])]
    deliveries = trip.__dict__.get("deliveries") or []
    deliveries_by_id = {str(delivery.id): delivery for delivery in deliveries}

    for waypoint in response_waypoints:
        delivery_id = waypoint.get("delivery_id")
        delivery = deliveries_by_id.get(str(delivery_id)) if delivery_id else None
        if delivery:
            apply_delivery_to_waypoint(waypoint, delivery)

    if trip.dest_name and trip.dest_lat is not None and trip.dest_lon is not None:
        has_destination = any(
            same_unloading_point(waypoint, trip.dest_lat, trip.dest_lon)
            for waypoint in response_waypoints
        )
        if not has_destination:
            response_waypoints.append(
                destination_waypoint(trip.dest_name, trip.dest_lat, trip.dest_lon)
            )
    return response_waypoints


def serialize_trip(trip: Trip) -> dict:
    waypoints = trip_waypoints_for_response(trip)
    loading_count = sum(1 for waypoint in waypoints if waypoint.get("type") == "loading")
    unloading_count = sum(1 for waypoint in waypoints if waypoint.get("type") != "loading")
    return {
        "id": str(trip.id),
        "driver_id": str(trip.driver_id),
        "vehicle_id": trip.vehicle_id,
        "dest_name": trip.dest_name,
        "dest_lat": trip.dest_lat,
        "dest_lon": trip.dest_lon,
        "waypoints": waypoints,
        "optimized_route": trip.optimized_route,
        "status": trip.status,
        "departure_time": trip.departure_time,
        "current_phase": trip.current_phase or "waiting",
        "phase_updated_at": trip.phase_updated_at.isoformat() + "Z" if trip.phase_updated_at else None,
        "is_emergency": trip.is_emergency,
        "created_at": trip.created_at.isoformat() + "Z",
        "started_at": trip.started_at.isoformat() + "Z" if trip.started_at else None,
        "completed_at": trip.completed_at.isoformat() + "Z" if trip.completed_at else None,
        "loading_count": loading_count,
        "unloading_count": unloading_count,
        "cancel_requested": bool(trip.cancel_requested),
        "cancel_request_reason": trip.cancel_request_reason,
    }
