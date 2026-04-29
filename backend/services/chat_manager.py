"""
User-scoped WebSocket fan-out for chat messages.
"""

import json

from fastapi import WebSocket


class ChatConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        sockets = self.active.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self.active.pop(user_id, None)

    async def send_to_user(self, user_id: str, event: dict) -> None:
        sockets = list(self.active.get(user_id, set()))
        if not sockets:
            return

        payload = json.dumps(event, ensure_ascii=False)
        dead: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_text(payload)
            except Exception:
                dead.append(websocket)

        for websocket in dead:
            self.disconnect(user_id, websocket)

    async def send_to_many(self, user_ids: list[str], event: dict) -> None:
        for user_id in set(user_ids):
            await self.send_to_user(user_id, event)

    def is_connected(self, user_id: str) -> bool:
        return bool(self.active.get(user_id))
