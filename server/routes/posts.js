const express = require("express");
const storage = require("../shared/storage");
const linkedinAuth = require("../shared/linkedinAuth");
const { newPost, STATUS_DRAFT, STATUS_PUBLISHED, STATUS_FAILED } = require("../shared/models");

const router = express.Router();
const jsonBody = express.json();
const rawBody = express.raw({ type: () => true, limit: "15mb" });

router.get("/:yearMonth", async (req, res) => {
  const posts = await storage.listPostsForMonth(req.params.yearMonth);
  res.json(posts);
});

router.post("/", jsonBody, async (req, res) => {
  const body = req.body;
  const post = newPost({
    scheduledDate: body.scheduledDate,
    scheduledTime: body.scheduledTime || "09:00",
    topic: body.topic || "",
    copyText: body.copyText || "",
    imageBlobName: body.imageBlobName || null,
    status: body.status || "scheduled",
  });
  await storage.savePost(post);
  res.status(201).json(post);
});

router.put("/:yearMonth/:postId", jsonBody, async (req, res) => {
  const { yearMonth, postId } = req.params;
  const existing = await storage.getPost(postId, yearMonth);
  if (!existing) return res.status(404).send("Post not found");

  const editableFields = ["scheduledDate", "scheduledTime", "topic", "copyText", "imageBlobName", "status", "targetType", "targetName"];
  for (const field of editableFields) {
    if (field in req.body) existing[field] = req.body[field];
  }
  await storage.savePost(existing);
  res.json(existing);
});

router.delete("/:yearMonth/:postId", async (req, res) => {
  await storage.deletePost(req.params.postId, req.params.yearMonth);
  res.status(204).send();
});

router.post("/:yearMonth/:postId/image", rawBody, async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post) return res.status(404).send("Post not found");

  const contentType = req.headers["content-type"] || "image/jpeg";
  const blobName = await storage.uploadUsedImageForPost(postId, req.body, contentType);

  post.imageBlobName = blobName;
  await storage.savePost(post);
  res.json(post);
});

router.post("/:yearMonth/:postId/attach-image", jsonBody, async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post) return res.status(404).send("Post not found");

  if (!req.body.blobName) return res.status(400).send("Missing 'blobName'");

  const usedBlobName = await storage.moveImageToUsed(req.body.blobName, postId);
  post.imageBlobName = usedBlobName;
  await storage.savePost(post);
  res.json(post);
});

router.post("/:yearMonth/:postId/publish", async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post) return res.status(404).send("Post not found");

  try {
    let imageBytes = null;
    if (post.imageBlobName) {
      imageBytes = await storage.downloadImageBytes(post.imageBlobName);
    }
    const postUrn = await linkedinAuth.publishPost(post.copyText, imageBytes);

    post.status = STATUS_PUBLISHED;
    post.linkedinPostUrn = postUrn;
    post.errorMessage = null;
    await storage.savePost(post);
    res.json(post);
  } catch (e) {
    post.status = STATUS_FAILED;
    post.errorMessage = e.message;
    await storage.savePost(post);
    console.error(`Failed to publish post ${post.id}:`, e);
    res.status(500).json(post);
  }
});

router.post("/:yearMonth/:postId/cancel", async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post) return res.status(404).send("Post not found");

  post.status = STATUS_DRAFT;
  await storage.savePost(post);
  res.json(post);
});

module.exports = router;
