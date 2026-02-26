from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.deps import get_db
from app.models import User, Tenant, Membership
from app.schemas import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest
from app.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from app.seed import seed_tenant_defaults

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    tenant = Tenant(name=req.tenant_name)
    db.add(tenant)
    await db.flush()

    user = User(email=req.email, password_hash=hash_password(req.password))
    db.add(user)
    await db.flush()

    membership = Membership(tenant_id=tenant.id, user_id=user.id, role="admin")
    db.add(membership)
    await db.flush()

    # Seed default library data for this tenant
    await seed_tenant_defaults(db, tenant.id)

    await db.commit()

    token_data = {"sub": user.id, "tenant_id": tenant.id, "role": "admin"}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Get first active membership
    mem_result = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.status == "active",
        )
    )
    membership = mem_result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=403, detail="No active tenant membership")

    token_data = {"sub": user.id, "tenant_id": membership.tenant_id, "role": membership.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    role = payload.get("role", "viewer")

    token_data = {"sub": user_id, "tenant_id": tenant_id, "role": role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )
