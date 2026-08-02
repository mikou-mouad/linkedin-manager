const { randomUUID } = require("crypto");

const STATUS_DRAFT = "draft";
const STATUS_SCHEDULED = "scheduled";
const STATUS_PUBLISHED = "published";
const STATUS_FAILED = "failed";

/**
 * Stored in Azure Table Storage. Entities are flat objects with
 * partitionKey / rowKey:
 *   partitionKey = year-month, e.g. "2026-08" (cheap per-month queries)
 *   rowKey       = unique post id (uuid)
 */
function newPost(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || randomUUID(),
    scheduledDate: overrides.scheduledDate || "",
    scheduledTime: overrides.scheduledTime || "09:00",
    topic: overrides.topic || "",
    copyText: overrides.copyText || "",
    imageBlobName: overrides.imageBlobName ?? null,
    status: overrides.status || STATUS_DRAFT,
    linkedinPostUrn: overrides.linkedinPostUrn ?? null,
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function partitionKey(post) {
  return post.scheduledDate ? post.scheduledDate.slice(0, 7) : "unscheduled";
}

function toEntity(post) {
  return {
    partitionKey: partitionKey(post),
    rowKey: post.id,
    ...post,
  };
}

function fromEntity(entity) {
  const result = {};
  for (const [key, value] of Object.entries(entity)) {
    if (key === "partitionKey" || key === "rowKey" || key === "etag" || key === "timestamp") continue;
    if (key.startsWith("odata.") || key.startsWith("Odata.")) continue;
    result[key] = value;
  }
  return result;
}

module.exports = {
  STATUS_DRAFT,
  STATUS_SCHEDULED,
  STATUS_PUBLISHED,
  STATUS_FAILED,
  newPost,
  partitionKey,
  toEntity,
  fromEntity,
};
