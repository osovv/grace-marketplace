from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_async_session
from app.security import decode_token
from app.models import User, Membership

security_scheme = HTTPBearer()

ROLE_HIERARCHY = {"admin": 3, "planner": 2, "viewer": 1}


async def get_db():
    async for session in get_async_session():
        yield session


async def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> dict:
    payload = decode_token(cred.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    role = payload.get("role", "viewer")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return {"user_id": user_id, "tenant_id": tenant_id, "role": role, "email": user.email}


def require_role(min_role: str):
    min_level = ROLE_HIERARCHY.get(min_role, 0)

    async def checker(current_user: dict = Depends(get_current_user)):
        user_level = ROLE_HIERARCHY.get(current_user["role"], 0)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {min_role} role or higher",
            )
        return current_user

    return checker
