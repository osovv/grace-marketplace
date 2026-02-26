import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.deps import get_db, get_current_user
from app.models import Project, WBSNode, Activity, Relationship
from app.p6xml_export import generate_p6xml
from app.audit import log_audit
from app.config import settings

router = APIRouter(tags=["export"])


@router.get("/api/projects/{project_id}/export/p6xml")
async def export_p6xml(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tid = current_user["tenant_id"]

    # Fetch project
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tid)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Fetch schedule data
    wbs_result = await db.execute(
        select(WBSNode).where(WBSNode.project_id == project_id, WBSNode.tenant_id == tid)
        .order_by(WBSNode.level, WBSNode.code)
    )
    wbs_nodes = wbs_result.scalars().all()

    act_result = await db.execute(
        select(Activity).where(Activity.project_id == project_id, Activity.tenant_id == tid)
        .order_by(Activity.act_id)
    )
    activities = act_result.scalars().all()

    rel_result = await db.execute(
        select(Relationship).where(Relationship.project_id == project_id, Relationship.tenant_id == tid)
    )
    relationships = rel_result.scalars().all()

    if not activities:
        raise HTTPException(status_code=400, detail="No schedule data. Generate schedule first.")

    # Generate P6XML
    xml_bytes = generate_p6xml(project, wbs_nodes, activities, relationships)

    # Save to exports dir
    export_dir = os.path.join(settings.DATA_DIR, "exports")
    os.makedirs(export_dir, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{project.name.replace(' ', '_')}_{ts}.xml"
    filepath = os.path.join(export_dir, filename)
    with open(filepath, "wb") as f:
        f.write(xml_bytes)

    # Audit
    await log_audit(
        db, tid, current_user["user_id"],
        "export", project_id, "EXPORT", {"filename": filename},
    )
    await db.commit()

    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
