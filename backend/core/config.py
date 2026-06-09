import os
from pathlib import Path

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
ARRIVAL_RADIUS_M = 50
REST_STOP_RADIUS_M = 200          # 휴게소 반경(도착 판정)
REST_STOP_MIN_DWELL_SEC = 900   # 법정 최소 휴식 시간(15분)

UPLOAD_DIR = Path("/app/uploads/docs")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 10 * 1024 * 1024

KAKAO_BASE = "https://dapi.kakao.com"
KAKAO_REST_KEY = os.getenv("KAKAO_REST_API_KEY", "")
KAKAO_JS_KEY = os.getenv("KAKAO_JS_KEY", "")
