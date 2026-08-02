"""
LinkedIn OAuth 2.0 (3-legged) + Post API helpers.

Scopes needed: openid profile email w_member_social
Docs: https://learn.microsoft.com/... (see LinkedIn's own developer docs for the
authoritative, up-to-date reference — this is a starting point, not gospel).
"""
import os
import time
import requests
from datetime import datetime, timedelta
from urllib.parse import urlencode

from . import storage

AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
USERINFO_URL = "https://api.linkedin.com/v2/userinfo"
POSTS_URL = "https://api.linkedin.com/rest/posts"
IMAGES_INIT_URL = "https://api.linkedin.com/rest/images?action=initializeUpload"
LINKEDIN_VERSION = "202601"  # LinkedIn API version header; bump as needed


def _client_id():
    return os.environ["LINKEDIN_CLIENT_ID"]


def _client_secret():
    return os.environ["LINKEDIN_CLIENT_SECRET"]


def _redirect_uri():
    return os.environ["LINKEDIN_REDIRECT_URI"]


def build_authorization_url(state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(),
        "state": state,
        "scope": "openid profile email w_member_social",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code_for_token(code: str) -> dict:
    resp = requests.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(),
        "client_id": _client_id(),
        "client_secret": _client_secret(),
    })
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(refresh_token: str) -> dict:
    resp = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": _client_id(),
        "client_secret": _client_secret(),
    })
    resp.raise_for_status()
    return resp.json()


def get_member_urn(access_token: str) -> str:
    resp = requests.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    resp.raise_for_status()
    sub = resp.json()["sub"]
    return f"urn:li:person:{sub}"


def store_new_tokens(token_response: dict) -> None:
    access_token = token_response["access_token"]
    refresh_token = token_response.get("refresh_token", "")
    expires_in = token_response.get("expires_in", 3600)
    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()
    member_urn = get_member_urn(access_token)
    storage.save_tokens(access_token, refresh_token, expires_at, member_urn)


def get_valid_access_token() -> tuple[str, str]:
    """Returns (access_token, member_urn), refreshing if needed."""
    tokens = storage.get_tokens()
    if not tokens:
        raise RuntimeError("No LinkedIn tokens stored — visit /api/auth/start first.")

    expires_at = datetime.fromisoformat(tokens["expires_at"])
    if datetime.utcnow() >= expires_at - timedelta(minutes=5):
        refreshed = refresh_access_token(tokens["refresh_token"])
        storage.save_tokens(
            refreshed["access_token"],
            refreshed.get("refresh_token", tokens["refresh_token"]),
            (datetime.utcnow() + timedelta(seconds=refreshed.get("expires_in", 3600))).isoformat(),
            tokens["member_urn"],
        )
        return refreshed["access_token"], tokens["member_urn"]

    return tokens["access_token"], tokens["member_urn"]


def _upload_image(access_token: str, member_urn: str, image_bytes: bytes) -> str:
    """Registers + uploads an image, returns the LinkedIn image URN to attach to a post."""
    init_resp = requests.post(
        IMAGES_INIT_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "LinkedIn-Version": LINKEDIN_VERSION,
            "Content-Type": "application/json",
        },
        json={"initializeUploadRequest": {"owner": member_urn}},
    )
    init_resp.raise_for_status()
    data = init_resp.json()["value"]
    upload_url = data["uploadUrl"]
    image_urn = data["image"]

    put_resp = requests.put(upload_url, data=image_bytes,
                             headers={"Authorization": f"Bearer {access_token}"})
    put_resp.raise_for_status()
    return image_urn


def publish_post(text: str, image_bytes: bytes | None = None) -> str:
    """Publishes a post to the authenticated member's feed. Returns the post URN."""
    access_token, member_urn = get_valid_access_token()

    body = {
        "author": member_urn,
        "commentary": text,
        "visibility": "PUBLIC",
        "distribution": {
            "feedDistribution": "MAIN_FEED",
            "targetEntities": [],
            "thirdPartyDistributionChannels": [],
        },
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }

    if image_bytes:
        image_urn = _upload_image(access_token, member_urn, image_bytes)
        body["content"] = {"media": {"id": image_urn}}

    resp = requests.post(
        POSTS_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "LinkedIn-Version": LINKEDIN_VERSION,
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        json=body,
    )
    resp.raise_for_status()
    # LinkedIn returns the post URN in the x-restli-id or x-linkedin-id response header
    return resp.headers.get("x-restli-id", "")
