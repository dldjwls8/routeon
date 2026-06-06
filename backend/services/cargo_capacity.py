import re
from typing import Iterable, Optional

from fastapi import HTTPException


_TON_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(?:톤|t\b|ton(?:ne)?s?)", re.IGNORECASE)


def parse_ton_from_cargo_size(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    match = _TON_PATTERN.search(str(value))
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def cargo_ton_from_waypoint(waypoint: dict) -> Optional[float]:
    raw_weight = waypoint.get("cargo_weight_ton")
    if raw_weight is not None:
        try:
            return float(raw_weight)
        except (TypeError, ValueError):
            return None
    return parse_ton_from_cargo_size(waypoint.get("cargo_size"))


def max_cargo_ton_from_waypoints(waypoints: Iterable[dict]) -> Optional[float]:
    tons = [
        ton
        for waypoint in waypoints
        if waypoint.get("type") != "loading"
        for ton in [cargo_ton_from_waypoint(waypoint)]
        if ton is not None
    ]
    return max(tons) if tons else None


def validate_vehicle_capacity_for_waypoints(vehicle, waypoints: Iterable[dict]) -> None:
    if not vehicle or not vehicle.weight_kg:
        return
    max_cargo_ton = max_cargo_ton_from_waypoints(waypoints)
    if max_cargo_ton is None:
        return
    vehicle_ton = float(vehicle.weight_kg) / 1000
    if max_cargo_ton > vehicle_ton:
        label = getattr(vehicle, "plate_number", None) or f"차량 {getattr(vehicle, 'id', '')}".strip()
        raise HTTPException(
            400,
            f"화물 규격 {max_cargo_ton:g}톤은 {label} 적재 가능 중량 {vehicle_ton:g}톤을 초과합니다.",
        )


def vehicle_can_carry_waypoints(vehicle, waypoints: Iterable[dict]) -> bool:
    if not vehicle or not vehicle.weight_kg:
        return True
    max_cargo_ton = max_cargo_ton_from_waypoints(waypoints)
    if max_cargo_ton is None:
        return True
    return max_cargo_ton <= float(vehicle.weight_kg) / 1000
