const express = require("express");
const storage = require("../shared/storage");
const linkedinAuth = require("../shared/linkedinAuth");
const aiFoundry = require("../shared/aiFoundry");
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

  const editableFields = ["scheduledDate", "scheduledTime", "topic", "copyText", "imageBlobName", "status", "targetType", "targetName", "funnelStage", "rationale"];
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

function buildContentInstructions() {
  return `You are a professional LinkedIn ghostwriter. Write a single LinkedIn post
for the given topic, matching the tone appropriate to its funnel stage:
- TOFU: educational/awareness tone, broadly appealing, no direct sales pitch.
- MOFU: demonstrates expertise, gives an actionable insight or framework.
- BOFU: proof-driven (results, case studies), includes a clear call to action.

Guidelines:
- 150-300 words.
- Natural, conversational tone - not overly corporate or salesy, no buzzword
  soup, sounds like a real person wrote it.
- Short paragraphs / line breaks for LinkedIn readability.
- Plain text only - no markdown formatting (no **, no #, no markdown links),
  since LinkedIn doesn't render markdown.
- 0-3 relevant hashtags at the very end, only if they genuinely add value.
- Use the web_search tool if it would make the post more specific or
  credible (a real stat, a genuinely current reference) - don't force it if
  the topic doesn't need it.

Respond with ONLY the post text itself - no title, no explanation, no
surrounding quotes.`;
}

function buildContentInput(post, industryContext) {
  let input = `Write a LinkedIn post for this topic: "${post.topic}".`;
  if (post.funnelStage) input += `\nFunnel stage: ${post.funnelStage}.`;
  if (post.rationale) input += `\nContext for why this topic was chosen: ${post.rationale}`;
  if (industryContext) input += `\nIndustry/context: ${industryContext}`;
  return input;
}

router.post("/:yearMonth/:postId/generate-content", jsonBody, async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post) return res.status(404).send("Post not found");

  const industryContext = req.body.industryContext || "";

  try {
    const result = await aiFoundry.callResponses(
      aiFoundry.textDeployment(),
      buildContentInput(post, industryContext),
      { instructions: buildContentInstructions(), webSearch: true, maxOutputTokens: 1500 }
    );
    let text = aiFoundry.extractOutputText(result).trim();
    // Strip accidental markdown fences or surrounding quotes some models add
    // despite instructions not to.
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    text = text.replace(/^"([\s\S]*)"$/, "$1").trim();

    post.copyText = text;
    post.status = STATUS_DRAFT;
    await storage.savePost(post);
    res.json(post);
  } catch (e) {
    console.error(`Failed to generate content for post ${post.id}:`, e);
    res.status(500).json({ error: `Content generation failed: ${e.message}` });
  }
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
