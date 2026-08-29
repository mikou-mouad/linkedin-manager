const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { toEntity, fromEntity } = require("./models");

function connStr() {
  return process.env.LINKEDIN_STORAGE_CONNECTION_STRING;
}

const SCHEDULE_TABLE_NAME = process.env.SCHEDULE_TABLE_NAME || "PostSchedule";
const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME || "AuthTokens";
const IMAGE_CONTAINER_NAME = process.env.IMAGE_CONTAINER_NAME || "post-images";

async function tableClient(tableName) {
  const client = TableClient.fromConnectionString(connStr(), tableName, { allowInsecureConnection: true });
  try {
    await client.createTable();
  } catch (e) {
    // already exists - fine
  }
  return client;
}

function blobService() {
  return BlobServiceClient.fromConnectionString(connStr());
}

// ---------- Post CRUD ----------

async function savePost(post) {
  post.updatedAt = new Date().toISOString();
  const client = await tableClient(SCHEDULE_TABLE_NAME);
  await client.upsertEntity(toEntity(post), "Merge");
  return post;
}

async function getPost(postId, monthPartition) {
  const client = await tableClient(SCHEDULE_TABLE_NAME);
  try {
    const entity = await client.getEntity(monthPartition, postId);
    return fromEntity(entity);
  } catch (e) {
    return null;
  }
}

async function listPostsForMonth(yearMonth) {
  const client = await tableClient(SCHEDULE_TABLE_NAME);
  const posts = [];
  const iter = client.listEntities({ queryOptions: { filter: `PartitionKey eq '${yearMonth}'` } });
  for await (const entity of iter) {
    posts.push(fromEntity(entity));
  }
  return posts;
}

async function deletePost(postId, monthPartition) {
  const client = await tableClient(SCHEDULE_TABLE_NAME);
  await client.deleteEntity(monthPartition, postId);
}

// ---------- Images ----------
// Images live under two virtual folders (blob name prefixes) in the same
// container: "new/" is the unassigned pool - the only thing checked when
// matching a fresh image to a post - and "used/" is anything already tied
// to a post, permanently excluded from future matching passes.

const NEW_PREFIX = "new/";
const USED_PREFIX = "used/";

function containerClient() {
  const service = blobService();
  return service.getContainerClient(IMAGE_CONTAINER_NAME);
}

async function ensureContainer(container) {
  try {
    await container.createIfNotExists();
  } catch (e) {
    // ignore - already exists
  }
}

async function uploadImage(blobName, data, contentType = "image/jpeg") {
  const container = containerClient();
  await ensureContainer(container);
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  return blobName;
}

/** Add an image to the unassigned pool (new/), for later AI/manual matching. */
async function addImageToPool(fileName, data, contentType = "image/jpeg") {
  const blobName = `${NEW_PREFIX}${fileName}`;
  await uploadImage(blobName, data, contentType);
  return blobName;
}

/** List images in the unassigned pool - this is the only set checked when matching. */
async function listPoolImages() {
  const container = containerClient();
  await ensureContainer(container);
  const results = [];
  for await (const blob of container.listBlobsFlat({ prefix: NEW_PREFIX })) {
    results.push({
      blobName: blob.name,
      fileName: blob.name.slice(NEW_PREFIX.length),
      contentType: blob.properties.contentType,
      sizeBytes: blob.properties.contentLength,
    });
  }
  return results;
}

/**
 * Move an image from the pool (new/) to used/, tying it to a specific post.
 * Blob storage has no rename, so this copies then deletes the source.
 */
async function moveImageToUsed(poolBlobName, postId) {
  const container = containerClient();
  const ext = poolBlobName.includes(".") ? poolBlobName.slice(poolBlobName.lastIndexOf(".")) : ".jpg";
  const destBlobName = `${USED_PREFIX}${postId}${ext}`;

  const sourceClient = container.getBlockBlobClient(poolBlobName);
  const destClient = container.getBlockBlobClient(destBlobName);

  const copyPoller = await destClient.beginCopyFromURL(sourceClient.url);
  await copyPoller.pollUntilDone();
  await sourceClient.deleteIfExists();

  return destBlobName;
}

/** Directly upload an image already tied to a specific post (manual upload flow). */
async function uploadUsedImageForPost(postId, data, contentType = "image/jpeg") {
  const ext = contentType === "image/png" ? ".png" : ".jpg";
  const blobName = `${USED_PREFIX}${postId}${ext}`;
  await uploadImage(blobName, data, contentType);
  return blobName;
}

async function downloadImageBytes(blobName) {
  const container = containerClient();
  const blockBlob = container.getBlockBlobClient(blobName);
  const downloadResponse = await blockBlob.download();
  return await streamToBuffer(downloadResponse.readableStreamBody);
}

function streamToBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on("data", (data) => chunks.push(data instanceof Buffer ? data : Buffer.from(data)));
    readableStream.on("end", () => resolve(Buffer.concat(chunks)));
    readableStream.on("error", reject);
  });
}

// ---------- OAuth account storage (multiple connected LinkedIn accounts) ----------
// Each connected account is its own row, keyed by their LinkedIn member ID
// (stable, one per person). This lets multiple people connect their own
// accounts and posts get assigned to whichever one should publish them.

async function saveAccount({ accountId, accessToken, refreshToken, expiresAt, memberUrn, displayName }) {
  const client = await tableClient(TOKEN_TABLE_NAME);
  await client.upsertEntity(
    {
      partitionKey: "linkedin",
      rowKey: accountId,
      accessToken,
      refreshToken,
      expiresAt,
      memberUrn,
      displayName: displayName || memberUrn,
      isManual: false,
    },
    "Merge"
  );
}

/**
 * Creates a "manual" account - just a name, no real LinkedIn OAuth token.
 * Used for tracking who a post is for before that person's real account can
 * be connected (e.g. still waiting on API approval for org posting), or for
 * anyone who'll publish manually themselves rather than through this app.
 */
async function saveManualAccount(accountId, displayName) {
  const client = await tableClient(TOKEN_TABLE_NAME);
  await client.upsertEntity(
    {
      partitionKey: "linkedin",
      rowKey: accountId,
      displayName,
      isManual: true,
    },
    "Merge"
  );
}

async function deleteAccount(accountId) {
  const client = await tableClient(TOKEN_TABLE_NAME);
  await client.deleteEntity("linkedin", accountId);
}

async function getAccount(accountId) {
  const client = await tableClient(TOKEN_TABLE_NAME);
  try {
    const entity = await client.getEntity("linkedin", accountId);
    return entity;
  } catch (e) {
    return null;
  }
}

/** List connected accounts - excludes raw tokens, safe to send to the frontend. */
async function listAccounts() {
  const client = await tableClient(TOKEN_TABLE_NAME);
  const accounts = [];
  const iter = client.listEntities({ queryOptions: { filter: `PartitionKey eq 'linkedin'` } });
  for await (const entity of iter) {
    accounts.push({
      accountId: entity.rowKey,
      displayName: entity.displayName || entity.memberUrn,
      memberUrn: entity.memberUrn || null,
      isManual: !!entity.isManual,
    });
  }
  return accounts;
}

module.exports = {
  savePost,
  getPost,
  listPostsForMonth,
  deletePost,
  uploadImage,
  addImageToPool,
  listPoolImages,
  moveImageToUsed,
  uploadUsedImageForPost,
  downloadImageBytes,
  saveAccount,
  saveManualAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  IMAGE_CONTAINER_NAME,
};
