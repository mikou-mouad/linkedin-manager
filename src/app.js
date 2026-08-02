function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

document.getElementById("monthPicker").value = new Date().toISOString().slice(0, 7);

async function loadPosts() {
  const yearMonth = document.getElementById("monthPicker").value;
  const res = await fetch(apiUrl(`/posts/${yearMonth}`));
  const posts = await res.json();
  posts.sort((a, b) => (a.scheduled_date + a.scheduled_time).localeCompare(b.scheduled_date + b.scheduled_time));
  renderPosts(posts);
}

function renderPosts(posts) {
  const container = document.getElementById("posts");
  container.innerHTML = "";
  if (posts.length === 0) {
    container.innerHTML = "<p>No posts yet for this month.</p>";
    return;
  }
  for (const post of posts) {
    const card = document.createElement("div");
    card.className = "post-card";
    card.innerHTML = `
      <img src="${post.image_blob_name ? "" : ""}" alt="post image" id="img-${post.id}">
      <div class="post-details">
        <input type="text" value="${post.topic}" onchange="updateField('${post.id}','${post.scheduled_date.slice(0,7)}','topic', this.value)" style="font-weight:600; border:none; width:100%; background:transparent;">
        <textarea onchange="updateField('${post.id}','${post.scheduled_date.slice(0,7)}','copy_text', this.value)">${post.copy_text}</textarea>
        <div class="meta">
          <input type="date" value="${post.scheduled_date}" onchange="updateField('${post.id}','${post.scheduled_date.slice(0,7)}','scheduled_date', this.value)">
          <input type="time" value="${post.scheduled_time}" onchange="updateField('${post.id}','${post.scheduled_date.slice(0,7)}','scheduled_time', this.value)">
          <span class="status status-${post.status}">${post.status}</span>
          <input type="file" accept="image/*" onchange="uploadImage('${post.id}','${post.scheduled_date.slice(0,7)}', this.files[0])">
        </div>
        <div class="actions">
          <button onclick="publishNow('${post.id}','${post.scheduled_date.slice(0,7)}')" ${post.status === 'published' ? 'disabled' : ''}>Publish Now</button>
          <button onclick="cancelPost('${post.id}','${post.scheduled_date.slice(0,7)}')" ${post.status !== 'scheduled' ? 'disabled' : ''}>Cancel</button>
        </div>
        ${post.status === 'failed' && post.error_message ? `<div class="error-msg">${post.error_message}</div>` : ''}
      </div>
    `;
    container.appendChild(card);
  }
}

async function updateField(postId, yearMonth, field, value) {
  await fetch(apiUrl(`/posts/${yearMonth}/${postId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: value }),
  });
}

async function uploadImage(postId, yearMonth, file) {
  if (!file) return;
  await fetch(apiUrl(`/posts/${yearMonth}/${postId}/image`), {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  loadPosts();
}

async function publishNow(postId, yearMonth) {
  if (!confirm("Publish this post to LinkedIn now? This happens immediately and can't be undone.")) return;
  const res = await fetch(apiUrl(`/posts/${yearMonth}/${postId}/publish`), { method: "POST" });
  if (!res.ok) {
    alert("Publish failed - check the post's error message after refresh.");
  }
  loadPosts();
}

async function cancelPost(postId, yearMonth) {
  await fetch(apiUrl(`/posts/${yearMonth}/${postId}/cancel`), { method: "POST" });
  loadPosts();
}

async function addPost() {
  const yearMonth = document.getElementById("monthPicker").value;
  await fetch(apiUrl("/posts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scheduled_date: `${yearMonth}-01`,
      scheduled_time: "09:00",
      topic: "New post",
      copy_text: "",
      status: "draft",
    }),
  });
  loadPosts();
}

loadPosts();
