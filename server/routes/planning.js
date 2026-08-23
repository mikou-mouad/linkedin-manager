const express = require("express");
const storage = require("../shared/storage");
const aiFoundry = require("../shared/aiFoundry");
const { newPost, STATUS_PROPOSED } = require("../shared/models");

const router = express.Router();
const jsonBody = express.json();

function buildInstructions() {
  return `You are a LinkedIn content strategist. You propose LinkedIn post
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

You will be given exact required counts per funnel stage - hit those counts
precisely. You may also be given specific topics that MUST be included as-is
(don't meaningfully reword them, just assign each the funnel stage that fits
best) and/or a specific news item or story that MUST be covered by at least
one topic (research it further with web search if useful). Both of these
count toward the funnel-stage totals, not in addition to them.

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
Spread suggestedDate values reasonably across the requested month.`;
}

function buildInput({ yearMonth, tofuCount, mofuCount, bofuCount, industryContext, preselectedTopics, specificNews }) {
  const total = tofuCount + mofuCount + bofuCount;
  let input = `Generate exactly ${total} LinkedIn post topics for ${yearMonth}: ${tofuCount} TOFU, ${mofuCount} MOFU, ${bofuCount} BOFU.
Industry/context: ${industryContext || "not specified - use general professional/business relevance"}.
Search the web for what's actually happening in this space right now before proposing topics.`;

  if (preselectedTopics && preselectedTopics.length > 0) {
    input += `\n\nThese specific topics MUST be included as-is (assign each the funnel stage that fits best, they count toward the totals above):\n`;
    input += preselectedTopics.map((t) => `- ${t}`).join("\n");
  }

  if (specificNews && specificNews.trim()) {
    input += `\n\nAt least one topic MUST specifically cover this news/story (research it further with web search): "${specificNews.trim()}"`;
  }

  return input;
}

router.post("/generate", jsonBody, async (req, res) => {
  const { yearMonth } = req.body;
  const tofuCount = Number(req.body.tofuCount ?? 4);
  const mofuCount = Number(req.body.mofuCount ?? 4);
  const bofuCount = Number(req.body.bofuCount ?? 4);
  const industryContext = req.body.industryContext || "";
  const preselectedTopics = Array.isArray(req.body.preselectedTopics) ? req.body.preselectedTopics.filter(Boolean) : [];
  const specificNews = req.body.specificNews || "";

  if (!yearMonth) {
    return res.status(400).json({ error: "Missing 'yearMonth' (e.g. '2026-09')" });
  }
  if (tofuCount + mofuCount + bofuCount <= 0) {
    return res.status(400).json({ error: "At least one of tofuCount/mofuCount/bofuCount must be greater than 0" });
  }

  console.log(
    `[generateMonthlyPlan] Starting - yearMonth=${yearMonth} TOFU=${tofuCount} MOFU=${mofuCount} BOFU=${bofuCount} preselected=${preselectedTopics.length} hasNews=${!!specificNews}`
  );

  let proposedTopics;
  try {
    const startedAt = Date.now();
    const result = await aiFoundry.callResponses(
      aiFoundry.textDeployment(),
      buildInput({ yearMonth, tofuCount, mofuCount, bofuCount, industryContext, preselectedTopics, specificNews }),
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
        rationale: proposal.rationale || null,
        status: STATUS_PROPOSED,
      });
      await storage.savePost(post);
      createdPosts.push(post);
    }
  } catch (e) {
    console.error(`[generateMonthlyPlan] FAILED while saving posts:`, e);
    return res.status(500).json({ error: `Failed saving generated posts: ${e.message}`, partiallyCreated: createdPosts });
  }

  console.log(`[generateMonthlyPlan] Done - created ${createdPosts.length} posts`);
  res.status(201).json({ yearMonth, count: createdPosts.length, posts: createdPosts });
});

module.exports = router;
