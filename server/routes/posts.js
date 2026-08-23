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

router.get("/:yearMonth/:postId/image-file", async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post || !post.imageBlobName) return res.status(404).send("No image");

  try {
    const bytes = await storage.downloadImageBytes(post.imageBlobName);
    const ext = post.imageBlobName.split(".").pop().toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.send(bytes);
  } catch (e) {
    res.status(500).send("Failed to load image");
  }
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

const IMAGE_MATCH_THRESHOLD = 50;

function buildImagePromptFromTopic(post) {
  let prompt = `Professional, editorial-style image representing this LinkedIn post topic: "${post.topic}".`;
  if (post.funnelStage) prompt += ` Tone appropriate for a ${post.funnelStage} (funnel stage) business post.`;
  if (post.rationale) prompt += ` Context: ${post.rationale}`;
  prompt += ` Modern, clean, suitable for a professional social media feed. No text overlay, no logos, no watermarks.`;
  return prompt;
}

router.post("/:yearMonth/:postId/generate-image", jsonBody, async (req, res) => {
  const { yearMonth, postId } = req.params;
  const post = await storage.getPost(postId, yearMonth);
  if (!post) return res.status(404).send("Post not found");

  try {
    const pool = await storage.listPoolImages();
    let bestMatch = null;

    if (pool.length > 0) {
      const candidates = [];
      for (const item of pool) {
        const bytes = await storage.downloadImageBytes(item.blobName);
        candidates.push({
          blobName: item.blobName,
          base64: bytes.toString("base64"),
          mimeType: item.contentType || "image/jpeg",
        });
      }

      const matchInstructions = `You are matching an image from a library to a LinkedIn post topic.
For each image provided (in the order shown, first image = index 0), score how
well it visually fits the given topic, from 0 (no fit) to 100 (perfect fit).
Respond with ONLY a JSON array (no markdown fences, no commentary) of objects
shaped like: [{"index": 0, "score": 73}, {"index": 1, "score": 12}]`;

      const matchText = `Topic: "${post.topic}"${post.rationale ? `\nContext: ${post.rationale}` : ""}\n\nScore each of the ${candidates.length} images below against this topic.`;

      const visionInput = aiFoundry.buildVisionInput(
        matchText,
        candidates.map((c) => ({ base64: c.base64, mimeType: c.mimeType }))
      );

      const result = await aiFoundry.callResponses(aiFoundry.visionDeployment(), visionInput, {
        instructions: matchInstructions,
        maxOutputTokens: 1000,
      });
      const text = aiFoundry.extractOutputText(result);
      const scores = aiFoundry.parseJsonFromText(text);

      if (Array.isArray(scores) && scores.length > 0) {
        const top = scores.reduce((best, s) => (s.score > best.score ? s : best), scores[0]);
        if (top.score >= IMAGE_MATCH_THRESHOLD && candidates[top.index]) {
          bestMatch = { blobName: candidates[top.index].blobName, score: top.score };
        }
      }
    }

    if (bestMatch) {
      const usedBlobName = await storage.moveImageToUsed(bestMatch.blobName, postId);
      post.imageBlobName = usedBlobName;
      await storage.savePost(post);
      return res.json({ post, source: "pool", matchScore: bestMatch.score });
    }

    // No pool image matched well enough (or pool is empty) - generate one.
    const prompt = buildImagePromptFromTopic(post);
    const imageBytes = await aiFoundry.callImageGeneration(aiFoundry.imageGenDeployment(), prompt);
    const blobName = await storage.uploadUsedImageForPost(postId, imageBytes, "image/png");
    post.imageBlobName = blobName;
    await storage.savePost(post);
    res.json({ post, source: "generated" });
  } catch (e) {
    console.error(`Failed to generate/match image for post ${post.id}:`, e);
    res.status(500).json({ error: `Image generation failed: ${e.message}` });
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
