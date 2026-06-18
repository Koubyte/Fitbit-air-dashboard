"""
main.py — FastAPI server for the Google Health physiological dashboard.

Exposes three endpoints:
  GET  /api/status         — Token validity and scope info
  GET  /api/health-data    — Full raw + derived data payload (empty shell in Phase 1)
  POST /api/trigger-sync   — Force re-sync for a date range, cache results

CORS is configured to allow requests from http://localhost:3000 (Next.js dev server).
Run with: uvicorn main:app --reload --port 8000
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from auth import (
    finish_web_consent,
    get_authorization_url,
    get_credentials,
    get_token_info,
    has_client_config,
)
from derived_metrics import (
    calculate_ans_balance,
    calculate_sleep_debt,
    calculate_vo2_max,
    identify_acute_stress,
)
from extractor import (
    fetch_daily_heart_rate_zones,
    fetch_daily_hrv,
    fetch_daily_resting_hr,
    fetch_daily_spo2,
    fetch_daily_vo2_max,
    fetch_heart_rate,
    fetch_hrv,
    fetch_sleep,
    fetch_sleep_temp,
    fetch_spo2,
    fetch_steps,
    fetch_time_in_heart_rate_zone,
    probe_google_health_endpoints,
)

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")

# ─── Environment ──────────────────────────────────────────────────────────────
load_dotenv()
SETTINGS_PATH = os.getenv("SETTINGS_PATH", ".env")
load_dotenv(SETTINGS_PATH, override=False)
USER_MAX_HR = float(os.getenv("USER_MAX_HR", "185"))
USER_RESTING_HR = float(os.getenv("USER_RESTING_HR", "58"))
USER_TARGET_SLEEP_HOURS = float(os.getenv("USER_TARGET_SLEEP_HOURS", "8"))
WEBHOOK_FORWARD_SECRET = os.getenv("WEBHOOK_FORWARD_SECRET", "")
MOBILE_INGEST_PATH = os.getenv("MOBILE_INGEST_PATH", "mobile-heart-rate.json")
MOBILE_POINT_LIMIT = int(os.getenv("MOBILE_POINT_LIMIT", "20000"))
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "60"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

# ─── In-memory cache ──────────────────────────────────────────────────────────
# Stores the most recently fetched payload. Cleared on trigger-sync.
# Phase 2 uses the empty shell; Phase 3 populates with real data.
_cache: dict[str, Any] = {
    "payload": None,        # The last full health-data response
    "synced_at": None,      # ISO 8601 timestamp of last successful sync
}

_webhook_state: dict[str, Any] = {
    "count": 0,
    "last_received_at": None,
    "last_data_type": None,
    "last_operation": None,
    "last_intervals": [],
    "last_error": None,
}

# ─── Empty response shell ─────────────────────────────────────────────────────
def _empty_health_payload() -> dict[str, Any]:
    """Returns the standard empty payload structure for Phase 1."""
    return {
        "heart_rate": [],
        "mobile_heart_rate": [],
        "hrv": [],
        "raw_hrv": [],
        "spo2": [],
        "daily_spo2": [],
        "daily_resting_hr": [],
        "daily_heart_rate_zones": [],
        "time_in_heart_rate_zone": [],
        "daily_vo2_max": [],
        "sleep_temp": [],
        "sleep": [],
        "steps": [],
        "derived": {
            "ans_balance": [],
            "vo2_max": [],
            "acute_stress": [],
            "sleep_debt": [],
        },
    }


def _format_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_mobile_heart_rate() -> list[dict[str, Any]]:
    try:
        with open(MOBILE_INGEST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        points = data.get("heart_rate", []) if isinstance(data, dict) else []
        return points if isinstance(points, list) else []
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []


def _save_mobile_heart_rate(points: list[dict[str, Any]]) -> None:
    directory = os.path.dirname(MOBILE_INGEST_PATH)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(MOBILE_INGEST_PATH, "w", encoding="utf-8") as f:
        json.dump({"heart_rate": points[-MOBILE_POINT_LIMIT:]}, f)


def _store_mobile_heart_rate(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_ts = {point["timestamp"]: point for point in _load_mobile_heart_rate()}
    for point in points:
        by_ts[point["timestamp"]] = point
    stored = sorted(by_ts.values(), key=lambda point: point["timestamp"])[-MOBILE_POINT_LIMIT:]
    _save_mobile_heart_rate(stored)
    return stored


def _attach_mobile_heart_rate(payload: dict[str, Any]) -> dict[str, Any]:
    mobile_points = _load_mobile_heart_rate()
    payload["mobile_heart_rate"] = mobile_points
    if not mobile_points:
        return payload

    by_ts = {
        point.get("timestamp"): point
        for point in payload.get("heart_rate", [])
        if point.get("timestamp")
    }
    for point in mobile_points:
        by_ts[point["timestamp"]] = point
    payload["heart_rate"] = sorted(by_ts.values(), key=lambda point: point["timestamp"])[-10000:]
    return payload


def _cache_is_fresh() -> bool:
    if _cache["payload"] is None or not _cache["synced_at"]:
        return False
    try:
        synced_at = datetime.fromisoformat(str(_cache["synced_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - synced_at < timedelta(seconds=CACHE_TTL_SECONDS)


def _default_date_range(days: int = 30) -> dict[str, str]:
    end_date_obj = datetime.now(timezone.utc).date()
    start_date_obj = end_date_obj - timedelta(days=days)
    return {
        "start_date": start_date_obj.isoformat(),
        "end_date": end_date_obj.isoformat(),
    }


def _sync_health_payload(
    credentials: Any,
    date_range: dict[str, str],
    context: str,
) -> tuple[dict[str, Any], int]:
    logger.info(
        "%s: Fetching Google Health data from %s to %s",
        context,
        date_range["start_date"],
        date_range["end_date"],
    )

    heart_rate = fetch_heart_rate(credentials, date_range)
    hrv = fetch_hrv(credentials, date_range)
    spo2 = fetch_spo2(credentials, date_range)
    steps = fetch_steps(credentials, date_range)
    daily_hrv = fetch_daily_hrv(credentials, date_range)
    daily_spo2 = fetch_daily_spo2(credentials, date_range)
    daily_resting_hr = fetch_daily_resting_hr(credentials, date_range)
    daily_heart_rate_zones = fetch_daily_heart_rate_zones(credentials, date_range)
    time_in_heart_rate_zone = fetch_time_in_heart_rate_zone(credentials, date_range)
    daily_vo2_max = fetch_daily_vo2_max(credentials, date_range)
    sleep_temp = fetch_sleep_temp(credentials, date_range)
    sleep = fetch_sleep(credentials, date_range)

    ans_balance = []
    try:
        ans_balance = calculate_ans_balance(hrv)
    except Exception as e:
        logger.error("%s calculate_ans_balance failed: %s", context, e)

    vo2_max = []
    try:
        vo2_max = calculate_vo2_max(daily_resting_hr, USER_MAX_HR)
    except Exception as e:
        logger.error("%s calculate_vo2_max failed: %s", context, e)

    acute_stress = []
    try:
        acute_stress = identify_acute_stress(heart_rate, steps, USER_RESTING_HR)
    except Exception as e:
        logger.error("%s identify_acute_stress failed: %s", context, e)

    sleep_debt = []
    try:
        sleep_debt = calculate_sleep_debt(sleep, USER_TARGET_SLEEP_HOURS)
    except Exception as e:
        logger.error("%s calculate_sleep_debt failed: %s", context, e)

    payload = {
        "heart_rate": heart_rate,
        "mobile_heart_rate": [],
        "hrv": daily_hrv,
        "raw_hrv": hrv,
        "spo2": spo2,
        "daily_spo2": daily_spo2,
        "daily_resting_hr": daily_resting_hr,
        "daily_heart_rate_zones": daily_heart_rate_zones,
        "time_in_heart_rate_zone": time_in_heart_rate_zone,
        "daily_vo2_max": daily_vo2_max,
        "sleep_temp": sleep_temp,
        "sleep": sleep,
        "steps": steps,
        "derived": {
            "ans_balance": ans_balance,
            "vo2_max": vo2_max,
            "acute_stress": acute_stress,
            "sleep_debt": sleep_debt,
        },
    }
    total_records = sum(
        len(series)
        for series in [
            heart_rate,
            hrv,
            spo2,
            steps,
            daily_hrv,
            daily_spo2,
            daily_resting_hr,
            daily_heart_rate_zones,
            time_in_heart_rate_zone,
            daily_vo2_max,
            sleep_temp,
            sleep,
        ]
    )
    return payload, total_records


def _date_range_from_webhook(payload: dict[str, Any]) -> dict[str, str]:
    data = payload.get("data", {})
    parsed_dates = []
    for interval in data.get("intervals", []):
        physical = interval.get("physicalTimeInterval", {})
        for key in ("startTime", "endTime"):
            value = physical.get(key)
            if not value:
                continue
            try:
                parsed_dates.append(datetime.fromisoformat(value.replace("Z", "+00:00")).date())
            except ValueError:
                continue

    if not parsed_dates:
        return _default_date_range(days=2)

    start_date = min(parsed_dates) - timedelta(days=1)
    end_date = max(parsed_dates) + timedelta(days=1)
    return {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()}


def _refresh_cache_from_webhook(payload: dict[str, Any]) -> None:
    try:
        credentials = get_credentials()
        date_range = _date_range_from_webhook(payload)
        synced_payload, total_records = _sync_health_payload(
            credentials,
            date_range,
            "webhook-sync",
        )
        synced_payload = _attach_mobile_heart_rate(synced_payload)
        _cache["payload"] = synced_payload
        _cache["synced_at"] = datetime.now(timezone.utc).isoformat()
        _webhook_state["last_error"] = None
        logger.info(
            "webhook-sync complete: %s records cached at %s",
            total_records,
            _cache["synced_at"],
        )
    except Exception as e:
        _webhook_state["last_error"] = str(e)
        logger.error("webhook-sync failed: %s", e)


# ─── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="Fitbit Air — Google Health API Gateway",
    description=(
        "Local FastAPI server that authenticates with Google OAuth 2.0, "
        "pulls physiological telemetry from the Google Health API v4, "
        "and exposes computed metrics for the Next.js dashboard."
    ),
    version="1.0.0",
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Models ────────────────────────────────────────────────
class SyncRequest(BaseModel):
    start_date: str
    end_date: str

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"Date must be in YYYY-MM-DD format, got: '{v}'")
        return v


class SettingsRequest(BaseModel):
    client_id: str | None = None
    client_secret: str | None = None
    age: int = 28
    max_hr: float
    resting_hr: float
    target_sleep_hours: float


class MobileHeartRatePoint(BaseModel):
    timestamp: datetime
    value: float

    @field_validator("value")
    @classmethod
    def validate_bpm(cls, value: float) -> float:
        if value < 25 or value > 240:
            raise ValueError("Heart rate must be between 25 and 240 bpm")
        return value


class MobileIngestRequest(BaseModel):
    source: str = "android-health-connect"
    heart_rate: list[MobileHeartRatePoint] = []


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.post("/api/settings", summary="Update GCP credentials and user baselines")
async def update_settings(body: SettingsRequest) -> JSONResponse:
    # Optional: env vars are preferred on Coolify. Only write credentials if both
    # fields are filled, so an empty settings form cannot break OAuth.
    if bool(body.client_id) != bool(body.client_secret):
        raise HTTPException(status_code=400, detail="Provide both client ID and client secret.")

    if body.client_id and body.client_secret:
        try:
            redirect_uri = (
                os.getenv("GOOGLE_REDIRECT_URI")
                or f"{os.getenv('PUBLIC_APP_URL', 'http://localhost:3000').rstrip('/')}/api/auth/callback"
            )
            creds_data = {
                "web": {
                    "client_id": body.client_id,
                    "client_secret": body.client_secret,
                    "project_id": os.getenv("GOOGLE_PROJECT_ID", "fitbit-air-dashboard"),
                    "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                    "redirect_uris": [redirect_uri],
                }
            }
            from auth import CREDENTIALS_PATH, TOKEN_PATH
            credentials_path = os.path.abspath(CREDENTIALS_PATH)
            os.makedirs(os.path.dirname(credentials_path) or ".", exist_ok=True)
            with open(credentials_path, "w", encoding="utf-8") as f:
                json.dump(creds_data, f, indent=2)
            if os.path.exists(TOKEN_PATH):
                os.remove(TOKEN_PATH)
            logger.info("Updated OAuth credentials and cleared old token.")
        except Exception as e:
            logger.error(f"Failed to update credentials.json: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to update credentials.json: {str(e)}")

    # 2. Update .env file / environment variables
    try:
        env_lines = []
        settings_path = os.path.abspath(SETTINGS_PATH)
        if os.path.exists(settings_path):
            with open(settings_path, "r", encoding="utf-8") as f:
                env_lines = f.readlines()
        
        def update_env_var(lines, key, val):
            found = False
            for i, line in enumerate(lines):
                if line.strip().startswith(f"{key}="):
                    lines[i] = f"{key}={val}\n"
                    found = True
                    break
            if not found:
                lines.append(f"{key}={val}\n")
        
        update_env_var(env_lines, "USER_MAX_HR", body.max_hr)
        update_env_var(env_lines, "USER_RESTING_HR", body.resting_hr)
        update_env_var(env_lines, "USER_TARGET_SLEEP_HOURS", body.target_sleep_hours)
        
        os.makedirs(os.path.dirname(settings_path) or ".", exist_ok=True)
        with open(settings_path, "w", encoding="utf-8") as f:
            f.writelines(env_lines)
            
        # Update current runtime variables
        global USER_MAX_HR, USER_RESTING_HR, USER_TARGET_SLEEP_HOURS
        USER_MAX_HR = body.max_hr
        USER_RESTING_HR = body.resting_hr
        USER_TARGET_SLEEP_HOURS = body.target_sleep_hours
        
        logger.info("Updated .env and runtime user physiological baselines.")
    except Exception as e:
        logger.error(f"Failed to update .env: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update .env: {str(e)}")

    return JSONResponse(content={"status": "success", "message": "Settings updated successfully."})


@app.get("/api/ready", summary="Container health check")
async def ready() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/url", summary="Create Google OAuth authorization URL")
async def auth_url(redirect_uri: str | None = None) -> JSONResponse:
    if not has_client_config():
        raise HTTPException(
            status_code=503,
            detail="Google OAuth client is not configured.",
        )
    try:
        return JSONResponse(content={"url": get_authorization_url(redirect_uri)})
    except Exception as e:
        logger.error(f"Failed to build OAuth URL: {e}")
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/auth/callback", summary="Finish Google OAuth web flow")
async def auth_callback(code: str | None = None, redirect_uri: str | None = None, error: str | None = None) -> JSONResponse:
    if error:
        raise HTTPException(status_code=400, detail=error)
    if not code:
        raise HTTPException(status_code=400, detail="Missing OAuth code.")
    try:
        finish_web_consent(code, redirect_uri)
        return JSONResponse(content={"status": "ok"})
    except Exception as e:
        logger.error(f"OAuth callback failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/status", summary="OAuth token status and scope info")
async def get_status() -> JSONResponse:
    """
    Returns the current OAuth token status.

    Response schema:
        {
            "token_valid": bool,
            "scopes": list[str],
            "last_refreshed": str | null  (ISO 8601)
        }
    """
    info = get_token_info()
    return JSONResponse(content=info)


@app.get("/api/google-health-diagnostics", summary="Safe Google Health endpoint diagnostics")
async def google_health_diagnostics(days: int = 30) -> JSONResponse:
    """
    Returns HTTP status and counts for key Google Health endpoints.

    Does not return personal health values.
    """
    try:
        credentials = get_credentials()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Diagnostics authentication failed: {e}")
        raise HTTPException(status_code=503, detail=f"Authentication failed: {str(e)}")

    clamped_days = max(1, min(days, 90))
    end_date_obj = datetime.now(timezone.utc).date()
    start_date_obj = end_date_obj - timedelta(days=clamped_days)
    date_range = {
        "start_date": start_date_obj.isoformat(),
        "end_date": end_date_obj.isoformat(),
    }

    return JSONResponse(
        content={
            "date_range": date_range,
            "endpoints": probe_google_health_endpoints(credentials, date_range),
        }
    )


@app.get("/api/health-data", summary="Full raw and derived health data payload")
async def get_health_data() -> JSONResponse:
    """
    Returns the cached health data payload.

    If the cache is empty, this dynamically triggers a sync for the past 30 days
    and caches the results. If the credentials or token are missing/invalid,
    it gracefully returns the empty shell payload so the frontend can display
    Sample Data Mode.

    The in-memory cache expires quickly so Live Data does not freeze.
    """
    # Return cached payload if it is still fresh.
    if _cache_is_fresh():
        headers = {"Cache-Control": "max-age=15"}
        return JSONResponse(content=_attach_mobile_heart_rate(_cache["payload"]), headers=headers)

    # Cache is empty: try to run automatic sync for the past 30 days
    try:
        credentials = get_credentials()
        payload, _ = _sync_health_payload(credentials, _default_date_range(), "auto-sync")
        payload = _attach_mobile_heart_rate(payload)
        _cache["payload"] = payload
        _cache["synced_at"] = datetime.now(timezone.utc).isoformat()
        
        headers = {"Cache-Control": "max-age=15"}
        return JSONResponse(content=payload, headers=headers)
        
    except Exception as e:
        logger.warning(
            f"Auto-sync on startup failed ({e}). Returning empty physiological shell."
        )
        if _cache["payload"] is not None:
            headers = {"Cache-Control": "max-age=15"}
            return JSONResponse(content=_attach_mobile_heart_rate(_cache["payload"]), headers=headers)
        # Graceful fallback to empty shell for Sample Mode
        payload = _empty_health_payload()
        headers = {"Cache-Control": "max-age=15"}
        return JSONResponse(content=payload, headers=headers)


@app.get("/api/webhook-status", summary="Google Health webhook receiver status")
async def webhook_status() -> JSONResponse:
    return JSONResponse(content={
        **_webhook_state,
        "cache_synced_at": _cache["synced_at"],
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "cache_fresh": _cache_is_fresh(),
        "cache_ready": _cache["payload"] is not None,
    })


@app.post("/api/webhooks/google-health", summary="Internal Google Health webhook receiver")
async def google_health_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_webhook_forward_secret: str | None = Header(default=None),
) -> Response:
    if WEBHOOK_FORWARD_SECRET and x_webhook_forward_secret != WEBHOOK_FORWARD_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook forward secret")

    payload = await request.json()
    data = payload.get("data", {})
    received_at = datetime.now(timezone.utc).isoformat()

    _webhook_state["count"] = int(_webhook_state["count"] or 0) + 1
    _webhook_state["last_received_at"] = received_at
    _webhook_state["last_data_type"] = data.get("dataType")
    _webhook_state["last_operation"] = data.get("operation")
    _webhook_state["last_intervals"] = data.get("intervals", [])
    _webhook_state["last_error"] = None

    # The next frontend refresh must not reuse stale data.
    _cache["payload"] = None
    background_tasks.add_task(_refresh_cache_from_webhook, payload)

    return Response(status_code=204)


@app.post("/api/mobile-ingest", summary="Ingest Android Health Connect samples")
async def mobile_ingest(body: MobileIngestRequest) -> JSONResponse:
    points = [
        {
            "timestamp": _format_utc(point.timestamp),
            "value": float(point.value),
            "data_type": "MOBILE_HEALTH_CONNECT_HEART_RATE",
            "source": body.source,
        }
        for point in body.heart_rate
    ]
    stored = _store_mobile_heart_rate(points) if points else _load_mobile_heart_rate()

    if _cache["payload"] is None:
        _cache["payload"] = _empty_health_payload()
    _attach_mobile_heart_rate(_cache["payload"])
    _cache["synced_at"] = datetime.now(timezone.utc).isoformat()

    latest = stored[-1] if stored else None
    return JSONResponse(content={
        "status": "ok",
        "heart_rate_received": len(points),
        "mobile_heart_rate_stored": len(stored),
        "latest": latest,
        "synced_at": _cache["synced_at"],
    })


@app.post("/api/trigger-sync", summary="Force re-sync for a date range")
async def trigger_sync(body: SyncRequest) -> JSONResponse:
    """
    Calls all extractor functions in sequence for the given date range.

    Runs derived metric calculations and caches results in memory.
    """
    logger.info(
        f"trigger-sync: Fetching data from {body.start_date} to {body.end_date}"
    )

    # ── Authenticate ──────────────────────────────────────────────────────────
    try:
        credentials = get_credentials()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Authentication failed: {e}")
        raise HTTPException(status_code=503, detail=f"Authentication failed: {str(e)}")

    date_range = {"start_date": body.start_date, "end_date": body.end_date}

    # ── Fetch all raw data ────────────────────────────────────────────────────
    logger.info("Fetching raw data from Google Health API v4...")

    heart_rate = fetch_heart_rate(credentials, date_range)
    hrv = fetch_hrv(credentials, date_range)
    spo2 = fetch_spo2(credentials, date_range)
    steps = fetch_steps(credentials, date_range)
    daily_hrv = fetch_daily_hrv(credentials, date_range)
    daily_spo2 = fetch_daily_spo2(credentials, date_range)
    daily_resting_hr = fetch_daily_resting_hr(credentials, date_range)
    daily_heart_rate_zones = fetch_daily_heart_rate_zones(credentials, date_range)
    time_in_heart_rate_zone = fetch_time_in_heart_rate_zone(credentials, date_range)
    daily_vo2_max = fetch_daily_vo2_max(credentials, date_range)
    sleep_temp = fetch_sleep_temp(credentials, date_range)
    sleep = fetch_sleep(credentials, date_range)

    # ── Run derived metrics ───────────────────────────────────────────────────
    ans_balance = []
    try:
        ans_balance = calculate_ans_balance(hrv)
    except Exception as e:
        logger.error(f"calculate_ans_balance failed: {e}")

    vo2_max = []
    try:
        vo2_max = calculate_vo2_max(daily_resting_hr, USER_MAX_HR)
    except Exception as e:
        logger.error(f"calculate_vo2_max failed: {e}")

    acute_stress = []
    try:
        acute_stress = identify_acute_stress(heart_rate, steps, USER_RESTING_HR)
    except Exception as e:
        logger.error(f"identify_acute_stress failed: {e}")

    sleep_debt = []
    try:
        sleep_debt = calculate_sleep_debt(sleep, USER_TARGET_SLEEP_HOURS)
    except Exception as e:
        logger.error(f"calculate_sleep_debt failed: {e}")

    # ── Build and cache compliance payload ────────────────────────────────────
    payload = {
        "heart_rate": heart_rate,
        "mobile_heart_rate": [],
        "hrv": daily_hrv,  # Compliance: HRV maps to daily rollup trend in frontend
        "raw_hrv": hrv,
        "spo2": spo2,
        "daily_spo2": daily_spo2,
        "daily_resting_hr": daily_resting_hr,
        "daily_heart_rate_zones": daily_heart_rate_zones,
        "time_in_heart_rate_zone": time_in_heart_rate_zone,
        "daily_vo2_max": daily_vo2_max,
        "sleep_temp": sleep_temp,
        "sleep": sleep,
        "steps": steps,
        "derived": {
            "ans_balance": ans_balance,
            "vo2_max": vo2_max,
            "acute_stress": acute_stress,
            "sleep_debt": sleep_debt,
        },
    }

    payload = _attach_mobile_heart_rate(payload)
    _cache["payload"] = payload
    _cache["synced_at"] = datetime.now(timezone.utc).isoformat()

    total_records = (
        len(heart_rate)
        + len(hrv)
        + len(spo2)
        + len(sleep_temp)
        + len(sleep)
        + len(steps)
    )

    logger.info(
        f"trigger-sync complete: {total_records} raw records cached at "
        f"{_cache['synced_at']}"
    )

    return JSONResponse(content={
        "status": "ok",
        "records_fetched": total_records,
        "synced_at": _cache["synced_at"],
    })


# ─── Root health check ────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {
        "service": "Fitbit Air — Google Health API Gateway",
        "status": "running",
        "docs": "http://localhost:8000/docs",
    }
