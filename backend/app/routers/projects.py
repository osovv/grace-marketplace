from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.deps import get_db, get_current_user, require_role
from app.models import Project
from app.schemas import ProjectCreate, ProjectOut
from app.audit import log_audit

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ProjectOut)
async def create_project(
    req: ProjectCreate,
    current_user: dict = Depends(require_role("planner")),
    db: AsyncSession = Depends(get_db),
):
    project = Project(tenant_id=current_user["tenant_id"], name=req.name)
    db.add(project)
    await db.flush()
    await log_audit(db, current_user["tenant_id"], current_user["user_id"], "project", project.id, "CREATE")
    await db.commit()
    await db.refresh(project)
    return project


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project).where(Project.tenant_id == current_user["tenant_id"]).order_by(Project.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == current_user["tenant_id"])
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
