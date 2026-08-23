import { useState, useEffect, useCallback, useMemo } from "react";

const API_BASE_URL = "/api";

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

function statusClass(status) {
  return `status status-${status}`;
}

function daysInMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

// 0 = Monday ... 6 = Sunday (week starts on Monday)
function firstWeekdayOffset(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const jsDay = new Date(year, month - 1, 1).getDay(); // 0 = Sunday
  return (jsDay + 6) % 7;
}

function PostCard({ post, onUpdateField, onUploadImage, onPublish, onCancel }) {
  return (
    <div className="post-card">
      <div className="thumb">{post.imageBlobName ? "🖼" : ""}</div>
      <div className="post-details">
        <div className="topic-row">
          <input
            className="topic-input"
            value={post.topic}
            onChange={(e) => onUpdateField(post, "topic", e.target.value)}
          />
          {post.funnelStage && <span className="funnel-tag">{post.funnelStage}</span>}
        </div>
        <textarea value={post.copyText} onChange={(e) => onUpdateField(post, "copyText", e.target.value)} />
        <div className="meta">
          <input
            type="date"
            value={post.scheduledDate}
            onChange={(e) => onUpdateField(post, "scheduledDate", e.target.value)}
          />
          <input
            type="time"
            value={post.scheduledTime}
            onChange={(e) => onUpdateField(post, "scheduledTime", e.target.value)}
          />
          <span className={statusClass(post.status)}>{post.status}</span>
          <input type="file" accept="image/*" onChange={(e) => onUploadImage(post, e.target.files[0])} />
        </div>
        <div className="actions">
          <button disabled={post.status === "published"} onClick={() => onPublish(post)}>
            Publish now
          </button>
          <button disabled={post.status !== "scheduled"} onClick={() => onCancel(post)}>
            Cancel
          </button>
        </div>
        {post.status === "failed" && post.errorMessage && <p className="error-msg">{post.errorMessage}</p>}
      </div>
    </div>
  );
}

