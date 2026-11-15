"""Auth helpers and rate limiting. Browsers send the Supabase access token as a Bearer token."""
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address

from .db import get_db, rows

limiter = Limiter(key_func=get_remote_address)


@dataclass
class User:
    id: str
    email: str | None
    is_admin: bool


def _resolve(authorization: str | None) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    db = get_db()
    try:
        res = db.auth.get_user(token)
        u = res.user if res else None
    except Exception:
        raise HTTPException(401, "Invalid or expired session token.")
    if not u:
        raise HTTPException(401, "Invalid or expired session token.")
    admin = rows(db.table("admin_users").select("user_id").eq("user_id", u.id).execute())
    return User(id=u.id, email=u.email, is_admin=bool(admin))


def optional_user(authorization: str | None = Header(default=None)) -> User | None:
    return _resolve(authorization)


def require_user(user: User | None = Depends(optional_user)) -> User:
    if not user:
        raise HTTPException(401, "Authentication required.")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Administrator access required.")
    return user
