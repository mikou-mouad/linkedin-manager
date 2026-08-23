const express = require("express");
const storage = require("../shared/storage");
const aiFoundry = require("../shared/aiFoundry");
const { newPost, STATUS_PROPOSED } = require("../shared/models");

const router = express.Router();
const jsonBody = express.json();

function buildInstructions() {
  return `You are a LinkedIn content strategist. You propose a month's worth of post
topics following the TOFU/MOFU/BOFU funnel framework:
- TOFU (Top of funnel): broad, awareness-building topics - industry trends,
  hot news, general insights. Should attract a wide audience.
- MOFU (Middle of funnel): more specific, positions expertise - how-tos,
  frameworks, comparisons, lessons learned.
- BOFU (Bottom of funnel): closer to a call to action - case studies, results,
  direct offers, testimonials.

Use the web_search tool to find current, relevant news and trending topics in
the person's industry before proposing ideas - do not rely only on general
knowledge, ground at least some TOFU topics in something genuinely recent.

Respond with ONLY a JSON array (no markdown fences, no commentary) of objects
with this exact shape:
[
  {
    "topic": "short topic title",
    "funnelStage": "TOFU" | "MOFU" | "BOFU",
    "rationale": "one sentence on why this topic, ideally referencing what you found",
    "suggestedDate": "YYYY-MM-DD"
  }
]
Spread suggestedDate values reasonably across the requested month. Aim for a
healthy mix across all three funnel stages, weighted toward TOFU and MOFU.`;
}

function buildInput({ yearMonth, numberOfPosts, industryContext }) {
  return `Generate ${numberOfPosts} LinkedIn post topic ideas for ${yearMonth}.
Industry/context: ${industryContext || "not specified - use general professional/business relevance"}.
Search the web for what's actually happening in this space right now before proposing topics.`;
}

router.post("/generate", jsonBody, async (req, res) => {
  const { yearMonth } = req.body;
  const numberOfPosts = req.body.numberOfPosts || 12;
  const industryContext = req.body.industryContext || "";

  if (!yearMonth) {
    return res.status(400).json({ error: "Missing 'yearMonth' (e.g. '2026-09')" });
  }

  console.log(`[generateMonthlyPlan] Starting - yearMonth=${yearMonth} numberOfPosts=${numberOfPosts}`);

  let proposedTopics;
  try {
    const startedAt = Date.now();
    const result = await aiFoundry.callResponses(
      aiFoundry.textDeployment(),
      buildInput({ yearMonth, numberOfPosts, industryContext }),
      { instructions: buildInstructions(), webSearch: true, maxOutputTokens: 4000 }
    );
    console.log(`[generateMonthlyPlan] AI Foundry call completed in ${Date.now() - startedAt}ms`);
    const text = aiFoundry.extractOutputText(result);
    proposedTopics = aiFoundry.parseJsonFromText(text);
  } catch (e) {
    console.error(`[generateMonthlyPlan] FAILED during AI call/parse:`, e);
    return res.status(500).json({ error: `Plan generation failed: ${e.message}` });
  }

  if (!Array.isArray(proposedTopics)) {
    return res.status(500).json({ error: "Model did not return a JSON array as expected", raw: proposedTopics });
  }

  const createdPosts = [];
  try {
    for (const proposal of proposedTopics) {
      const post = newPost({
        scheduledDate: proposal.suggestedDate || `${yearMonth}-01`,
        scheduledTime: "09:00",
        topic: proposal.topic || "Untitled topic",
        funnelStage: proposal.funnelStage || null,
        status: STATUS_PROPOSED,
      });
      await storage.savePost(post);
      createdPosts.push({ ...post, rationale: proposal.rationale || null });
    }
  } catch (e) {
    console.error(`[generateMonthlyPlan] FAILED while saving posts:`, e);
    return res.status(500).json({ error: `Failed saving generated posts: ${e.message}`, partiallyCreated: createdPosts });
  }

  console.log(`[generateMonthlyPlan] Done - created ${createdPosts.length} posts`);
  res.status(201).json({ yearMonth, count: createdPosts.length, posts: createdPosts });
});

module.exports = router;
