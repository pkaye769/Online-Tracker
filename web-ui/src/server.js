import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookupAltCandidates, lookupGuild, lookupTraded } from "./services/search-service.js";
import { getCharacterProfile, getExtraCharacterSignals, getSourceStatus } from "./services/providers.js";
import {
  getAdjacencyAltCandidates,
  getOnlineStatus,
  getTrackerStatus,
  startOnlineTracker,
  stopOnlineTracker
} from "./services/online-tracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "online-tracker-web-ui" });
});

app.get("/api/search/alt", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const mode = String(req.query.mode || "balanced").trim().toLowerCase();
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter: q" });
  }

  const result = await lookupAltCandidates(query, { mode });
  return res.json(result);
});

app.get("/api/search/guild", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ error: "Missing query parameter: q" });
  }

  const result = await lookupGuild(query);
  return res.json(result);
});

app.get("/api/search/traded", async (req, res) => {
  const character = String(req.query.character || "").trim();
  if (!character) {
    return res.status(400).json({ error: "Missing query parameter: character" });
  }

  const result = await lookupTraded(character);
  return res.json(result);
});

app.get("/api/character", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Missing query parameter: name" });
  }

  const profile = await getCharacterProfile(name);
  if (!profile) {
    return res.status(404).json({ found: false, message: "Character not found." });
  }

  const extra = await getExtraCharacterSignals(profile.name);
  return res.json({
    found: true,
    character: profile,
    extra
  });
});

app.get("/api/online", async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Missing query parameter: name" });
  }

  const status = await getOnlineStatus(name);
  return res.json({ query: name, ...status });
});

app.get("/api/sources", async (_req, res) => {
  const result = await getSourceStatus();
  return res.json(result);
});

app.get("/api/tracker/status", (_req, res) => {
  return res.json(getTrackerStatus());
});

app.post("/api/tracker/start", async (req, res) => {
  const worlds = Array.isArray(req.body?.worlds) ? req.body.worlds : undefined;
  const intervalMs = req.body?.intervalMs;

  try {
    const result = await startOnlineTracker({ worlds, intervalMs });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Failed to start tracker" });
  }
});

app.post("/api/tracker/stop", (_req, res) => {
  return res.json(stopOnlineTracker());
});

app.get("/api/tracker/alternates", async (req, res) => {
  const character = String(req.query.character || "").trim();
  const windowSeconds = Number(req.query.windowSeconds || process.env.TRACKER_TRANSITION_WINDOW_SECONDS || 180);
  const minPairs = Number(req.query.minPairs || process.env.TRACKER_MIN_TRANSITION_PAIRS || 2);
  const includeClashes = String(req.query.includeClashes || "false").toLowerCase() === "true";

  if (!character) {
    return res.status(400).json({ error: "Missing query parameter: character" });
  }

  const candidates = await getAdjacencyAltCandidates(character, {
    distanceSeconds: windowSeconds,
    minAdjacencies: minPairs,
    includeClashes
  });
  return res.json({
    query: character,
    windowSeconds,
    minPairs,
    includeClashes,
    method: "adjacency-with-clash-filter",
    candidates
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
