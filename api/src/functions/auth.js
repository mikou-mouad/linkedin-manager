const { app } = require("@azure/functions");
const { randomUUID } = require("crypto");
const linkedinAuth = require("../shared/linkedinAuth");

app.http("authStart", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "auth/start",
  handler: async (request, context) => {
    const state = randomUUID();
    const url = linkedinAuth.buildAuthorizationUrl(state);
    return { status: 302, headers: { Location: url } };
  },
});

app.http("authCallback", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "auth/callback",
  handler: async (request, context) => {
    const code = request.query.get("code");
    const error = request.query.get("error");
    if (error) {
      return { status: 400, body: `LinkedIn auth error: ${error}` };
    }
    if (!code) {
      return { status: 400, body: "Missing 'code' parameter" };
    }

    try {
      const tokenResponse = await linkedinAuth.exchangeCodeForToken(code);
      await linkedinAuth.storeNewTokens(tokenResponse);
      return { status: 200, body: "LinkedIn account connected successfully. You can close this tab." };
    } catch (e) {
      context.error(e);
      return { status: 500, body: `Failed to connect LinkedIn account: ${e.message}` };
    }
  },
});
