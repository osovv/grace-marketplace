from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.deps import get_db, get_current_user, require_role
from app.models import Project, WBSNode, Activity, Relationship, ProjectVersion
from app.schemas import (
    ScheduleOut, WBSNodeOut, ActivityOut, RelationshipOut, ActivityPatch,
    RelationshipCreate, RelationshipOut, VersionCreate, VersionOut,
)
from app.rules_engine import generate_schedule
from app.versioning import create_snapshot
from app.audit import log_audit

router = APIRouter(tags=["schedule"])


@router.post("/api/projects/{project_id}/schedule/generate")
async def generate(
    project_id: str,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    # Verify project
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == current_user["tenant_id"],
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    summary = await generate_schedule(db, project_id, current_user["tenant_id"])

    await log_audit(
        db, current_user["tenant_id"], current_user["user_id"],
        "schedule", project_id, "CREATE", summary,
    )
    await db.commit()

    return summary


@router.get("/api/projects/{project_id}/schedule", response_model=ScheduleOut)
async def get_schedule(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tid = current_user["tenant_id"]

    wbs_result = await db.execute(
        select(WBSNode).where(WBSNode.project_id == project_id, WBSNode.tenant_id == tid)
        .order_by(WBSNode.level, WBSNode.code)
    )
    wbs = wbs_result.scalars().all()

    act_result = await db.execute(
        select(Activity).where(Activity.project_id == project_id, Activity.tenant_id == tid)
        .order_by(Activity.act_id)
    )
    activities = act_result.scalars().all()

    rel_result = await db.execute(
        select(Relationship).where(Relationship.project_id == project_id, Relationship.tenant_id == tid)
    )
    rels = rel_result.scalars().all()

    total_mh = sum(float(a.mh or 0) for a in activities)
    total_rom = sum(float(a.rom_cost or 0) for a in activities)
    total_dur = sum(float(a.dur_hr or 0) for a in activities)

    return ScheduleOut(
        wbs=[WBSNodeOut.model_validate(n) for n in wbs],
        activities=[ActivityOut.model_validate(a) for a in activities],
        relationships=[RelationshipOut.model_validate(r) for r in rels],
        total_mh=total_mh,
        total_rom=total_rom,
        total_dur_hr=total_dur,
    )


@router.patch("/api/activities/{act_uid}", response_model=ActivityOut)
async def patch_activity(
    act_uid: str,
    patch: ActivityPatch,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Activity).where(
            Activity.act_uid == act_uid,
            Activity.tenant_id == current_user["tenant_id"],
        )
    )
    act = result.scalar_one_or_none()
    if not act:
        raise HTTPException(status_code=404, detail="Activity not found")

    changes = {}
    for field, val in patch.model_dump(exclude_unset=True).items():
        if val is not None:
            old = getattr(act, field)
            setattr(act, field, val)
            changes[field] = {"old": str(old), "new": str(val)}

    if changes:
        await log_audit(
            db, current_user["tenant_id"], current_user["user_id"],
            "activity", act_uid, "UPDATE", changes,
        )
        await db.commit()
        await db.refresh(act)

    return act


@router.post("/api/relationships", response_model=RelationshipOut)
async def create_relationship(
    req: RelationshipCreate,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    # Find both activities to get project_id
    pred_result = await db.execute(
        select(Activity).where(
            Activity.act_uid == req.pred_act_uid,
            Activity.tenant_id == current_user["tenant_id"],
        )
    )
    pred = pred_result.scalar_one_or_none()
    if not pred:
        raise HTTPException(status_code=404, detail="Predecessor activity not found")

    rel = Relationship(
        tenant_id=current_user["tenant_id"],
        project_id=pred.project_id,
        pred_act_uid=req.pred_act_uid,
        succ_act_uid=req.succ_act_uid,
        rel_type=req.rel_type,
        lag_hr=req.lag_hr,
    )
    db.add(rel)
    await log_audit(
        db, current_user["tenant_id"], current_user["user_id"],
        "relationship", "", "CREATE",
        {"pred": req.pred_act_uid, "succ": req.succ_act_uid},
    )
    await db.commit()
    await db.refresh(rel)
    return rel


# ── Versions ──────────────────────────────────────────────────────────────
@router.post("/api/projects/{project_id}/versions", response_model=VersionOut)
async def create_version(
    project_id: str,
    req: VersionCreate,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    version = await create_snapshot(
        db, project_id, current_user["tenant_id"],
        current_user["user_id"], req.label,
    )
    await log_audit(
        db, current_user["tenant_id"], current_user["user_id"],
        "version", version.id, "CREATE", {"label": req.label},
    )
    await db.commit()
    await db.refresh(version)
    return version


@router.get("/api/projects/{project_id}/versions", response_model=list[VersionOut])
async def list_versions(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectVersion).where(
            ProjectVersion.project_id == project_id,
            ProjectVersion.tenant_id == current_user["tenant_id"],
        ).order_by(ProjectVersion.created_at.desc())
    )
    return result.scalars().all()
