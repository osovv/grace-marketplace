from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any
from datetime import datetime


# ── Auth ──────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: str
    password: str
    tenant_name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


# ── Tenant ────────────────────────────────────────────────────────────────
class TenantOut(BaseModel):
    id: str
    name: str
    plan: str
    role: str  # user's role in this tenant

    class Config:
        from_attributes = True


# ── Project ───────────────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    name: str


class ProjectOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    calendar_code: str
    area_map_json: dict = {}
    created_at: datetime | None = None

    class Config:
        from_attributes = True


# ── BOQ ───────────────────────────────────────────────────────────────────
class BOQItemOut(BaseModel):
    id: str
    project_id: str
    code: str | None = None
    description: str | None = None
    qty: float | None = 0
    uom: str | None = None
    area_raw: str | None = None
    area_norm: str | None = None
    discipline: str | None = None
    work_type: str | None = None
    package_code: str | None = None
    meta_json: dict = {}

    class Config:
        from_attributes = True


class BOQItemPatch(BaseModel):
    area_norm: str | None = None
    discipline: str | None = None
    work_type: str | None = None
    qty: float | None = None
    uom: str | None = None


# ── Template ──────────────────────────────────────────────────────────────
class TemplateCreate(BaseModel):
    discipline: str
    work_type: str
    name: str
    steps_json: list = []
    rules_json: dict = {}


class TemplatePatch(BaseModel):
    name: str | None = None
    steps_json: list | None = None
    rules_json: dict | None = None


class TemplateOut(BaseModel):
    id: str
    discipline: str | None = None
    work_type: str | None = None
    name: str | None = None
    steps_json: list = []
    rules_json: dict = {}
    is_global: bool = False
    version: int = 1

    class Config:
        from_attributes = True


# ── Productivity Norm ─────────────────────────────────────────────────────
class NormCreate(BaseModel):
    discipline: str
    work_type: str
    uom: str
    mh_per_uom: float = 1.0
    crew_json: dict = {}
    labor_rate: float = 0.0


class NormPatch(BaseModel):
    uom: str | None = None
    mh_per_uom: float | None = None
    crew_json: dict | None = None
    labor_rate: float | None = None


class NormOut(BaseModel):
    id: str
    discipline: str | None = None
    work_type: str | None = None
    uom: str | None = None
    mh_per_uom: float | None = None
    crew_json: dict = {}
    labor_rate: float | None = None
    version: int = 1

    class Config:
        from_attributes = True


# ── Area Dictionary ───────────────────────────────────────────────────────
class AreaCreate(BaseModel):
    code: str
    keywords_json: list = []
    priority: int = 100


class AreaPatch(BaseModel):
    keywords_json: list | None = None
    priority: int | None = None


class AreaOut(BaseModel):
    id: str
    code: str
    keywords_json: list = []
    priority: int = 100

    class Config:
        from_attributes = True


# ── Activity ──────────────────────────────────────────────────────────────
class ActivityOut(BaseModel):
    id: str
    act_uid: str
    act_id: str | None = None
    name: str | None = None
    phase: str | None = None
    area: str | None = None
    discipline: str | None = None
    package_code: str | None = None
    seq: int | None = None
    dur_hr: float | None = 0
    mh: float | None = 0
    rom_cost: float | None = 0
    wbs_id: str | None = None
    calendar_code: str | None = None
    meta_json: dict = {}

    class Config:
        from_attributes = True


class ActivityPatch(BaseModel):
    name: str | None = None
    dur_hr: float | None = None


# ── Relationship ──────────────────────────────────────────────────────────
class RelationshipCreate(BaseModel):
    pred_act_uid: str
    succ_act_uid: str
    rel_type: str = "FS"
    lag_hr: float = 0


class RelationshipOut(BaseModel):
    id: str
    pred_act_uid: str
    succ_act_uid: str
    rel_type: str = "FS"
    lag_hr: float = 0

    class Config:
        from_attributes = True


# ── WBS ───────────────────────────────────────────────────────────────────
class WBSNodeOut(BaseModel):
    id: str
    parent_id: str | None = None
    level: int
    code: str
    name: str | None = None

    class Config:
        from_attributes = True


# ── Schedule (composite response) ────────────────────────────────────────
class ScheduleOut(BaseModel):
    wbs: list[WBSNodeOut] = []
    activities: list[ActivityOut] = []
    relationships: list[RelationshipOut] = []
    total_mh: float = 0
    total_rom: float = 0
    total_dur_hr: float = 0
    warnings: list[str] = []


# ── Version ───────────────────────────────────────────────────────────────
class VersionCreate(BaseModel):
    label: str


class VersionOut(BaseModel):
    id: str
    label: str
    created_at: datetime | None = None
    created_by: str | None = None

    class Config:
        from_attributes = True
