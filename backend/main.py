"""
RouteOn Backend — FastAPI
경로 최적화 + 배송 관리 + GPS 위치 수신
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database import init_db
from routers import misc, vehicles, trips, optimize, dispatch, organizations, chat, deliveries, location, stats
from routers import auth as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="RouteOn API",
    description="배송 최적화 서비스 — 경로 최적화 + 배송 관리 + GPS",
    version="0.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


app.include_router(misc.router)
app.include_router(vehicles.router)
app.include_router(trips.router)
app.include_router(optimize.router)
app.include_router(dispatch.router)
app.include_router(organizations.router)
app.include_router(auth_router.router)
app.include_router(chat.router)
app.include_router(deliveries.router)
app.include_router(location.router)
app.include_router(stats.router)
