from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.deps import get_db, get_current_user
from app.models import Membership, Tenant
from app.schemas import TenantOut

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


@router.get("", response_model=list[TenantOut])
async def list_tenants(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Membership, Tenant)
        .join(Tenant, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == current_user["user_id"])
    )
    rows = result.all()
    return [
        TenantOut(id=t.id, name=t.name, plan=t.plan or "free", role=m.role)
        for m, t in rows
    ]
