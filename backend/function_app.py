import json
import logging
import uuid
import azure.functions as func

from shared import storage
from shared import linkedin_auth
from shared.models import Post, STATUS_DRAFT, STATUS_SCHEDULED, STATUS_PUBLISHED, STATUS_FAILED

app = func.FunctionApp()


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

@app.route(route="auth/start", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_start(req: func.HttpRequest) -> func.HttpResponse:
    state = str(uuid.uuid4())
    url = linkedin_auth.build_authorization_url(state)
    return func.HttpResponse(status_code=302, headers={"Location": url})


@app.route(route="auth/callback", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_callback(req: func.HttpRequest) -> func.HttpResponse:
    code = req.params.get("code")
    error = req.params.get("error")
    if error:
        return func.HttpResponse(f"LinkedIn auth error: {error}", status_code=400)
    if not code:
        return func.HttpResponse("Missing 'code' parameter", status_code=400)

    token_response = linkedin_auth.exchange_code_for_token(code)
    linkedin_auth.store_new_tokens(token_response)
    return func.HttpResponse("LinkedIn account connected successfully. You can close this tab.")


# ---------------------------------------------------------------------------
# Post CRUD
# ---------------------------------------------------------------------------

@app.route(route="posts/{year_month}", methods=["GET"], auth_level=func.AuthLevel.FUNCTION)
def list_posts(req: func.HttpRequest) -> func.HttpResponse:
    year_month = req.route_params.get("year_month")
    posts = storage.list_posts_for_month(year_month)
    return func.HttpResponse(
        json.dumps([p.__dict__ for p in posts]),
        mimetype="application/json",
    )


@app.route(route="posts", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def create_post(req: func.HttpRequest) -> func.HttpResponse:
    body = req.get_json()
    post = Post(
        scheduled_date=body["scheduled_date"],
        scheduled_time=body.get("scheduled_time", "09:00"),
        topic=body.get("topic", ""),
        copy_text=body.get("copy_text", ""),
        image_blob_name=body.get("image_blob_name"),
        status=body.get("status", STATUS_SCHEDULED),
    )
    storage.save_post(post)
    return func.HttpResponse(json.dumps(post.__dict__), mimetype="application/json", status_code=201)


@app.route(route="posts/{year_month}/{post_id}", methods=["PUT"], auth_level=func.AuthLevel.FUNCTION)
def update_post(req: func.HttpRequest) -> func.HttpResponse:
    year_month = req.route_params.get("year_month")
    post_id = req.route_params.get("post_id")
    existing = storage.get_post(post_id, year_month)
    if not existing:
        return func.HttpResponse("Post not found", status_code=404)

    body = req.get_json()
    for field in ("scheduled_date", "scheduled_time", "topic", "copy_text",
                  "image_blob_name", "status"):
        if field in body:
            setattr(existing, field, body[field])

    storage.save_post(existing)
    return func.HttpResponse(json.dumps(existing.__dict__), mimetype="application/json")


@app.route(route="posts/{year_month}/{post_id}", methods=["DELETE"], auth_level=func.AuthLevel.FUNCTION)
def delete_post(req: func.HttpRequest) -> func.HttpResponse:
    year_month = req.route_params.get("year_month")
    post_id = req.route_params.get("post_id")
    storage.delete_post(post_id, year_month)
    return func.HttpResponse(status_code=204)


@app.route(route="posts/{year_month}/{post_id}/image", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def upload_post_image(req: func.HttpRequest) -> func.HttpResponse:
    """Upload/replace the image for a specific post. Expects raw image bytes in the body."""
    year_month = req.route_params.get("year_month")
    post_id = req.route_params.get("post_id")
    post = storage.get_post(post_id, year_month)
    if not post:
        return func.HttpResponse("Post not found", status_code=404)

    content_type = req.headers.get("Content-Type", "image/jpeg")
    blob_name = f"{post_id}.jpg"
    storage.upload_image(blob_name, req.get_body(), content_type=content_type)

    post.image_blob_name = blob_name
    storage.save_post(post)
    return func.HttpResponse(json.dumps(post.__dict__), mimetype="application/json")


# ---------------------------------------------------------------------------
# Manual publish / cancel — no auto-scheduler. LinkedIn's public API has no
# "publish at future time" parameter, so scheduling is a calendar convenience
# only; you actually publish by clicking "Publish Now" when ready.
# ---------------------------------------------------------------------------

@app.route(route="posts/{year_month}/{post_id}/publish", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def publish_post_now(req: func.HttpRequest) -> func.HttpResponse:
    year_month = req.route_params.get("year_month")
    post_id = req.route_params.get("post_id")
    post = storage.get_post(post_id, year_month)
    if not post:
        return func.HttpResponse("Post not found", status_code=404)

    try:
        image_bytes = None
        if post.image_blob_name:
            image_bytes = storage.download_image_bytes(post.image_blob_name)

        post_urn = linkedin_auth.publish_post(post.copy_text, image_bytes)

        post.status = STATUS_PUBLISHED
        post.linkedin_post_urn = post_urn
        post.error_message = None
        storage.save_post(post)
        return func.HttpResponse(json.dumps(post.__dict__), mimetype="application/json")

    except Exception as e:
        post.status = STATUS_FAILED
        post.error_message = str(e)
        storage.save_post(post)
        logging.error(f"Failed to publish post {post.id}: {e}")
        return func.HttpResponse(json.dumps(post.__dict__), mimetype="application/json", status_code=500)


@app.route(route="posts/{year_month}/{post_id}/cancel", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def cancel_scheduled_post(req: func.HttpRequest) -> func.HttpResponse:
    """Reverts a scheduled post back to draft - nothing was actually 'pending' to
    stop since there's no auto-scheduler, this just takes it out of the scheduled state."""
    year_month = req.route_params.get("year_month")
    post_id = req.route_params.get("post_id")
    post = storage.get_post(post_id, year_month)
    if not post:
        return func.HttpResponse("Post not found", status_code=404)

    post.status = STATUS_DRAFT
    storage.save_post(post)
    return func.HttpResponse(json.dumps(post.__dict__), mimetype="application/json")
