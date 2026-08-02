const { app } = require("@azure/functions");
const storage = require("../shared/storage");
const linkedinAuth = require("../shared/linkedinAuth");
const { newPost, STATUS_DRAFT, STATUS_SCHEDULED, STATUS_PUBLISHED, STATUS_FAILED } = require("../shared/models");

function json(status, data) {
  return { status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

app.http("listPosts", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}",
  handler: async (request, context) => {
    const yearMonth = request.params.yearMonth;
    const posts = await storage.listPostsForMonth(yearMonth);
    return json(200, posts);
  },
});

app.http("createPost", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request, context) => {
    const body = await request.json();
    const post = newPost({
      scheduledDate: body.scheduledDate,
      scheduledTime: body.scheduledTime || "09:00",
      topic: body.topic || "",
      copyText: body.copyText || "",
      imageBlobName: body.imageBlobName || null,
      status: body.status || STATUS_SCHEDULED,
    });
    await storage.savePost(post);
    return json(201, post);
  },
});

app.http("updatePost", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}/{postId}",
  handler: async (request, context) => {
    const { yearMonth, postId } = request.params;
    const existing = await storage.getPost(postId, yearMonth);
    if (!existing) return { status: 404, body: "Post not found" };

    const body = await request.json();
    const editableFields = ["scheduledDate", "scheduledTime", "topic", "copyText", "imageBlobName", "status"];
    for (const field of editableFields) {
      if (field in body) existing[field] = body[field];
    }
    await storage.savePost(existing);
    return json(200, existing);
  },
});

app.http("deletePost", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}/{postId}",
  handler: async (request, context) => {
    const { yearMonth, postId } = request.params;
    await storage.deletePost(postId, yearMonth);
    return { status: 204 };
  },
});

app.http("uploadPostImage", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}/{postId}/image",
  handler: async (request, context) => {
    const { yearMonth, postId } = request.params;
    const post = await storage.getPost(postId, yearMonth);
    if (!post) return { status: 404, body: "Post not found" };

    const contentType = request.headers.get("content-type") || "image/jpeg";
    const bodyBuffer = Buffer.from(await request.arrayBuffer());
    const blobName = await storage.uploadUsedImageForPost(postId, bodyBuffer, contentType);

    post.imageBlobName = blobName;
    await storage.savePost(post);
    return json(200, post);
  },
});

app.http("attachExistingImage", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}/{postId}/attach-image",
  handler: async (request, context) => {
    const { yearMonth, postId } = request.params;
    const post = await storage.getPost(postId, yearMonth);
    if (!post) return { status: 404, body: "Post not found" };

    const body = await request.json();
    if (!body.blobName) return { status: 400, body: "Missing 'blobName'" };

    const usedBlobName = await storage.moveImageToUsed(body.blobName, postId);
    post.imageBlobName = usedBlobName;
    await storage.savePost(post);
    return json(200, post);
  },
});

app.http("publishPostNow", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}/{postId}/publish",
  handler: async (request, context) => {
    const { yearMonth, postId } = request.params;
    const post = await storage.getPost(postId, yearMonth);
    if (!post) return { status: 404, body: "Post not found" };

    try {
      let imageBytes = null;
      if (post.imageBlobName) {
        imageBytes = await storage.downloadImageBytes(post.imageBlobName);
      }
      const postUrn = await linkedinAuth.publishPost(post.copyText, imageBytes);

      post.status = STATUS_PUBLISHED;
      post.linkedinPostUrn = postUrn;
      post.errorMessage = null;
      await storage.savePost(post);
      return json(200, post);
    } catch (e) {
      post.status = STATUS_FAILED;
      post.errorMessage = e.message;
      await storage.savePost(post);
      context.error(`Failed to publish post ${post.id}: ${e.message}`);
      return json(500, post);
    }
  },
});

app.http("cancelScheduledPost", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts/{yearMonth}/{postId}/cancel",
  handler: async (request, context) => {
    const { yearMonth, postId } = request.params;
    const post = await storage.getPost(postId, yearMonth);
    if (!post) return { status: 404, body: "Post not found" };

    post.status = STATUS_DRAFT;
    await storage.savePost(post);
    return json(200, post);
  },
});
