from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from models import Trip, Delivery


class WaypointSchema(BaseModel):
    name:             str
    lat:              float
    lon:              float
    type:             str            = "unloading"  # "loading" | "unloading"
    task_group:       Optional[int] = None
    recipient_name:   Optional[str] = None
    cargo_type:       Optional[str] = None
    cargo_size:       Optional[str] = None
    cargo_weight_ton: Optional[float] = None
    shipper_name:     Optional[str] = None
    contact_name:     Optional[str] = None
    contact_phone:    Optional[str] = None
    shipper_phone:    Optional[str] = None
    delivery_id:      Optional[str] = None


def _same_unloading_point(w: dict, lat: float, lon: float) -> bool:
    if w.get("type") == "loading":
        return False
    try:
        w_lat = float(w.get("lat"))
        w_lon = float(w.get("lon"))
    except (TypeError, ValueError):
        return False
    return abs(w_lat - lat) < 1e-6 and abs(w_lon - lon) < 1e-6


def _dest_waypoint(name: str, lat: float, lon: float) -> dict:
    return {
        "name": name, "lat": lat, "lon": lon, "type": "unloading",
        "task_group": None, "recipient_name": None, "cargo_type": None,
        "cargo_size": None, "cargo_weight_ton": None, "shipper_name": None,
        "contact_name": None, "contact_phone": None, "shipper_phone": None,
        "delivery_id": None,
    }


def _apply_delivery_to_waypoint(w: dict, delivery: Delivery) -> None:
    stamp = (delivery.created_at or datetime.utcnow()).strftime("%y%m%d")
    w["order_no"] = w.get("order_no") or f"RO-{stamp}-{str(delivery.id).replace('-', '')[-6:].upper()}"
    w["recipient_name"] = w.get("recipient_name") or delivery.recipient_name
    w["cargo_type"] = w.get("cargo_type") or delivery.cargo_type
    w["cargo_size"] = w.get("cargo_size") or delivery.cargo_size
    w["cargo_weight_ton"] = (
        w.get("cargo_weight_ton")
        if w.get("cargo_weight_ton") is not None
        else delivery.cargo_weight_ton
    )
    w["shipper_name"] = w.get("shipper_name") or delivery.shipper_name
    w["contact_name"] = w.get("contact_name") or delivery.contact_name
    w["contact_phone"] = w.get("contact_phone") or delivery.contact_phone
    w["shipper_phone"] = w.get("shipper_phone") or delivery.shipper_phone or delivery.contact_phone


def _trip_waypoints_for_response(t: Trip) -> list[dict]:
    wp = t.waypoints or []
    response_wp = [dict(w) for w in wp]
    deliveries = t.__dict__.get("deliveries") or []
    deliveries_by_id = {str(d.id): d for d in deliveries}
    for w in response_wp:
        delivery_id = w.get("delivery_id")
        delivery = deliveries_by_id.get(str(delivery_id)) if delivery_id else None
        if delivery:
            _apply_delivery_to_waypoint(w, delivery)
    if t.dest_name and t.dest_lat is not None and t.dest_lon is not None:
        has_dest_waypoint = any(_same_unloading_point(w, t.dest_lat, t.dest_lon) for w in response_wp)
        if not has_dest_waypoint:
            response_wp.append(_dest_waypoint(t.dest_name, t.dest_lat, t.dest_lon))
    return response_wp


def trip_schema(t: Trip) -> dict:
    wp = _trip_waypoints_for_response(t)
    loadings   = sum(1 for w in wp if w.get("type") == "loading")
    unloadings = sum(1 for w in wp if w.get("type") != "loading")
    return {
        "id": str(t.id), "driver_id": str(t.driver_id), "vehicle_id": t.vehicle_id,
        "dest_name": t.dest_name, "dest_lat": t.dest_lat, "dest_lon": t.dest_lon,
        "waypoints": wp, "optimized_route": t.optimized_route,
        "status": t.status, "departure_time": t.departure_time,
        "current_phase": t.current_phase or "waiting",
        "phase_updated_at": t.phase_updated_at.isoformat() + "Z" if t.phase_updated_at else None,
        "is_emergency": t.is_emergency, "created_at": t.created_at.isoformat() + "Z",
        "started_at": t.started_at.isoformat() + "Z" if t.started_at else None,
        "completed_at": t.completed_at.isoformat() + "Z" if t.completed_at else None,
        "loading_count": loadings, "unloading_count": unloadings,
        "cancel_requested": bool(t.cancel_requested),
        "cancel_request_reason": t.cancel_request_reason,
    }
