/**
 * Client for Azure AI Foundry's Responses API (/openai/v1/responses).
 * Used instead of the older Chat Completions endpoint because gpt-5.6-*
 * models only support tool use (like web_search) combined with reasoning
 * through the Responses API - Chat Completions rejects that combination.
 */

function endpoint() {
  return process.env.AI_FOUNDRY_ENDPOINT;
}
function apiKey() {
  return process.env.AI_FOUNDRY_API_KEY;
}
function textDeployment() {
  return process.env.AI_FOUNDRY_TEXT_DEPLOYMENT;
}
function visionDeployment() {
  return process.env.AI_FOUNDRY_VISION_DEPLOYMENT;
}
function imageGenDeployment() {
  return process.env.AI_FOUNDRY_IMAGE_GEN_DEPLOYMENT;
}

/**
 * Calls the Responses API with a given model deployment.
 * @param {string} deploymentName
 * @param {string} input - the prompt text
 * @param {object} opts
 * @param {boolean} opts.webSearch - enable the built-in web_search tool
 * @param {number} opts.maxOutputTokens
 */
async function callResponses(deploymentName, input, opts = {}) {
  const base = endpoint().replace(/\/$/, "");
  const url = `${base}/openai/v1/responses`;

  const body = {
    model: deploymentName,
    input,
  };
  if (opts.instructions) body.instructions = opts.instructions;
  if (opts.maxOutputTokens) body.max_output_tokens = opts.maxOutputTokens;
  if (opts.webSearch) body.tools = [{ type: "web_search" }];

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`AI Foundry Responses API error (${resp.status}): ${errText}`);
  }

  return resp.json();
}

/**
 * Extracts the plain text answer from a Responses API result.
 * The response is a list of "output" items - web_search_call items,
 * reasoning items, and finally a "message" item with the actual text.
 */
function extractOutputText(responsesResult) {
  const output = responsesResult.output || [];
  for (const item of output) {
    if (item.type === "message" && item.role === "assistant" && Array.isArray(item.content)) {
      const textPart = item.content.find((c) => c.type === "output_text");
      if (textPart) return textPart.text;
    }
  }
  // Fallback: some SDKs/shapes expose a top-level output_text convenience field.
  if (responsesResult.output_text) return responsesResult.output_text;
  return "";
}

/**
 * Parses JSON out of a model's text response, tolerating markdown code
 * fences (```json ... ```) that models often wrap structured output in
 * even when explicitly asked not to.
 */
function parseJsonFromText(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fenceMatch ? fenceMatch[1] : trimmed;
  return JSON.parse(jsonCandidate);
}

module.exports = {
  textDeployment,
  visionDeployment,
  imageGenDeployment,
  callResponses,
  extractOutputText,
  parseJsonFromText,
};
