"""
Storage helpers: Table Storage for the content calendar, Blob Storage for images.
"""
import os
from datetime import datetime, timedelta
from azure.data.tables import TableServiceClient
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions

from .models import Post

CONN_STR = os.environ["AzureWebJobsStorage"]
SCHEDULE_TABLE_NAME = os.environ.get("SCHEDULE_TABLE_NAME", "PostSchedule")
TOKEN_TABLE_NAME = os.environ.get("TOKEN_TABLE_NAME", "AuthTokens")
IMAGE_CONTAINER_NAME = os.environ.get("IMAGE_CONTAINER_NAME", "post-images")


def _table_client(table_name: str):
    service = TableServiceClient.from_connection_string(CONN_STR)
    try:
        service.create_table(table_name)
    except Exception:
        pass  # already exists
    return service.get_table_client(table_name)


def _blob_service():
    return BlobServiceClient.from_connection_string(CONN_STR)


# ---------- Post CRUD ----------

def save_post(post: Post) -> Post:
    post.updated_at = datetime.utcnow().isoformat()
    client = _table_client(SCHEDULE_TABLE_NAME)
    client.upsert_entity(post.to_entity())
    return post


def get_post(post_id: str, month_partition: str) -> Post | None:
    client = _table_client(SCHEDULE_TABLE_NAME)
    try:
        entity = client.get_entity(partition_key=month_partition, row_key=post_id)
        return Post.from_entity(entity)
    except Exception:
        return None


def list_posts_for_month(year_month: str) -> list[Post]:
    """year_month like '2026-08'."""
    client = _table_client(SCHEDULE_TABLE_NAME)
    entities = client.query_entities(f"PartitionKey eq '{year_month}'")
    return [Post.from_entity(e) for e in entities]


def delete_post(post_id: str, month_partition: str) -> None:
    client = _table_client(SCHEDULE_TABLE_NAME)
    client.delete_entity(partition_key=month_partition, row_key=post_id)


# ---------- Images ----------

def upload_image(blob_name: str, data: bytes, content_type: str = "image/jpeg") -> str:
    service = _blob_service()
    container = service.get_container_client(IMAGE_CONTAINER_NAME)
    try:
        container.create_container()
    except Exception:
        pass
    container.upload_blob(blob_name, data, overwrite=True, content_settings={"content_type": content_type})
    return blob_name


def get_image_download_url(blob_name: str, expiry_minutes: int = 60) -> str:
    """Generate a short-lived SAS URL so LinkedIn's API (or the browser) can fetch the image."""
    service = _blob_service()
    account_name = service.account_name
    account_key = service.credential.account_key
    sas = generate_blob_sas(
        account_name=account_name,
        container_name=IMAGE_CONTAINER_NAME,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.utcnow() + timedelta(minutes=expiry_minutes),
    )
    return f"https://{account_name}.blob.core.windows.net/{IMAGE_CONTAINER_NAME}/{blob_name}?{sas}"


def download_image_bytes(blob_name: str) -> bytes:
    service = _blob_service()
    container = service.get_container_client(IMAGE_CONTAINER_NAME)
    return container.download_blob(blob_name).readall()


# ---------- OAuth token storage ----------

def save_tokens(access_token: str, refresh_token: str, expires_at: str, member_urn: str) -> None:
    client = _table_client(TOKEN_TABLE_NAME)
    client.upsert_entity({
        "PartitionKey": "linkedin",
        "RowKey": "default",  # single-user tool; use member_urn as RowKey if multi-user later
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "member_urn": member_urn,
    })


def get_tokens() -> dict | None:
    client = _table_client(TOKEN_TABLE_NAME)
    try:
        return dict(client.get_entity(partition_key="linkedin", row_key="default"))
    except Exception:
        return None
