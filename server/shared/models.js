const { randomUUID } = require("crypto");

const STATUS_PROPOSED = "proposed"; // AI-suggested topic, awaiting your approval
const STATUS_DRAFT = "draft";
const STATUS_SCHEDULED = "scheduled";
const STATUS_PUBLISHED = "published";
const STATUS_FAILED = "failed";

const TARGET_PERSON = "person"; // your own profile - the only one that actually works today
const TARGET_ORGANIZATION = "organization"; // a company page - needs LinkedIn's Community Management API approval, not usable yet

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
    funnelStage: overrides.funnelStage || null, // "TOFU" | "MOFU" | "BOFU"
    rationale: overrides.rationale ?? null, // why this topic was suggested - context for content generation later
    copyText: overrides.copyText || "",
    imageBlobName: overrides.imageBlobName ?? null,
    status: overrides.status || STATUS_DRAFT,
    targetType: overrides.targetType || TARGET_PERSON,
    targetName: overrides.targetName || "My profile",
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
  STATUS_PROPOSED,
  STATUS_DRAFT,
  STATUS_SCHEDULED,
  STATUS_PUBLISHED,
  STATUS_FAILED,
  TARGET_PERSON,
  TARGET_ORGANIZATION,
  newPost,
  partitionKey,
  toEntity,
  fromEntity,
};
