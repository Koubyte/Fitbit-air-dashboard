import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("auth")

CREDENTIALS_PATH = os.getenv("CREDENTIALS_PATH", "credentials.json")
TOKEN_PATH = os.getenv("TOKEN_PATH", "token.json")

SCOPES = [
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
]


def _redirect_uri(fallback: str | None = None) -> str:
    if fallback:
        return fallback
    if os.getenv("GOOGLE_REDIRECT_URI"):
        return os.environ["GOOGLE_REDIRECT_URI"]
    public_url = os.getenv("PUBLIC_APP_URL", "").rstrip("/")
    if public_url:
        return f"{public_url}/api/auth/callback"
    return "http://localhost:3000/api/auth/callback"


def _client_config() -> dict[str, Any]:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if client_id and client_secret:
        return {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "redirect_uris": [_redirect_uri()],
            }
        }

    path = Path(CREDENTIALS_PATH)
    if not path.exists():
        raise FileNotFoundError(
            "Google OAuth credentials missing. Set GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET, or mount credentials.json."
        )

    with path.open("r", encoding="utf-8") as f:
        config = json.load(f)

    if "web" in config:
        config["web"]["auth_uri"] = "https://accounts.google.com/o/oauth2/v2/auth"
    return config


def has_client_config() -> bool:
    try:
        _client_config()
        return True
    except Exception:
        return False


def _flow(redirect_uri: str | None = None) -> Flow:
    uri = _redirect_uri(redirect_uri)
    if uri.startswith("http://localhost") or uri.startswith("http://127.0.0.1"):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    return Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=uri,
    )


def get_authorization_url(redirect_uri: str | None = None) -> str:
    flow = _flow(redirect_uri)
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )
    return authorization_url


def finish_web_consent(code: str, redirect_uri: str | None = None) -> Credentials:
    # Google can return granted scopes in a different order or with previous grants.
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
    flow = _flow(redirect_uri)
    flow.fetch_token(code=code)
    creds = flow.credentials
    _save_token(creds)
    return creds


def _has_required_scopes(creds: Credentials) -> bool:
    if creds.scopes:
        return all(scope in creds.scopes for scope in SCOPES)

    token_file = Path(TOKEN_PATH)
    if not token_file.exists():
        return False

    try:
        with token_file.open("r", encoding="utf-8") as f:
            token_data = json.load(f)
        stored_scopes = token_data.get("scopes", [])
        return all(scope in stored_scopes for scope in SCOPES)
    except (json.JSONDecodeError, OSError):
        return False


def _save_token(creds: Credentials) -> None:
    token_path = Path(TOKEN_PATH)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else SCOPES,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }
    with token_path.open("w", encoding="utf-8") as f:
        json.dump(token_data, f, indent=2)


def get_credentials() -> Credentials:
    token_path = Path(TOKEN_PATH)
    if not token_path.exists():
        raise RuntimeError("Google OAuth token missing. Open /api/auth/start.")

    try:
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    except (ValueError, json.JSONDecodeError) as e:
        raise RuntimeError("Google OAuth token is unreadable. Reconnect Google.") from e

    if not _has_required_scopes(creds):
        raise RuntimeError("Google OAuth token is missing required scopes. Reconnect Google.")

    if not creds.refresh_token:
        raise RuntimeError("Google OAuth refresh token missing. Reconnect Google.")

    if creds.expired:
        try:
            creds.refresh(Request())
            _save_token(creds)
        except RefreshError as e:
            raise RuntimeError("Google OAuth refresh failed. Reconnect Google.") from e

    return creds


def get_token_info() -> dict[str, Any]:
    token_path = Path(TOKEN_PATH)
    if not token_path.exists():
        return {
            "token_valid": False,
            "scopes": [],
            "last_refreshed": None,
            "auth_configured": has_client_config(),
        }

    try:
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        valid = bool(creds.refresh_token) and _has_required_scopes(creds)
        return {
            "token_valid": valid,
            "scopes": list(creds.scopes) if creds.scopes else SCOPES,
            "last_refreshed": creds.expiry.isoformat() if creds.expiry else None,
            "auth_configured": has_client_config(),
        }
    except Exception as e:
        logger.warning("Could not read token info: %s", e)
        return {
            "token_valid": False,
            "scopes": [],
            "last_refreshed": None,
            "auth_configured": has_client_config(),
        }
