const { app } = require("@azure/functions");
const storage = require("../shared/storage");

function json(status, data) {
  return { status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

app.http("listPoolImages", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "images/pool",
  handler: async (request, context) => {
    const images = await storage.listPoolImages();
    return json(200, images);
  },
});

app.http("uploadPoolImage", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "images/pool",
  handler: async (request, context) => {
    const fileName = request.query.get("fileName");
    if (!fileName) return { status: 400, body: "Missing 'fileName' query parameter" };

    const contentType = request.headers.get("content-type") || "image/jpeg";
    const bodyBuffer = Buffer.from(await request.arrayBuffer());
    const blobName = await storage.addImageToPool(fileName, bodyBuffer, contentType);
    return json(201, { blobName });
  },
});
