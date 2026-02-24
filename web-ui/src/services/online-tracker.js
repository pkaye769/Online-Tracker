import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRACKER_FILE = path.join(__dirname, "..", "..", "data", "online-tracker.json");

const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 8000);
const TIBIA_WHOISONLINE_URL_TEMPLATE =
  process.env.TIBIA_WHOISONLINE_URL_TEMPLATE ||
  "https://www.tibia.com/community/?subtopic=whoisonline&world={world}";
const TIBIADATA_API_BASE = process.env.TIBIADATA_API_BASE || "https://api.tibiadata.com/v4";
const TRACKER_MAX_EVENTS_PER_CHARACTER = Number(process.env.TRACKER_MAX_EVENTS_PER_CHARACTER || 2000);
const TRACKER_MIN_TRANSITION_PAIRS = Number(process.env.TRACKER_MIN_TRANSITION_PAIRS || 2);
const TRACKER_TRANSITION_WINDOW_SECONDS = Number(process.env.TRACKER_TRANSITION_WINDOW_SECONDS || 180);
const TRACKER_POLL_INTERVAL_MS = Number(process.env.TRACKER_POLL_INTERVAL_MS || 60000);
const TRACKER_WORLDS = (process.env.TRACKER_WORLDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const TRACKER_AUTOSTART = String(process.env.TRACKER_AUTOSTART || "false").toLowerCase() === "true";

const runtime = {
  running: false,
  intervalMs: TRACKER_POLL_INTERVAL_MS,
  worlds: [...TRACKER_WORLDS],
  timer: null,
  lastSnapshotByWorld: new Map(),
  lastPollAt: null,
  pollCount: 0,
  errors: 0
};

let storeCache = null;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function encodeWorld(world) {
  return encodeURIComponent(String(world || "").trim());
}

function parseCharacterLinksFromHtml(html) {
  const matches = [...html.matchAll(/subtopic=characters&name=([^"&<]+)/gi)];
  const unique = new Map();

  for (const match of matches) {
    const raw = decodeURIComponent(match[1] || "").replaceAll("+", " ").trim();
    if (!raw) continue;
    const key = normalize(raw);
    if (!unique.has(key)) unique.set(key, raw);
  }

  return [...unique.values()];
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: { "user-agent": "Mozilla/5.0 (compatible; tibia-alt-dashboard/1.0)" }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWorldOnlineFromTibia(world) {
  const url = TIBIA_WHOISONLINE_URL_TEMPLATE.replace("{world}", encodeWorld(world));
  const html = await fetchText(url);
  const names = parseCharacterLinksFromHtml(html);
  return { names, source: "tibia.com", url };
}

async function fetchWorldOnlineFromTibiaData(world) {
  const url = `${TIBIADATA_API_BASE}/world/${encodeWorld(world)}`;
  const payload = await fetchJson(url);
  const root = payload?.world?.world || payload?.worlds?.world || payload?.world || {};
  const players = root?.online_players || root?.onlinePlayers || [];
  const names = [...new Set(players.map((p) => String(p?.name || "").trim()).filter(Boolean))];
  return { names, source: "tibiadata", url };
}

async function fetchWorldOnline(world) {
  try {
    const tibia = await fetchWorldOnlineFromTibia(world);
    if (tibia.names.length) return tibia;
  } catch {
    // Fallback below.
  }

  return fetchWorldOnlineFromTibiaData(world);
}

async function ensureStore() {
  if (storeCache) return storeCache;

  try {
    const raw = await fs.readFile(TRACKER_FILE, "utf8");
    storeCache = JSON.parse(raw);
  } catch {
    storeCache = {
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      characters: {}
    };
    await persistStore();
  }

  if (!storeCache.characters) storeCache.characters = {};
  return storeCache;
}

async function persistStore() {
  if (!storeCache) return;
  storeCache.meta.updatedAt = new Date().toISOString();
  await fs.writeFile(TRACKER_FILE, JSON.stringify(storeCache, null, 2), "utf8");
}

function upsertCharacterRecord(name, world) {
  const key = normalize(name);
  if (!storeCache.characters[key]) {
    storeCache.characters[key] = {
      name,
      world,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: null,
      events: [],
      sessions: []
    };
  }

  const rec = storeCache.characters[key];
  rec.name = name;
  if (world) rec.world = world;
  rec.lastSeenAt = new Date().toISOString();
  return rec;
}

function appendEvent(name, world, type, atIso, seeded = false) {
  const rec = upsertCharacterRecord(name, world);
  rec.events.push({ type, at: atIso, world, seeded: Boolean(seeded) });

  if (type === "login") {
    rec.sessions.push({ loginAt: atIso, logoutAt: null, world, seeded: Boolean(seeded) });
  }

  if (type === "logout") {
    for (let i = rec.sessions.length - 1; i >= 0; i -= 1) {
      if (!rec.sessions[i].logoutAt) {
        rec.sessions[i].logoutAt = atIso;
        if (seeded && rec.sessions[i].seeded === undefined) {
          rec.sessions[i].seeded = true;
        }
        break;
      }
    }
  }

  if (rec.events.length > TRACKER_MAX_EVENTS_PER_CHARACTER) {
    rec.events.splice(0, rec.events.length - TRACKER_MAX_EVENTS_PER_CHARACTER);
  }
}

function diffSets(prev, next) {
  const logins = [];
  const logouts = [];

  for (const value of next) {
    if (!prev.has(value)) logins.push(value);
  }
  for (const value of prev) {
    if (!next.has(value)) logouts.push(value);
  }

  return { logins, logouts };
}

async function pollWorld(world) {
  const nowIso = new Date().toISOString();
  const { names, source } = await fetchWorldOnline(world);

  const currentMap = new Map(names.map((n) => [normalize(n), n]));
  const currentSet = new Set(currentMap.keys());
  const previous = runtime.lastSnapshotByWorld.get(world);

  if (!previous) {
    runtime.lastSnapshotByWorld.set(world, currentMap);
    for (const name of names) {
      appendEvent(name, world, "login", nowIso, true);
    }
    return { world, source, initialSnapshot: true, onlineCount: names.length, logins: 0, logouts: 0 };
  }

  const previousSet = new Set(previous.keys());
  const { logins, logouts } = diffSets(previousSet, currentSet);
  runtime.lastSnapshotByWorld.set(world, currentMap);

  for (const key of logins) {
    appendEvent(currentMap.get(key) || key, world, "login", nowIso);
  }
  for (const key of logouts) {
    appendEvent(previous.get(key) || key, world, "logout", nowIso);
  }

  return {
    world,
    source,
    initialSnapshot: false,
    onlineCount: names.length,
    logins: logins.length,
    logouts: logouts.length
  };
}

async function pollOnce() {
  if (!runtime.running || !runtime.worlds.length) return;
  await ensureStore();

  const checks = await Promise.allSettled(runtime.worlds.map((world) => pollWorld(world)));
  runtime.lastPollAt = new Date().toISOString();
  runtime.pollCount += 1;

  for (const check of checks) {
    if (check.status === "rejected") runtime.errors += 1;
  }

  await persistStore();
}

export async function startOnlineTracker(config = {}) {
  const worlds = Array.isArray(config.worlds) && config.worlds.length
    ? config.worlds.map((w) => String(w).trim()).filter(Boolean)
    : [...TRACKER_WORLDS];

  if (!worlds.length) {
    throw new Error("No worlds configured. Set TRACKER_WORLDS or pass worlds in start request.");
  }

  const intervalMs = Number(config.intervalMs || TRACKER_POLL_INTERVAL_MS);
  if (intervalMs < 15000) throw new Error("intervalMs must be at least 15000");

  await ensureStore();

  runtime.worlds = worlds;
  runtime.intervalMs = intervalMs;

  if (runtime.timer) {
    clearInterval(runtime.timer);
    runtime.timer = null;
  }

  runtime.running = true;
  await pollOnce();
  runtime.timer = setInterval(() => {
    pollOnce().catch(() => {
      runtime.errors += 1;
    });
  }, runtime.intervalMs);

  return getTrackerStatus();
}

export function stopOnlineTracker() {
  runtime.running = false;
  if (runtime.timer) clearInterval(runtime.timer);
  runtime.timer = null;
  return getTrackerStatus();
}

export function getTrackerStatus() {
  return {
    running: runtime.running,
    intervalMs: runtime.intervalMs,
    worlds: runtime.worlds,
    lastPollAt: runtime.lastPollAt,
    pollCount: runtime.pollCount,
    errors: runtime.errors,
    storageFile: TRACKER_FILE
  };
}

export async function getTrackedCharacters() {
  const store = await ensureStore();
  return Object.values(store.characters || {});
}

export async function getOnlineStatus(characterName) {
  const store = await ensureStore();
  const key = normalize(characterName);
  const rec = store.characters?.[key];
  if (!rec) {
    return { found: false, online: false, lastSeenAt: null, lastEvent: null };
  }

  const events = Array.isArray(rec.events) ? rec.events : [];
  const lastEvent = events.length ? events[events.length - 1] : null;

  const sessions = Array.isArray(rec.sessions) ? rec.sessions : [];
  const lastSession = sessions.length ? sessions[sessions.length - 1] : null;
  const online = Boolean(lastSession && lastSession.loginAt && !lastSession.logoutAt);

  return {
    found: true,
    online,
    lastSeenAt: rec.lastSeenAt || null,
    lastEvent
  };
}

function ts(value) {
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function buildTransitionPairs(seed, candidate, windowSeconds, includeSeeded = false) {
  const seedLogouts = (seed.events || [])
    .filter((e) => e.type === "logout" && (includeSeeded || !e.seeded))
    .sort((a, b) => ts(a.at) - ts(b.at));
  const candidateLogins = (candidate.events || [])
    .filter((e) => e.type === "login" && (includeSeeded || !e.seeded))
    .sort((a, b) => ts(a.at) - ts(b.at));

  const pairs = [];
  let j = 0;

  for (const s of seedLogouts) {
    while (j < candidateLogins.length && ts(candidateLogins[j].at) < ts(s.at) - windowSeconds * 1000) {
      j += 1;
    }

    for (let k = j; k < candidateLogins.length; k += 1) {
      const deltaMs = ts(candidateLogins[k].at) - ts(s.at);
      if (deltaMs < -windowSeconds * 1000) continue;
      if (deltaMs > windowSeconds * 1000) break;

      pairs.push({
        seedLogoutAt: s.at,
        candidateLoginAt: candidateLogins[k].at,
        deltaSeconds: Math.round(deltaMs / 1000)
      });
      break;
    }
  }

  return {
    pairs,
    seedLogoutCount: seedLogouts.length,
    candidateLoginCount: candidateLogins.length
  };
}

function getClosedSegments(character, includeSeeded = false) {
  return (character.sessions || [])
    .filter((s) => s.loginAt && s.logoutAt)
    .filter((s) => includeSeeded || !s.seeded)
    .map((s) => ({ start: ts(s.loginAt), end: ts(s.logoutAt) }))
    .filter((s) => s.start > 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

function hasClashes(mainHistory, other) {
  let i = 0;
  let j = 0;
  while (i < mainHistory.length && j < other.length) {
    const mi = mainHistory[i];
    const oj = other[j];

    if (oj.start < mi.end && mi.start < oj.end) return true;
    if (mi.end < oj.end) i += 1;
    else j += 1;
  }
  return false;
}

function countClashes(mainHistory, other) {
  let i = 0;
  let j = 0;
  let count = 0;
  while (i < mainHistory.length && j < other.length) {
    const mi = mainHistory[i];
    const oj = other[j];

    if (oj.start < mi.end && mi.start < oj.end) count += 1;
    if (mi.end < oj.end) i += 1;
    else j += 1;
  }
  return count;
}

function countAdjacencies(mainHistory, other, distanceSeconds) {
  const distanceMs = distanceSeconds * 1000;
  let count = 0;

  for (const m of mainHistory) {
    if (other.some((o) => {
      const diff = o.start - m.end;
      return diff >= 0 && diff <= distanceMs;
    })) count += 1;
  }

  for (const m of mainHistory) {
    if (other.some((o) => {
      const diff = m.start - o.end;
      return diff >= 0 && diff <= distanceMs;
    })) count += 1;
  }

  return count;
}

export async function getAdjacencyAltCandidates(characterName, options = {}) {
  const distanceSeconds = Number(options.distanceSeconds ?? TRACKER_TRANSITION_WINDOW_SECONDS);
  const includeClashes = Boolean(options.includeClashes ?? false);
  const minAdjacencies = Number(options.minAdjacencies ?? 1);
  const includeSeeded = Boolean(options.includeSeeded ?? false);

  const store = await ensureStore();
  const seedKey = normalize(characterName);
  const seed = store.characters?.[seedKey];
  if (!seed) return [];

  const mainHistory = getClosedSegments(seed, includeSeeded);
  if (!mainHistory.length) return [];

  const out = [];
  for (const [key, candidate] of Object.entries(store.characters || {})) {
    if (key === seedKey) continue;

    const candidateHistory = getClosedSegments(candidate, includeSeeded);
    if (!candidateHistory.length) continue;

    const clashes = includeClashes ? countClashes(mainHistory, candidateHistory) : (hasClashes(mainHistory, candidateHistory) ? -1 : 0);
    if (clashes !== 0 && !includeClashes) continue;

    const adjacencies = countAdjacencies(mainHistory, candidateHistory, distanceSeconds);
    if (adjacencies < minAdjacencies) continue;

    const pairPreview = buildTransitionPairs(seed, candidate, distanceSeconds, includeSeeded).pairs.slice(0, 5);

    out.push({
      name: candidate.name,
      world: candidate.world || "",
      adjacencies,
      clashes: Math.max(0, clashes),
      logins: candidateHistory.length,
      consistency: Math.min(1, adjacencies / Math.max(1, mainHistory.length)),
      examples: pairPreview,
      source: "tracker"
    });
  }

  return out.sort((a, b) => {
    if (b.adjacencies !== a.adjacencies) return b.adjacencies - a.adjacencies;
    return b.consistency - a.consistency;
  });
}

export async function getTransitionAltCandidates(characterName, options = {}) {
  const windowSeconds = Number(options.windowSeconds || TRACKER_TRANSITION_WINDOW_SECONDS);
  const minPairs = Number(options.minPairs || TRACKER_MIN_TRANSITION_PAIRS);
  const includeSeeded = Boolean(options.includeSeeded ?? false);

  const store = await ensureStore();
  const seedKey = normalize(characterName);
  const seed = store.characters?.[seedKey];
  if (!seed) return [];

  const out = [];
  for (const [key, candidate] of Object.entries(store.characters || {})) {
    if (key === seedKey) continue;

    const { pairs, seedLogoutCount, candidateLoginCount } = buildTransitionPairs(
      seed,
      candidate,
      windowSeconds,
      includeSeeded
    );
    if (pairs.length < minPairs) continue;

    const denominator = Math.max(1, Math.min(seedLogoutCount, candidateLoginCount));
    const consistency = Math.min(1, pairs.length / denominator);

    out.push({
      name: candidate.name,
      world: candidate.world || "",
      pairCount: pairs.length,
      consistency,
      examples: pairs.slice(0, 5),
      source: "tracker"
    });
  }

  return out.sort((a, b) => {
    if (b.pairCount !== a.pairCount) return b.pairCount - a.pairCount;
    return b.consistency - a.consistency;
  });
}

if (TRACKER_AUTOSTART && TRACKER_WORLDS.length) {
  startOnlineTracker({ worlds: TRACKER_WORLDS, intervalMs: TRACKER_POLL_INTERVAL_MS }).catch(() => {
    runtime.errors += 1;
  });
}