export default function App() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [industryContext, setIndustryContext] = useState("");
  const [tofuCount, setTofuCount] = useState(4);
  const [mofuCount, setMofuCount] = useState(4);
  const [bofuCount, setBofuCount] = useState(4);
  const [preselectedTopicsText, setPreselectedTopicsText] = useState("");
  const [specificNews, setSpecificNews] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planResults, setPlanResults] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [view, setView] = useState("calendar"); // "calendar" | "list"
  const [selectedPostId, setSelectedPostId] = useState(null);

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
    setSelectedPostId(null);
  }, [loadPosts]);

  async function generateMonthlyPlan() {
    setGeneratingPlan(true);
    setPlanResults(null);
    setPlanError(null);
    try {
      const preselectedTopics = preselectedTopicsText
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch(`${API_BASE_URL}/plan/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearMonth,
          tofuCount: Number(tofuCount),
          mofuCount: Number(mofuCount),
          bofuCount: Number(bofuCount),
          industryContext,
          preselectedTopics,
          specificNews,
        }),
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

  async function addPost(dateOverride) {
    const res = await fetch(`${API_BASE_URL}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledDate: dateOverride || `${yearMonth}-01`,
        scheduledTime: "09:00",
        topic: "New post",
        copyText: "",
        status: "draft",
      }),
    });
    const created = await res.json();
    await loadPosts();
    setSelectedPostId(created.id);
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
    setNotice(
      res.ok
        ? { type: "success", text: "Published." }
        : { type: "error", text: "Publish failed - check the post's error message below." }
    );
    loadPosts();
  }

  async function cancelPost(post) {
    await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/cancel`, {
      method: "POST",
    });
    loadPosts();
  }

  const postsByDay = useMemo(() => {
    const map = {};
    for (const post of posts) {
      const day = Number(post.scheduledDate.slice(8, 10));
      if (!map[day]) map[day] = [];
      map[day].push(post);
    }
    return map;
  }, [posts]);

  const selectedPost = posts.find((p) => p.id === selectedPostId) || null;

  function renderCalendar() {
    const total = daysInMonth(yearMonth);
    const offset = firstWeekdayOffset(yearMonth);
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(d);

    return (
      <div className="calendar">
        <div className="calendar-weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="calendar-weekday">{d}</div>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`blank-${idx}`} className="calendar-cell calendar-cell-blank" />;
            const dayPosts = postsByDay[day] || [];
            const dateStr = `${yearMonth}-${String(day).padStart(2, "0")}`;
            return (
              <div key={day} className="calendar-cell">
                <div className="calendar-cell-header">
                  <span className="calendar-day-num">{day}</span>
                  <button className="calendar-add-btn" title="Add post on this day" onClick={() => addPost(dateStr)}>
                    +
                  </button>
                </div>
                {dayPosts.map((post) => (
                  <button
                    key={post.id}
                    className={`calendar-post-pill ${statusClass(post.status)} ${post.id === selectedPostId ? "calendar-post-pill-selected" : ""}`}
                    onClick={() => setSelectedPostId(post.id)}
                    title={post.topic}
                  >
                    {post.funnelStage && <span className="pill-funnel">{post.funnelStage}</span>}
                    {post.topic || "Untitled"}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
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
          <label className="count-label">
            TOFU
            <input
              type="number"
              min="0"
              max="30"
              value={tofuCount}
              onChange={(e) => setTofuCount(e.target.value)}
              className="count-input"
            />
          </label>
          <label className="count-label">
            MOFU
            <input
              type="number"
              min="0"
              max="30"
              value={mofuCount}
              onChange={(e) => setMofuCount(e.target.value)}
              className="count-input"
            />
          </label>
          <label className="count-label">
            BOFU
            <input
              type="number"
              min="0"
              max="30"
              value={bofuCount}
              onChange={(e) => setBofuCount(e.target.value)}
              className="count-input"
            />
          </label>
          <button onClick={generateMonthlyPlan} disabled={generatingPlan}>
            {generatingPlan ? "Generating..." : "Generate Monthly Plan"}
          </button>
        </div>

        <button className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "▾" : "▸"} Preselected subjects / specific news to cover
        </button>
        {showAdvanced && (
          <div className="advanced-panel">
            <label className="advanced-field">
              Preselected subjects (one per line — these will be included as-is)
              <textarea
                rows={3}
                value={preselectedTopicsText}
                onChange={(e) => setPreselectedTopicsText(e.target.value)}
                placeholder={"Our new pricing model explained\nWhy we moved to a usage-based plan"}
              />
            </label>
            <label className="advanced-field">
              Specific news / story to cover
              <textarea
                rows={2}
                value={specificNews}
                onChange={(e) => setSpecificNews(e.target.value)}
                placeholder="e.g. the recent AZ-104 exam update from Microsoft"
              />
            </label>
          </div>
        )}

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
        <button onClick={() => addPost()}>+ New post</button>
        <div className="view-toggle">
          <button className={view === "calendar" ? "view-btn-active" : ""} onClick={() => setView("calendar")}>
            Calendar
          </button>
          <button className={view === "list" ? "view-btn-active" : ""} onClick={() => setView("list")}>
            List
          </button>
        </div>
      </div>

      {loading && <p>Loading...</p>}
      {!loading && posts.length === 0 && <p>No posts yet for this month.</p>}

      {view === "calendar" && !loading && posts.length > 0 && (
        <>
          {renderCalendar()}
          {selectedPost && (
            <div className="selected-post-panel">
              <div className="selected-post-header">
                <strong>Editing post</strong>
                <button className="dismiss-btn" onClick={() => setSelectedPostId(null)}>×</button>
              </div>
              <PostCard
                post={selectedPost}
                onUpdateField={updateField}
                onUploadImage={uploadImage}
                onPublish={publishNow}
                onCancel={cancelPost}
              />
            </div>
          )}
        </>
      )}

      {view === "list" &&
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onUpdateField={updateField}
            onUploadImage={uploadImage}
            onPublish={publishNow}
            onCancel={cancelPost}
          />
        ))}
    </div>
  );
}
