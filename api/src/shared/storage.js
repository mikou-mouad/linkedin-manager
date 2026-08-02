const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");
const { toEntity, fromEntity } = require("./models");

function connStr() {
  return process.env.AzureWebJobsStorage;
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

async function uploadImage(blobName, data, contentType = "image/jpeg") {
  const service = blobService();
  const container = service.getContainerClient(IMAGE_CONTAINER_NAME);
  try {
    await container.createIfNotExists();
  } catch (e) {
    // ignore
  }
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  return blobName;
}

async function downloadImageBytes(blobName) {
  const service = blobService();
  const container = service.getContainerClient(IMAGE_CONTAINER_NAME);
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

// ---------- OAuth token storage ----------

async function saveTokens(accessToken, refreshToken, expiresAt, memberUrn) {
  const client = await tableClient(TOKEN_TABLE_NAME);
  await client.upsertEntity(
    {
      partitionKey: "linkedin",
      rowKey: "default",
      accessToken,
      refreshToken,
      expiresAt,
      memberUrn,
    },
    "Merge"
  );
}

async function getTokens() {
  const client = await tableClient(TOKEN_TABLE_NAME);
  try {
    const entity = await client.getEntity("linkedin", "default");
    return entity;
  } catch (e) {
    return null;
  }
}

module.exports = {
  savePost,
  getPost,
  listPostsForMonth,
  deletePost,
  uploadImage,
  downloadImageBytes,
  saveTokens,
  getTokens,
  IMAGE_CONTAINER_NAME,
};
