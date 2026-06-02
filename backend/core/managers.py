import redis as redis_client
from fastapi import WebSocket

from core.config import REDIS_HOST
from services.chat_manager import ChatConnectionManager


class ConnectionManager:
    def __init__(self):
        self.active:  dict[int, list[WebSocket]] = {}  # org_id → [ws] (admin)
        self.drivers: dict[int, list[WebSocket]] = {}  # org_id → [ws] (driver)

    async def connect(self, ws: WebSocket, org_id: int):
        await ws.accept()
        self.active.setdefault(org_id, []).append(ws)

    async def connect_driver(self, ws: WebSocket, org_id: int):
        await ws.accept()
        self.drivers.setdefault(org_id, []).append(ws)

    def disconnect(self, ws: WebSocket, org_id: int):
        for pool in (self.active, self.drivers):
            sockets = pool.get(org_id, [])
            if ws in sockets:
                sockets.remove(ws)
                return

    async def broadcast_to_org(self, org_id: int, data: dict):
        """같은 조직 관리자에게 위치 데이터 전송"""
        import json
        payload = json.dumps(data, ensure_ascii=False)
        dead = []
        for ws in list(self.active.get(org_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, org_id)

    async def broadcast_replan_to_org(self, org_id: int, data: dict):
        """같은 조직 기사(앱)에게 replan 이벤트 전송"""
        import json
        payload = json.dumps(data, ensure_ascii=False)
        dead = []
        for ws in list(self.drivers.get(org_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, org_id)

manager = ConnectionManager()
redis = redis_client.Redis(host=REDIS_HOST, port=6379, decode_responses=True)
chat_manager = ChatConnectionManager()
