import { useState, useEffect, useCallback } from "react";

const API_BASE_URL = "/api";

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

function statusClass(status) {
  return `status status-${status}`;
}

export default function App() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [industryContext, setIndustryContext] = useState("");
  const [numberOfPosts, setNumberOfPosts] = useState(12);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planResults, setPlanResults] = useState(null); // { count, posts } | null
  const [planError, setPlanError] = useState(null);
  const [notice, setNotice] = useState(null); // small transient message, e.g. publish failures

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${yearMonth}`);
      const data = await res.json();
      data.sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime));
      setPosts(data);
    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  async function generateMonthlyPlan() {
    setGeneratingPlan(true);
    setPlanResults(null);
    setPlanError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/plan/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, numberOfPosts: Number(numberOfPosts), industryContext }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlanError(data.error || "unknown error");
        return;
      }
      setPlanResults(data);
      loadPosts();
    } catch (e) {
      setPlanError(e.message);
    } finally {
      setGeneratingPlan(false);
    }
  }

  async function updateField(post, field, value) {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, [field]: value } : p)));
    await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
  }

  async function addPost() {
    await fetch(`${API_BASE_URL}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledDate: `${yearMonth}-01`,
        scheduledTime: "09:00",
        topic: "New post",
        copyText: "",
        status: "draft",
      }),
    });
    loadPosts();
  }

  async function uploadImage(post, file) {
    if (!file) return;
    await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/image`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    loadPosts();
  }

  async function publishNow(post) {
    if (!window.confirm("Publish this post to LinkedIn now? This happens immediately and can't be undone.")) return;
    const res = await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/publish`, {
      method: "POST",
    });
    if (!res.ok) {
      setNotice({ type: "error", text: "Publish failed - check the post's error message below." });
    } else {
      setNotice({ type: "success", text: "Published." });
    }
    loadPosts();
  }

  async function cancelPost(post) {
    await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/cancel`, {
      method: "POST",
    });
    loadPosts();
  }

  return (
    <div className="app">
      <h1>Monthly LinkedIn schedule</h1>

      <div className="plan-generator">
        <div className="plan-generator-row">
          <input
            type="text"
            placeholder="Industry / context (e.g. B2B SaaS, project management tools)"
            value={industryContext}
            onChange={(e) => setIndustryContext(e.target.value)}
            className="industry-input"
          />
          <input
            type="number"
            min="1"
            max="30"
            value={numberOfPosts}
            onChange={(e) => setNumberOfPosts(e.target.value)}
            className="count-input"
            title="Number of topics to propose"
          />
          <button onClick={generateMonthlyPlan} disabled={generatingPlan}>
            {generatingPlan ? "Generating..." : "Generate Monthly Plan"}
          </button>
        </div>
        {generatingPlan && (
          <p className="plan-generator-hint">
            Searching the web and drafting topic ideas — this can take 20-40 seconds.
          </p>
        )}
        {planError && (
          <div className="plan-error">
            <strong>Plan generation failed:</strong> {planError}
            <button className="dismiss-btn" onClick={() => setPlanError(null)}>×</button>
          </div>
        )}
      </div>

      {planResults && (
        <div className="plan-results">
          <div className="plan-results-header">
            <strong>Generated {planResults.count} topic ideas for {planResults.yearMonth}</strong>
            <button className="dismiss-btn" onClick={() => setPlanResults(null)}>×</button>
          </div>
          <ul className="plan-results-list">
            {planResults.posts.map((p) => (
              <li key={p.id}>
                <span className="funnel-tag">{p.funnelStage}</span> {p.topic}
                {p.rationale && <span className="rationale"> — {p.rationale}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <div className={`notice notice-${notice.type}`}>
          {notice.text}
          <button className="dismiss-btn" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="toolbar">
        <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
        <button onClick={loadPosts}>Load</button>
        <button onClick={addPost}>+ New post</button>
      </div>

      {loading && <p>Loading...</p>}
      {!loading && posts.length === 0 && <p>No posts yet for this month.</p>}

      {posts.map((post) => (
        <div className="post-card" key={post.id}>
          <div className="thumb">{post.imageBlobName ? "🖼" : ""}</div>
          <div className="post-details">
            <div className="topic-row">
              <input
                className="topic-input"
                value={post.topic}
                onChange={(e) => updateField(post, "topic", e.target.value)}
              />
              {post.funnelStage && <span className="funnel-tag">{post.funnelStage}</span>}
            </div>
            <textarea
              value={post.copyText}
              onChange={(e) => updateField(post, "copyText", e.target.value)}
            />
            <div className="meta">
              <input
                type="date"
                value={post.scheduledDate}
                onChange={(e) => updateField(post, "scheduledDate", e.target.value)}
              />
              <input
                type="time"
                value={post.scheduledTime}
                onChange={(e) => updateField(post, "scheduledTime", e.target.value)}
              />
              <span className={statusClass(post.status)}>{post.status}</span>
              <input type="file" accept="image/*" onChange={(e) => uploadImage(post, e.target.files[0])} />
            </div>
            <div className="actions">
              <button disabled={post.status === "published"} onClick={() => publishNow(post)}>
                Publish now
              </button>
              <button disabled={post.status !== "scheduled"} onClick={() => cancelPost(post)}>
                Cancel
              </button>
            </div>
            {post.status === "failed" && post.errorMessage && (
              <p className="error-msg">{post.errorMessage}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
