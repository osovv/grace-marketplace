from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog


async def log_audit(
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    entity: str,
    entity_id: str,
    action: str,
    diff_json: dict | None = None,
):
    entry = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        entity=entity,
        entity_id=entity_id,
        action=action,
        diff_json=diff_json or {},
    )
    db.add(entry)
    await db.flush()
