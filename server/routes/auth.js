const express = require("express");
const { randomUUID } = require("crypto");
const linkedinAuth = require("../shared/linkedinAuth");

const router = express.Router();

router.get("/start", (req, res) => {
  const state = randomUUID();
  const url = linkedinAuth.buildAuthorizationUrl(state);
  res.redirect(url);
});

router.get("/callback", async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    return res.status(400).send(`LinkedIn auth error: ${error}`);
  }
  if (!code) {
    return res.status(400).send("Missing 'code' parameter");
  }

  try {
    const tokenResponse = await linkedinAuth.exchangeCodeForToken(code);
    await linkedinAuth.storeNewAccount(tokenResponse);
    res.redirect("/");
  } catch (e) {
    console.error("LinkedIn OAuth callback failed:", e);
    res.status(500).send(`Failed to connect LinkedIn account: ${e.message}`);
  }
});

module.exports = router;
