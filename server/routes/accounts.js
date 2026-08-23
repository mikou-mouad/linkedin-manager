const express = require("express");
const storage = require("../shared/storage");

const router = express.Router();

router.get("/", async (req, res) => {
  const accounts = await storage.listAccounts();
  res.json(accounts);
});

module.exports = router;
