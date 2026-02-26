import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Numeric, ForeignKey,
    DateTime, CheckConstraint, UniqueConstraint, JSON, text,
)
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import relationship

from app.db import Base


def _uuid():
    return str(uuid.uuid4())


def _utcnow():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------
class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(Text, nullable=False)
    plan = Column(Text, default="free")
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    memberships = relationship("Membership", back_populates="tenant")
    projects = relationship("Project", back_populates="tenant")


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    email = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    memberships = relationship("Membership", back_populates="user")


# ---------------------------------------------------------------------------
# Memberships (tenant <-> user with role)
# ---------------------------------------------------------------------------
class Membership(Base):
    __tablename__ = "memberships"

    tenant_id = Column(String(36), ForeignKey("tenants.id"), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id"), primary_key=True)
    role = Column(Text, nullable=False, default="viewer")
    status = Column(Text, default="active")
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        CheckConstraint("role IN ('admin','planner','viewer')", name="ck_membership_role"),
    )

    tenant = relationship("Tenant", back_populates="memberships")
    user = relationship("User", back_populates="memberships")


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------
class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"))
    user_id = Column(String(36), ForeignKey("users.id"))
    entity = Column(Text)
    entity_id = Column(Text)
    action = Column(Text)  # CREATE/UPDATE/DELETE/EXPORT/IMPORT
    diff_json = Column(JSON, default=dict)
    ts = Column(DateTime(timezone=True), default=_utcnow)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
class Project(Base):
    __tablename__ = "projects"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    name = Column(Text, nullable=False)
    calendar_code = Column(Text, default="CAL-5X8")
    area_map_json = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    tenant = relationship("Tenant", back_populates="projects")
    boq_items = relationship("BOQItem", back_populates="project", cascade="all, delete-orphan")
    wbs_nodes = relationship("WBSNode", back_populates="project", cascade="all, delete-orphan")
    activities = relationship("Activity", back_populates="project", cascade="all, delete-orphan")
    relationships = relationship("Relationship", back_populates="project", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# Area Dictionary
# ---------------------------------------------------------------------------
class AreaDictionary(Base):
    __tablename__ = "area_dictionary"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    code = Column(Text, nullable=False)
    keywords_json = Column(JSON, default=list)
    priority = Column(Integer, default=100)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
class Template(Base):
    __tablename__ = "templates"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    discipline = Column(Text)
    work_type = Column(Text)
    name = Column(Text)
    steps_json = Column(JSON, default=list)
    rules_json = Column(JSON, default=dict)
    is_global = Column(Boolean, default=False)
    version = Column(Integer, default=1)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


# ---------------------------------------------------------------------------
# Productivity Norms
# ---------------------------------------------------------------------------
class ProductivityNorm(Base):
    __tablename__ = "productivity_norms"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    discipline = Column(Text)
    work_type = Column(Text)
    uom = Column(Text)
    mh_per_uom = Column(Numeric, default=1)
    crew_json = Column(JSON, default=dict)
    labor_rate = Column(Numeric, default=0)
    version = Column(Integer, default=1)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


# ---------------------------------------------------------------------------
# BOQ Items
# ---------------------------------------------------------------------------
class BOQItem(Base):
    __tablename__ = "boq_items"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    code = Column(Text)
    description = Column(Text)
    qty = Column(Numeric, default=0)
    uom = Column(Text)
    area_raw = Column(Text)
    area_norm = Column(Text)
    discipline = Column(Text)
    work_type = Column(Text)
    package_code = Column(Text)
    meta_json = Column(JSON, default=dict)

    project = relationship("Project", back_populates="boq_items")


# ---------------------------------------------------------------------------
# WBS Nodes
# ---------------------------------------------------------------------------
class WBSNode(Base):
    __tablename__ = "wbs_nodes"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    parent_id = Column(String(36), ForeignKey("wbs_nodes.id"), nullable=True)
    level = Column(Integer, nullable=False)
    code = Column(Text, nullable=False)
    name = Column(Text)

    project = relationship("Project", back_populates="wbs_nodes")
    parent = relationship("WBSNode", remote_side="WBSNode.id")


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------
class Activity(Base):
    __tablename__ = "activities"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    wbs_id = Column(String(36), ForeignKey("wbs_nodes.id"), nullable=True)
    act_uid = Column(Text, unique=True, nullable=False, default=_uuid)
    act_id = Column(Text)  # Primavera ID: PH-AREA-DISC-PKG-SEQ
    name = Column(Text)
    phase = Column(Text)  # ENG/PROC/CONST
    area = Column(Text)
    discipline = Column(Text)
    package_code = Column(Text)
    seq = Column(Integer)
    dur_hr = Column(Numeric, default=0)
    mh = Column(Numeric, default=0)
    rom_cost = Column(Numeric, default=0)
    calendar_code = Column(Text, default="CAL-5X8")
    meta_json = Column(JSON, default=dict)

    project = relationship("Project", back_populates="activities")


# ---------------------------------------------------------------------------
# Relationships
# ---------------------------------------------------------------------------
class Relationship(Base):
    __tablename__ = "relationships"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    pred_act_uid = Column(Text, nullable=False)
    succ_act_uid = Column(Text, nullable=False)
    rel_type = Column(Text, default="FS")
    lag_hr = Column(Numeric, default=0)

    __table_args__ = (
        CheckConstraint("rel_type IN ('FS','SS','FF','SF')", name="ck_rel_type"),
    )

    project = relationship("Project", back_populates="relationships")


# ---------------------------------------------------------------------------
# Project Versions (Baselines/Snapshots)
# ---------------------------------------------------------------------------
class ProjectVersion(Base):
    __tablename__ = "project_versions"

    id = Column(String(36), primary_key=True, default=_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    label = Column(Text)
    snapshot_json = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    created_by = Column(String(36), ForeignKey("users.id"))
