const express = require("express");
const storage = require("../shared/storage");

const router = express.Router();
const rawBody = express.raw({ type: () => true, limit: "15mb" });

router.get("/pool", async (req, res) => {
  const images = await storage.listPoolImages();
  res.json(images);
});

router.post("/pool", rawBody, async (req, res) => {
  const fileName = req.query.fileName;
  if (!fileName) return res.status(400).send("Missing 'fileName' query parameter");

  const contentType = req.headers["content-type"] || "image/jpeg";
  const blobName = await storage.addImageToPool(fileName, req.body, contentType);
  res.status(201).json({ blobName });
});

module.exports = router;
