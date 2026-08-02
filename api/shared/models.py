"""
Post data model.

Stored in Azure Table Storage. Table Storage entities are just dicts with
PartitionKey / RowKey, so we use:
  PartitionKey = year-month, e.g. "2026-08"   (lets you query a whole month cheaply)
  RowKey       = unique post id (uuid4)
"""
from __future__ import annotations
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional


STATUS_DRAFT = "draft"
STATUS_SCHEDULED = "scheduled"
STATUS_PUBLISHED = "published"
STATUS_FAILED = "failed"


@dataclass
class Post:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    scheduled_date: str = ""       # ISO date, e.g. "2026-08-15"
    scheduled_time: str = "09:00"  # HH:MM, 24h
    topic: str = ""
    copy_text: str = ""
    image_blob_name: Optional[str] = None   # blob name within the images container
    status: str = STATUS_DRAFT
    linkedin_post_urn: Optional[str] = None  # set once published
    error_message: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def partition_key(self) -> str:
        # "2026-08-15" -> "2026-08"
        return self.scheduled_date[:7] if self.scheduled_date else "unscheduled"

    def to_entity(self) -> dict:
        entity = asdict(self)
        entity["PartitionKey"] = self.partition_key()
        entity["RowKey"] = self.id
        return entity

    @staticmethod
    def from_entity(entity: dict) -> "Post":
        data = {k: v for k, v in entity.items() if k not in ("PartitionKey", "RowKey", "etag", "Timestamp")}
        return Post(**data)
