const express = require("express");
const path = require("path");

const authRoutes = require("./routes/auth");
const postsRoutes = require("./routes/posts");
const imagesRoutes = require("./routes/images");
const planningRoutes = require("./routes/planning");
const accountsRoutes = require("./routes/accounts");

const app = express();
const PORT = process.env.PORT || 8080;

app.use("/api/auth", authRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/images", imagesRoutes);
app.use("/api/plan", planningRoutes);
app.use("/api/accounts", accountsRoutes);

// Serve the built React frontend (copied into ./public during the build step)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// SPA fallback - any non-API route serves index.html so client-side routing
// (if we add any later) still works.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

// Last-resort error handler so nothing crashes the whole process silently.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
