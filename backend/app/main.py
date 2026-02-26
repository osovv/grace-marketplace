import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import engine, Base
from app.routers import auth, tenants, projects, boq, library, schedule, export


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create data directories
    os.makedirs(os.path.join(settings.DATA_DIR, "uploads"), exist_ok=True)
    os.makedirs(os.path.join(settings.DATA_DIR, "exports"), exist_ok=True)

    # Create tables (for SQLite dev; in production use Alembic)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield


app = FastAPI(
    title="EPC Planning Automation Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(tenants.router)
app.include_router(projects.router)
app.include_router(boq.router)
app.include_router(library.router)
app.include_router(schedule.router)
app.include_router(export.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "EPC Planning Automation Engine"}
