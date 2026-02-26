from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import ProjectVersion, WBSNode, Activity, Relationship, BOQItem


async def create_snapshot(
    db: AsyncSession, project_id: str, tenant_id: str,
    user_id: str, label: str,
) -> ProjectVersion:
    """Create a version snapshot of the current schedule state."""
    # Gather data
    wbs_result = await db.execute(
        select(WBSNode).where(WBSNode.project_id == project_id, WBSNode.tenant_id == tenant_id)
    )
    wbs_nodes = wbs_result.scalars().all()

    act_result = await db.execute(
        select(Activity).where(Activity.project_id == project_id, Activity.tenant_id == tenant_id)
    )
    activities = act_result.scalars().all()

    rel_result = await db.execute(
        select(Relationship).where(Relationship.project_id == project_id, Relationship.tenant_id == tenant_id)
    )
    rels = rel_result.scalars().all()

    boq_result = await db.execute(
        select(BOQItem).where(BOQItem.project_id == project_id, BOQItem.tenant_id == tenant_id)
    )
    boq_items = boq_result.scalars().all()

    snapshot = {
        "wbs": [
            {"id": n.id, "code": n.code, "name": n.name, "level": n.level, "parent_id": n.parent_id}
            for n in wbs_nodes
        ],
        "activities": [
            {
                "act_uid": a.act_uid, "act_id": a.act_id, "name": a.name,
                "phase": a.phase, "area": a.area, "discipline": a.discipline,
                "package_code": a.package_code, "dur_hr": float(a.dur_hr or 0),
                "mh": float(a.mh or 0), "rom_cost": float(a.rom_cost or 0),
            }
            for a in activities
        ],
        "relationships": [
            {
                "pred_act_uid": r.pred_act_uid, "succ_act_uid": r.succ_act_uid,
                "rel_type": r.rel_type, "lag_hr": float(r.lag_hr or 0),
            }
            for r in rels
        ],
        "boq_summary": {
            "count": len(boq_items),
            "total_qty": sum(float(b.qty or 0) for b in boq_items),
        },
    }

    version = ProjectVersion(
        tenant_id=tenant_id,
        project_id=project_id,
        label=label,
        snapshot_json=snapshot,
        created_by=user_id,
    )
    db.add(version)
    await db.flush()
    return version
