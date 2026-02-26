from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.deps import get_db, get_current_user, require_role
from app.models import Template, ProductivityNorm, AreaDictionary
from app.schemas import (
    TemplateCreate, TemplatePatch, TemplateOut,
    NormCreate, NormPatch, NormOut,
    AreaCreate, AreaPatch, AreaOut,
)

router = APIRouter(prefix="/api/library", tags=["library"])


# ── Templates ─────────────────────────────────────────────────────────────
@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Template).where(Template.tenant_id == current_user["tenant_id"])
    )
    return result.scalars().all()


@router.post("/templates", response_model=TemplateOut)
async def create_template(
    req: TemplateCreate,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    tmpl = Template(
        tenant_id=current_user["tenant_id"],
        discipline=req.discipline,
        work_type=req.work_type,
        name=req.name,
        steps_json=req.steps_json,
        rules_json=req.rules_json,
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return tmpl


@router.patch("/templates/{template_id}", response_model=TemplateOut)
async def patch_template(
    template_id: str,
    patch: TemplatePatch,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Template).where(
            Template.id == template_id,
            Template.tenant_id == current_user["tenant_id"],
        )
    )
    tmpl = result.scalar_one_or_none()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    for field, val in patch.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(tmpl, field, val)
    tmpl.version = (tmpl.version or 1) + 1
    await db.commit()
    await db.refresh(tmpl)
    return tmpl


# ── Productivity Norms ────────────────────────────────────────────────────
@router.get("/norms", response_model=list[NormOut])
async def list_norms(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProductivityNorm).where(ProductivityNorm.tenant_id == current_user["tenant_id"])
    )
    return result.scalars().all()


@router.post("/norms", response_model=NormOut)
async def create_norm(
    req: NormCreate,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    norm = ProductivityNorm(
        tenant_id=current_user["tenant_id"],
        discipline=req.discipline,
        work_type=req.work_type,
        uom=req.uom,
        mh_per_uom=req.mh_per_uom,
        crew_json=req.crew_json,
        labor_rate=req.labor_rate,
    )
    db.add(norm)
    await db.commit()
    await db.refresh(norm)
    return norm


@router.patch("/norms/{norm_id}", response_model=NormOut)
async def patch_norm(
    norm_id: str,
    patch: NormPatch,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProductivityNorm).where(
            ProductivityNorm.id == norm_id,
            ProductivityNorm.tenant_id == current_user["tenant_id"],
        )
    )
    norm = result.scalar_one_or_none()
    if not norm:
        raise HTTPException(status_code=404, detail="Norm not found")
    for field, val in patch.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(norm, field, val)
    norm.version = (norm.version or 1) + 1
    await db.commit()
    await db.refresh(norm)
    return norm


# ── Area Dictionary ───────────────────────────────────────────────────────
@router.get("/areas", response_model=list[AreaOut])
async def list_areas(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AreaDictionary).where(AreaDictionary.tenant_id == current_user["tenant_id"])
    )
    return result.scalars().all()


@router.post("/areas", response_model=AreaOut)
async def create_area(
    req: AreaCreate,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    area = AreaDictionary(
        tenant_id=current_user["tenant_id"],
        code=req.code,
        keywords_json=req.keywords_json,
        priority=req.priority,
    )
    db.add(area)
    await db.commit()
    await db.refresh(area)
    return area


@router.patch("/areas/{area_id}", response_model=AreaOut)
async def patch_area(
    area_id: str,
    patch: AreaPatch,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AreaDictionary).where(
            AreaDictionary.id == area_id,
            AreaDictionary.tenant_id == current_user["tenant_id"],
        )
    )
    area = result.scalar_one_or_none()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    for field, val in patch.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(area, field, val)
    await db.commit()
    await db.refresh(area)
    return area
