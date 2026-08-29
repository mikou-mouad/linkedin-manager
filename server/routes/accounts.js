const express = require("express");
const { randomUUID } = require("crypto");
const storage = require("../shared/storage");

const router = express.Router();
const jsonBody = express.json();

router.get("/", async (req, res) => {
  const accounts = await storage.listAccounts();
  res.json(accounts);
});

/** Create a manual (name-only, no real LinkedIn OAuth) account. */
router.post("/", jsonBody, async (req, res) => {
  const displayName = (req.body.displayName || "").trim();
  if (!displayName) return res.status(400).json({ error: "Missing 'displayName'" });

  const accountId = `manual-${randomUUID()}`;
  await storage.saveManualAccount(accountId, displayName);
  res.status(201).json({ accountId, displayName, isManual: true });
});

router.delete("/:accountId", async (req, res) => {
  await storage.deleteAccount(req.params.accountId);
  res.status(204).send();
});

module.exports = router;
