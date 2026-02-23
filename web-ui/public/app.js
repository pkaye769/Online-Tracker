const modeEl = document.getElementById("mode");
const queryEl = document.getElementById("query");
const searchBtn = document.getElementById("searchBtn");
const resultEl = document.getElementById("result");
const sourcesPanelEl = document.getElementById("sourcesPanel");
const sourcesRefreshEl = document.getElementById("sourcesRefresh");
const trackerStartBtnEl = document.getElementById("trackerStartBtn");
const trackerStopBtnEl = document.getElementById("trackerStopBtn");
const trackerStatusEl = document.getElementById("trackerStatus");
const apiBase = window.location.protocol === "file:" ? "http://127.0.0.1:3000" : "";

function backendHint(error) {
  const base = `Backend/API not reachable (${error.message}). Start the app with CLICK_ME_START_BOTH.bat and open http://localhost:3000 (not the HTML file directly).`;
  if (window.location.protocol === "file:") {
    return `You opened this page as a file. ${base}`;
  }
  return base;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeDate(value) {
  if (!value) return "N/A";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function renderCards(cards) {
  resultEl.innerHTML = cards.join("") || "<p class='muted'>No results.</p>";
}

function renderSourceCards(data) {
  const checkedAt = safeDate(data?.checkedAt);
  const liveEnabled = data?.liveEnabled ? "enabled" : "disabled";
  const sources = Array.isArray(data?.sources) ? data.sources : [];

  if (!sources.length) {
    sourcesPanelEl.innerHTML = "<p class='muted'>No source data.</p>";
    return;
  }

  const cards = sources.map((src) => {
    const isOk = src.status === "ok";
    const detail = src.details
      ? Object.entries(src.details).map(([k, v]) => `${k}: ${v}`).join(" | ")
      : (src.error || "no details");

    return `
      <article class="source-card">
        <div class="source-top">
          <h3>${escapeHtml(src.name)}</h3>
          <span class="pill ${isOk ? "ok" : "err"}">${escapeHtml(src.status)}</span>
        </div>
        <div class="meta">${escapeHtml(src.url || "")}</div>
        <div class="meta">latency: ${escapeHtml(src.latencyMs ?? "?")} ms</div>
        <div class="meta">${escapeHtml(detail)}</div>
      </article>
    `;
  });

  sourcesPanelEl.innerHTML = `
    <div class="meta">Checked: ${escapeHtml(checkedAt)} | Live sources: ${escapeHtml(liveEnabled)}</div>
    ${cards.join("")}
  `;
}

async function loadSources() {
  sourcesPanelEl.innerHTML = "<p class='muted'>Checking sources...</p>";

  try {
    const res = await fetch(`${apiBase}/api/sources`);
    const data = await res.json();
    renderSourceCards(data);
  } catch (error) {
    sourcesPanelEl.innerHTML = `<p class='muted'>Source check failed: ${escapeHtml(backendHint(error))}</p>`;
  }
}

function renderTrackerStatus(data) {
  const running = Boolean(data?.running);
  const worlds = Array.isArray(data?.worlds) ? data.worlds.join(", ") : "";
  const interval = data?.intervalMs ?? "?";
  const lastTick = safeDate(data?.lastPollAt);
  trackerStatusEl.textContent = `Tracker: ${running ? "running" : "stopped"} | worlds: ${worlds || "N/A"} | interval: ${interval}ms | last tick: ${lastTick}`;
}

async function loadTrackerStatus() {
  try {
    const res = await fetch(`${apiBase}/api/tracker/status`);
    const data = await res.json();
    renderTrackerStatus(data);
  } catch (error) {
    trackerStatusEl.textContent = `Tracker status failed: ${backendHint(error)}`;
  }
}

async function startTracker() {
  trackerStatusEl.textContent = "Starting tracker...";
  try {
    const res = await fetch(`${apiBase}/api/tracker/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) {
      trackerStatusEl.textContent = `Start failed: ${data?.error || "unknown error"}`;
      return;
    }
    renderTrackerStatus(data);
  } catch (error) {
    trackerStatusEl.textContent = `Start failed: ${backendHint(error)}`;
  }
}

async function stopTracker() {
  trackerStatusEl.textContent = "Stopping tracker...";
  try {
    const res = await fetch(`${apiBase}/api/tracker/stop`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      trackerStatusEl.textContent = `Stop failed: ${data?.error || "unknown error"}`;
      return;
    }
    renderTrackerStatus(data);
  } catch (error) {
    trackerStatusEl.textContent = `Stop failed: ${backendHint(error)}`;
  }
}

function renderAltCards(data) {
  if (!data.found) {
    renderCards([`<p class='muted'>${escapeHtml(data.message || "No data")}</p>`]);
    return;
  }

  const trackerHeader = `
    <article class="card">
      <h3>Tracker Evidence</h3>
      <div class="meta">window: ${escapeHtml(data.tracker?.windowSeconds || "?")}s | min pairs: ${escapeHtml(data.tracker?.minPairs || "?")}</div>
      <div class="meta">tracker candidates: ${escapeHtml(data.tracker?.candidateCount || 0)}</div>
    </article>
  `;

  const cards = data.candidates.map((c) => {
    const transitionLines = Array.isArray(c.transitions) && c.transitions.length
      ? c.transitions
        .map((t) => `${safeDate(t.seedLogoutAt)} -> ${safeDate(t.candidateLoginAt)} (${t.deltaSeconds}s)`)
        .join(" | ")
      : "none";

    return `
      <article class="card">
        <h3>${escapeHtml(c.name)} <span class="meta">(${escapeHtml(c.world)})</span></h3>
        <div class="meta">${c.level} ${escapeHtml(c.vocation)} | ${escapeHtml(c.guild || "No guild")}</div>
        <div>Confidence: <strong>${c.confidence}%</strong> <span class="meta">(${escapeHtml(String(c.confidenceLabel || "low").toUpperCase())})</span></div>
        <div class="meta">adjacencies: ${escapeHtml(c.adjacencies || 0)} | clashes: ${escapeHtml(c.clashes || 0)}</div>
        <div class="meta">${escapeHtml(c.reasons.join(", "))}</div>
        <div class="meta">transitions: ${escapeHtml(transitionLines)}</div>
        <div class="meta">source: ${escapeHtml(c.source || "unknown")}</div>
      </article>
    `;
  });

  renderCards([trackerHeader, ...cards]);
}

async function runSearch() {
  const mode = modeEl.value;
  const query = queryEl.value.trim();

  if (!query) {
    resultEl.innerHTML = "<p class='muted'>Enter a query first.</p>";
    return;
  }

  resultEl.innerHTML = "<p class='muted'>Searching...</p>";

  try {
    let url = "";
    if (mode === "alt") url = `${apiBase}/api/search/alt?q=${encodeURIComponent(query)}&mode=best`;
    if (mode === "alt-strict") url = `${apiBase}/api/search/alt?q=${encodeURIComponent(query)}&mode=strict`;
    if (mode === "alt-relaxed") url = `${apiBase}/api/search/alt?q=${encodeURIComponent(query)}&mode=relaxed`;
    if (mode === "guild") url = `${apiBase}/api/search/guild?q=${encodeURIComponent(query)}`;
    if (mode === "traded") url = `${apiBase}/api/search/traded?character=${encodeURIComponent(query)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (mode === "alt" || mode === "alt-strict" || mode === "alt-relaxed") {
      renderAltCards(data);
      return;
    }

    if (mode === "guild") {
      const cards = data.members.map((m) => `
        <article class="card">
          <h3>${escapeHtml(m.name)} <span class="meta">(${escapeHtml(m.world)})</span></h3>
          <div>${m.level} ${escapeHtml(m.vocation)}</div>
          <div class="meta">Last login: ${escapeHtml(safeDate(m.lastLogin))}</div>
          <div class="meta">source: ${escapeHtml(m.source || "unknown")}</div>
        </article>
      `);

      renderCards(cards);
      return;
    }

    if (!data.found) {
      renderCards([`<p class='muted'>${escapeHtml(data.message || "No data")}</p>`]);
      return;
    }

    const cards = [
      `<article class="card"><h3>${escapeHtml(data.character.name)}</h3><div>Last traded: <strong>${escapeHtml(data.lastTradedAt || "N/A")}</strong></div><div>Last transferred: <strong>${escapeHtml(data.lastTransferredAt || "N/A")}</strong></div><div class="meta">source: ${escapeHtml(data.character.source || "unknown")}</div></article>`,
      ...data.traded.map((t) => `<article class="card"><h3>Trade</h3><div>${escapeHtml(t.date)} | ${escapeHtml(t.type)}</div><div class="meta">source: ${escapeHtml(t.source)}</div></article>`),
      ...data.transfers.map((t) => `<article class="card"><h3>Transfer</h3><div>${escapeHtml(t.date)} | ${escapeHtml(t.from)} -> ${escapeHtml(t.to)}</div><div class="meta">source: ${escapeHtml(t.source)}</div></article>`)
    ];

    renderCards(cards);
  } catch (error) {
    resultEl.innerHTML = `<p class='muted'>Request failed: ${escapeHtml(backendHint(error))}</p>`;
  }
}

searchBtn.addEventListener("click", runSearch);
sourcesRefreshEl.addEventListener("click", loadSources);
trackerStartBtnEl.addEventListener("click", startTracker);
trackerStopBtnEl.addEventListener("click", stopTracker);
queryEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});

loadSources();
loadTrackerStatus();
