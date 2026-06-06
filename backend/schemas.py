from typing import Optional

from pydantic import BaseModel


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
