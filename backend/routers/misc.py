import asyncio
import httpx
import shutil
import uuid as uuid_lib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, or_, func, cast, Float, update, delete
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from database import get_db
from models import (
    User, Delivery, Trip, Vehicle, RestStop, Location, Organization,
    Conversation, Message, Preset,
    DeliveryStatus, TripStatus, RestStopType, UserRole, OrgStatus
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, get_current_user_from_token,
    require_admin, require_driver, require_superadmin,
)
from services.optimizer import solve_tsp, validate_tsp_constraints
from services.rest_stop_inserter import RouteNode, insert_rest_stops
from services.email_service import send_approved, send_rejected
from services import kakao_mobility
from services import graphhopper as gh_svc
from core.config import ARRIVAL_RADIUS_M, UPLOAD_DIR, ALLOWED_EXTS, MAX_FILE_SIZE, KAKAO_BASE, KAKAO_REST_KEY, KAKAO_JS_KEY
from core.managers import manager, redis, chat_manager
from core.utils import _haversine, _haversine_km, _coord_to_address

router = APIRouter()

class RestSearchRequest(BaseModel):
    lat: float
    lon: float
    radius: int = 300
    category: str = "CE7"

class AddressRequest(BaseModel):
    query: str   # 검색할 주소


@router.get("/health")
async def health():
    return {
        "status":        "ok",
        "kakao_key_set": bool(KAKAO_REST_KEY),
    }

@router.get("/config")
async def config():
    if not KAKAO_JS_KEY:
        raise HTTPException(503, "KAKAO_JS_KEY가 설정되지 않았습니다.")
    return {"kakao_js_key": KAKAO_JS_KEY}


@router.post("/rest-spots")
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

@router.get("/address/coord")
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
