import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .config import get_settings
from .routers import admin, intelligence, research, validation
from .security import limiter

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("spyro")

app = FastAPI(title="S-PYRO API", version="1.0.0",
              description="NASA combustion science research intelligence platform. The researcher decides; S-PYRO assists.")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
@app.middleware("http")
async def catch_errors(request: Request, call_next):
    """Runs inside the CORS middleware so even error responses carry CORS headers (otherwise the browser
    reports a misleading 'cannot reach backend')."""
    try:
        return await call_next(request)
    except Exception as exc:
        code = getattr(exc, "code", "")
        if code in ("PGRST205", "PGRST202", "42P01"):
            log.error("database schema missing: %s", code)
            return JSONResponse(status_code=503, content={"detail": "Database tables are missing. Run the SQL files in supabase/migrations (SQL Editor) first."})
        log.error("unhandled %s: %s", type(exc).__name__, str(exc)[:200])   # never log bodies or credentials
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})


app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
                   allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    errs = [{"field": ".".join(str(x) for x in e["loc"] if x not in ("body", "query")), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "Invalid request.", "errors": errs})


@app.get("/health")
def health():
    s = get_settings()
    return {"status": "ok", "database_configured": bool(s.supabase_url and s.supabase_service_role_key), "gemini_configured": s.gemini_configured}


for r in (research.router, intelligence.router, validation.router, admin.router):
    app.include_router(r)
