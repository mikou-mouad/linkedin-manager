import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const API_BASE_URL = "/api";

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

function statusClass(status) {
  return `status status-${status}`;
}

// Cycled by position in the current accounts list (1st=blue, 2nd=green,
// 3rd=yellow, then repeats) - guarantees every account currently in the
// list gets a visually distinct color from its neighbors, unlike name/hash
// based assignment which can collide.
const ACCOUNT_COLOR_PALETTE = [
  { bg: "#dbeafe", text: "#1e40af" }, // blue
  { bg: "#dcfce7", text: "#166534" }, // green
  { bg: "#fef3c7", text: "#92400e" }, // yellow
];

const STATUS_DOT_COLOR = {
  proposed: "#ca8a04",
  draft: "#9ca3af",
  scheduled: "#2563eb",
  published: "#16a34a",
  failed: "#dc2626",
};

const UNASSIGNED_COLOR = { bg: "#e5e7eb", text: "#4b5563" };

function colorForAccount(accountId, accounts) {
  if (!accountId) return UNASSIGNED_COLOR;
  const index = accounts.findIndex((a) => a.accountId === accountId);
  if (index === -1) return UNASSIGNED_COLOR; // account no longer exists
  return ACCOUNT_COLOR_PALETTE[index % ACCOUNT_COLOR_PALETTE.length];
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

function PostCard({ post, onUpdateField, onUploadImage, onPublish, onCancel, onGenerateContent, generatingContent, onGenerateImage, generatingImage, accounts }) {
  const textareaRef = useRef(null);
  const rationaleRef = useRef(null);
  const assignedAccount = accounts.find((a) => a.accountId === post.targetAccountId) || null;

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [post.copyText]);

  useEffect(() => {
    const el = rationaleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [post.rationale]);

  return (
    <div className="post-card">
      <div className="thumb">
        {post.imageBlobName ? (
          <img src={`/api/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/image-file`} alt="" className="thumb-img" />
        ) : (
          ""
        )}
      </div>
      <div className="post-details">
        <div className="topic-row">
          <input
            className="topic-input"
            value={post.topic}
            onChange={(e) => onUpdateField(post, "topic", e.target.value)}
          />
          <select
            className={`funnel-select ${post.funnelStage ? `funnel-select-${post.funnelStage.toLowerCase()}` : ""}`}
            value={post.funnelStage || ""}
            onChange={(e) => onUpdateField(post, "funnelStage", e.target.value || null)}
          >
            <option value="">No stage</option>
            <option value="TOFU">TOFU</option>
            <option value="MOFU">MOFU</option>
            <option value="BOFU">BOFU</option>
          </select>
        </div>
        <div className="rationale-row">
          <span className="rationale-label">Why this topic:</span>
          <textarea
            ref={rationaleRef}
            className="rationale-input"
            value={post.rationale || ""}
            placeholder="Optional notes on why this topic/angle"
            rows={1}
            onChange={(e) => onUpdateField(post, "rationale", e.target.value)}
          />
        </div>
        <textarea
          ref={textareaRef}
          value={post.copyText}
          placeholder="Post content goes here — click &quot;Approve &amp; Generate Content&quot; to draft it with AI, or write it yourself."
          onChange={(e) => onUpdateField(post, "copyText", e.target.value)}
        />
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
          <select
            className="account-select"
            value={post.targetAccountId || ""}
            onChange={(e) => onUpdateField(post, "targetAccountId", e.target.value)}
          >
            <option value="">No account assigned</option>
            {accounts.map((acc) => (
              <option key={acc.accountId} value={acc.accountId}>
                {acc.displayName}
              </option>
            ))}
          </select>
          <input type="file" accept="image/*" onChange={(e) => onUploadImage(post, e.target.files[0])} />
          <button className="find-image-btn" onClick={() => onGenerateImage(post)} disabled={generatingImage}>
            {generatingImage ? "Finding image..." : post.imageBlobName ? "Replace image" : "Find/generate image"}
          </button>
        </div>
        <div className="actions">
          {post.status === "proposed" && (
            <button onClick={() => onGenerateContent(post)} disabled={generatingContent}>
              {generatingContent ? "Writing..." : "Approve & Generate Content"}
            </button>
          )}
          <button disabled={post.status === "published"} onClick={() => onPublish(post)}>
            {assignedAccount?.isManual ? "Mark as published" : "Publish now"}
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
  const [generatingContentFor, setGeneratingContentFor] = useState(null);
  const [generatingImageFor, setGeneratingImageFor] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [newAccountName, setNewAccountName] = useState("");

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

  const loadAccounts = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/accounts`);
    setAccounts(await res.json());
  }, []);

  async function addManualAccount() {
    const displayName = newAccountName.trim();
    if (!displayName) return;
    await fetch(`${API_BASE_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    setNewAccountName("");
    loadAccounts();
  }

  async function removeAccount(accountId) {
    if (!window.confirm("Remove this account? Posts already assigned to it will keep the reference but publishing will fail until reassigned.")) return;
    await fetch(`${API_BASE_URL}/accounts/${accountId}`, { method: "DELETE" });
    loadAccounts();
  }

  useEffect(() => {
    loadPosts();
    setSelectedPostId(null);
  }, [loadPosts]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

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
    const assignedAccount = accounts.find((a) => a.accountId === post.targetAccountId);
    const confirmText = assignedAccount?.isManual
      ? "Mark this post as published? (You'll need to actually post it on LinkedIn yourself.)"
      : "Publish this post to LinkedIn now? This happens immediately and can't be undone.";
    if (!window.confirm(confirmText)) return;
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

  async function generateContent(post) {
    setGeneratingContentFor(post.id);
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/generate-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industryContext }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: `Content generation failed: ${data.error || "unknown error"}` });
        return;
      }
      loadPosts();
    } catch (e) {
      setNotice({ type: "error", text: `Content generation failed: ${e.message}` });
    } finally {
      setGeneratingContentFor(null);
    }
  }

  async function generateImage(post) {
    setGeneratingImageFor(post.id);
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${post.scheduledDate.slice(0, 7)}/${post.id}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: `Image generation failed: ${data.error || "unknown error"}` });
        return;
      }
      setNotice({
        type: "success",
        text:
          data.source === "pool"
            ? `Found a matching image in your library (${data.matchScore}% match).`
            : "No good match in your library - generated a new image.",
      });
      loadPosts();
    } catch (e) {
      setNotice({ type: "error", text: `Image generation failed: ${e.message}` });
    } finally {
      setGeneratingImageFor(null);
    }
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
                {dayPosts.map((post) => {
                  const color = colorForAccount(post.targetAccountId, accounts);
                  return (
                    <button
                      key={post.id}
                      className={`calendar-post-pill ${post.id === selectedPostId ? "calendar-post-pill-selected" : ""}`}
                      style={{ backgroundColor: color.bg, color: color.text }}
                      onClick={() => setSelectedPostId(post.id)}
                      title={post.topic}
                    >
                      <span className="pill-status-dot" style={{ backgroundColor: STATUS_DOT_COLOR[post.status] || "#999" }} />
                      {post.funnelStage && <span className="pill-funnel">{post.funnelStage}</span>}
                      {post.topic || "Untitled"}
                    </button>
                  );
                })}
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

      <div className="accounts-panel">
        <strong>Accounts:</strong>
        {accounts.length === 0 && <span className="accounts-empty"> none yet</span>}
        {accounts.map((acc) => (
          <span key={acc.accountId} className={`account-chip ${acc.isManual ? "account-chip-manual" : ""}`}>
            {acc.displayName}
            {acc.isManual && <span className="manual-badge"> (manual)</span>}
            <button className="remove-account-btn" title="Remove" onClick={() => removeAccount(acc.accountId)}>×</button>
          </span>
        ))}
        <form
          className="add-account-form"
          onSubmit={(e) => {
            e.preventDefault();
            addManualAccount();
          }}
        >
          <input
            type="text"
            placeholder="Add account by name (e.g. Ahmed)"
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
          />
          <button type="submit">+ Add</button>
        </form>
        <a href="/api/auth/start" className="connect-account-btn">+ Connect real LinkedIn account</a>
      </div>

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
          <div className="calendar-legend">
            <span className="calendar-legend-item">
              <span className="legend-swatch" style={{ backgroundColor: UNASSIGNED_COLOR.bg }} />
              Unassigned
            </span>
            {accounts.map((acc) => {
              const color = colorForAccount(acc.accountId, accounts);
              return (
                <span key={acc.accountId} className="calendar-legend-item">
                  <span className="legend-swatch" style={{ backgroundColor: color.bg }} />
                  {acc.displayName}
                </span>
              );
            })}
          </div>
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
                onGenerateContent={generateContent}
                generatingContent={generatingContentFor === selectedPost.id}
                onGenerateImage={generateImage}
                generatingImage={generatingImageFor === selectedPost.id}
                accounts={accounts}
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
            onGenerateContent={generateContent}
            generatingContent={generatingContentFor === post.id}
            onGenerateImage={generateImage}
            generatingImage={generatingImageFor === post.id}
            accounts={accounts}
          />
        ))}
    </div>
  );
}
