import sampleData from "../../data/sample-data.json" with { type: "json" };

const TIBIADATA_API_BASE = process.env.TIBIADATA_API_BASE || "https://api.tibiadata.com/v4";
const ENABLE_LIVE = String(process.env.ENABLE_LIVE_SOURCES || "true").toLowerCase() !== "false";
const ENABLE_TIBIA_COM_NEWS = String(process.env.ENABLE_TIBIA_COM_NEWS || "false").toLowerCase() === "true";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 8000);
const EXEVOPAN_URL = process.env.EXEVOPAN_URL || "https://www.exevopan.com/";
const TIBIA_LATESTNEWS_URL = process.env.TIBIA_LATESTNEWS_URL || "https://www.tibia.com/news/?subtopic=latestnews";
const GUILDSTATS_TEST_NAME = String(process.env.GUILDSTATS_TEST_NAME || "").trim();
const TIBIAVIP_TEST_NAME = String(process.env.TIBIAVIP_TEST_NAME || "").trim();
const TIBIAVIP_CHARACTER_URL_TEMPLATE =
  process.env.TIBIAVIP_CHARACTER_URL_TEMPLATE ||
  "https://tibiavip.app/characters?status=2&name={name}&vocation=&levelMin=&levelMax=&world=";
const TIBIA_CHARACTER_URL_TEMPLATE =
  process.env.TIBIA_CHARACTER_URL_TEMPLATE ||
  "https://www.tibia.com/community/?subtopic=characters&name={name}";
const GUILDSTATS_EXP_URL_TEMPLATE =
  process.env.GUILDSTATS_EXP_URL_TEMPLATE ||
  "https://guildstats.eu/character?nick={name}&tab=9";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function encodeName(value) {
  return encodeURIComponent(String(value || "").trim());
}

function hhmmFromIso(value) {
  if (!value) return [];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return [];

  const base = d.getUTCHours() * 60 + d.getUTCMinutes();
  return [-4, 0, 4].map((offset) => {
    const total = (base + offset + 1440) % 1440;
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  });
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; tibia-intel/1.0)",
      "accept": "application/json,text/plain,*/*"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; tibia-intel/1.0)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function normalizeCharacter(raw, source = "unknown") {
  if (!raw?.name) return null;

  const guildName = typeof raw.guild === "string"
    ? raw.guild
    : raw.guild?.name || raw.guild_name || "";

  const lastLogin = raw.lastLogin || raw.last_login || raw.lastLoginDate || null;

  return {
    name: raw.name,
    world: raw.world || "",
    vocation: raw.vocation || "",
    level: Number(raw.level || 0),
    guild: guildName || "",
    lastLogin,
    loginPattern: Array.isArray(raw.loginPattern) ? raw.loginPattern : hhmmFromIso(lastLogin),
    tradeEvents: Array.isArray(raw.tradeEvents) ? raw.tradeEvents : [],
    transferEvents: Array.isArray(raw.transferEvents) ? raw.transferEvents : [],
    source
  };
}

function parseNumber(value) {
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^\d]/g, "");
  return cleaned ? Number(cleaned) : 0;
}

function uniqueByName(list) {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const key = normalize(item?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function extractCharacterRoot(payload) {
  return payload?.character?.character || payload?.characters?.character || payload?.character || null;
}

function extractGuildRoot(payload) {
  return payload?.guild?.guild || payload?.guilds?.guild || payload?.guild || null;
}

function extractWorldRoot(payload) {
  return payload?.world?.world || payload?.worlds?.world || payload?.world || null;
}

function extractTibiaComDeaths(html) {
  const lower = html.toLowerCase();
  const idx = lower.indexOf("deaths");
  if (idx === -1) return 0;
  const snippet = html.slice(Math.max(0, idx - 1200), Math.min(html.length, idx + 1200));
  const match = snippet.match(/Deaths[^0-9]{0,20}(\d{1,5})/i);
  return match ? Number(match[1]) : 0;
}

function extractTibiaComHouses(html) {
  const lower = html.toLowerCase();
  const idx = lower.indexOf("house");
  if (idx === -1) return 0;
  const snippet = html.slice(Math.max(0, idx - 1200), Math.min(html.length, idx + 1200));
  const match = snippet.match(/house[^0-9]{0,20}(\d{1,3})/i);
  if (match) return Number(match[1]);
  if (snippet.toLowerCase().includes("no house")) return 0;
  return 0;
}

async function fetchTibiaComCharacter(name) {
  const url = TIBIA_CHARACTER_URL_TEMPLATE.replace("{name}", encodeName(name));
  const html = await fetchText(url);
  if (!html) return null;

  const lower = html.toLowerCase();
  const nameFound = lower.includes(normalize(name));
  if (!nameFound) return null;

  const levelMatch = html.match(/Level[^0-9]{0,10}(\d{1,5})/i);
  const vocationMatch = html.match(/Vocation[^A-Za-z]{0,10}([A-Za-z ]{3,30})/i);
  const worldMatch = html.match(/World[^A-Za-z0-9]{0,10}([A-Z][A-Za-z]+)/i);
  const guildMatch = html.match(/Guild[^A-Za-z0-9]{0,20}([^<\n\r]{3,60})/i);

  return {
    name,
    world: worldMatch?.[1] || "",
    vocation: vocationMatch?.[1]?.trim() || "",
    level: levelMatch ? Number(levelMatch[1]) : 0,
    guild: guildMatch?.[1]?.replace(/&nbsp;|<[^>]+>/g, "").trim() || "",
    houses: extractTibiaComHouses(html),
    deaths: extractTibiaComDeaths(html),
    source: "tibia.com"
  };
}

async function fetchGuildstatsHuntingExp(name) {
  const url = GUILDSTATS_EXP_URL_TEMPLATE.replace("{name}", encodeName(name));
  const html = await fetchText(url);
  if (!html) return null;

  const lower = html.toLowerCase();
  if (!lower.includes(normalize(name))) return null;

  const match = html.match(/Hunting\s*Exp[^0-9]{0,20}([\d,\.]+)/i);
  const exp = match ? parseNumber(match[1]) : 0;
  return { huntingExp: exp, source: "guildstats.eu" };
}

function extractTibiaVipVocation(snippet) {
  const vocations = [
    "Elite Knight",
    "Royal Paladin",
    "Elder Druid",
    "Master Sorcerer",
    "Knight",
    "Paladin",
    "Druid",
    "Sorcerer"
  ];
  const lower = snippet.toLowerCase();
  for (const v of vocations) {
    if (lower.includes(v.toLowerCase())) return v;
  }
  return "";
}

function extractTibiaVipWorld(snippet) {
  const worldMatch = snippet.match(/World[^A-Za-z0-9]{0,20}([A-Z][A-Za-z]+)/i);
  return worldMatch?.[1] || "";
}

function extractTibiaVipLevel(snippet) {
  const labelMatch = snippet.match(/Level[^0-9]{0,10}(\d{1,5})/i);
  if (labelMatch) return Number(labelMatch[1]);
  const plainMatch = snippet.match(/>\\s*(\\d{1,5})\\s*</);
  return plainMatch ? Number(plainMatch[1]) : 0;
}

async function fetchTibiaVipCharacter(name) {
  const url = TIBIAVIP_CHARACTER_URL_TEMPLATE.replace("{name}", encodeName(name));
  const html = await fetchText(url);
  if (!html) return null;

  const lowerHtml = html.toLowerCase();
  const lowerName = normalize(name);
  const idx = lowerHtml.indexOf(lowerName);
  if (idx === -1) return null;

  const snippet = html.slice(Math.max(0, idx - 800), Math.min(html.length, idx + 800));
  const level = extractTibiaVipLevel(snippet);
  const vocation = extractTibiaVipVocation(snippet);
  const world = extractTibiaVipWorld(snippet);

  return normalizeCharacter({
    name,
    world,
    level,
    vocation
  }, "tibiavip");
}

async function fetchTibiaDataCharacter(name) {
  const url = `${TIBIADATA_API_BASE}/character/${encodeName(name)}`;
  const payload = await fetchJson(url);
  const character = extractCharacterRoot(payload);
  return normalizeCharacter(character, "tibiadata");
}

async function fetchTibiaDataGuildMembers(guildName) {
  const url = `${TIBIADATA_API_BASE}/guild/${encodeName(guildName)}`;
  const payload = await fetchJson(url);
  const guild = extractGuildRoot(payload);
  const members = guild?.members || [];

  return members
    .map((m) => normalizeCharacter({ ...m, world: guild?.world || m.world }, "tibiadata"))
    .filter(Boolean);
}

async function fetchTibiaDataWorldOnline(worldName) {
  const url = `${TIBIADATA_API_BASE}/world/${encodeName(worldName)}`;
  const payload = await fetchJson(url);
  const world = extractWorldRoot(payload);
  const online = world?.online_players || world?.onlinePlayers || [];

  return online
    .map((p) => normalizeCharacter({ ...p, world: world?.name || p.world }, "tibiadata"))
    .filter(Boolean);
}

function parseDateCandidates(html) {
  const matches = html.match(/\b20\d{2}[./-](?:0[1-9]|1[0-2])[./-](?:0[1-9]|[12]\d|3[01])\b/g) || [];
  return [...new Set(matches.map((x) => x.replaceAll("/", "-").replaceAll(".", "-")))];
}

function dedupeEvents(events, keyBuilder) {
  const seen = new Set();
  return events.filter((item) => {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseExevopanAuctions(html) {
  const links = [...html.matchAll(/community\/\?subtopic=characters&name=([^"&]+)/gi)];
  const out = [];
  const seen = new Set();

  for (const match of links) {
    const raw = match[1] || "";
    const name = decodeURIComponent(raw).replaceAll("+", " ").trim();
    if (!name) continue;
    const key = normalize(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const snippet = html.slice(Math.max(0, match.index - 600), Math.min(html.length, match.index + 600));
    const levelMatch = snippet.match(/Level\s+(\d+)\s*-\s*([A-Za-z ]{3,40})/i);
    const worldMatch = snippet.match(/Server[^A-Za-z0-9]{0,20}([A-Z][A-Za-z]+)/i);
    const auctionEndMatch = snippet.match(/Auction end\s*([^<\n\r]{3,40})/i);

    out.push({
      name,
      level: levelMatch ? Number(levelMatch[1]) : null,
      vocation: levelMatch?.[2]?.trim() || null,
      world: worldMatch?.[1] || null,
      auctionEnd: auctionEndMatch?.[1]?.trim() || null
    });
  }

  return out;
}

function normalizeNewsItems(items, source) {
  return (items || [])
    .map((item) => ({
      title: String(item.title || item.headline || item.name || "").trim(),
      date: String(item.date || item.published_at || item.news || "").trim(),
      category: String(item.category || "").trim(),
      source
    }))
    .filter((item) => item.title || item.date);
}

async function fetchTibiaDataLatestNews() {
  const payload = await fetchJson(`${TIBIADATA_API_BASE}/news/latest`);
  const items = payload?.news?.news || payload?.news || payload?.data?.news || [];
  return normalizeNewsItems(items, "tibiadata");
}

async function fetchTibiaComLatestNews() {
  const html = await fetchText(TIBIA_LATESTNEWS_URL);
  if (!html) return [];

  const titles = [...html.matchAll(/subtopic=newsarchive[^>]*>([^<]+)</gi)].map((m) => m[1]?.trim()).filter(Boolean);
  const dates = parseDateCandidates(html);
  const items = titles.slice(0, 25).map((title, idx) => ({
    title,
    date: dates[idx] || "",
    source: "tibia.com"
  }));

  return normalizeNewsItems(items, "tibia.com");
}

async function checkSource(name, url, runner) {
  const started = Date.now();
  try {
    const details = await runner();
    return {
      name,
      url,
      status: "ok",
      latencyMs: Date.now() - started,
      details
    };
  } catch (error) {
    return {
      name,
      url,
      status: "error",
      latencyMs: Date.now() - started,
      error: error?.message || "unknown error"
    };
  }
}

async function scrapeTradeSignals(characterName) {
  const templateUrls = [
    process.env.GUILDSTATS_CHARACTER_URL_TEMPLATE || "https://guildstats.eu/character?nick={name}",
    process.env.TIBIAVIP_CHARACTER_URL_TEMPLATE || TIBIAVIP_CHARACTER_URL_TEMPLATE,
    process.env.EXEVOPAN_CHARACTER_URL_TEMPLATE,
    process.env.TIBIA_CHARACTER_URL_TEMPLATE || TIBIA_CHARACTER_URL_TEMPLATE
  ].filter(Boolean);

  const transfers = [];
  const traded = [];
  const lowerCharacter = normalize(characterName);

  for (const template of templateUrls) {
    const url = template.replace("{name}", encodeName(characterName));
    try {
      const html = await fetchText(url);
      if (!html) continue;

      const lower = html.toLowerCase();
      const dates = parseDateCandidates(html);
      const source = url.includes("guildstats") ? "guildstats.eu"
        : url.includes("tibia.com") ? "tibia.com"
        : url.includes("exevopan") ? "exevopan"
        : "custom";

      if (lower.includes("transfer")) {
        for (const date of dates.slice(0, 8)) {
          transfers.push({ date, from: "unknown", to: "unknown", source });
        }
      }

      if (lower.includes("bazaar") || lower.includes("auction") || lower.includes("traded") || lower.includes("sold")) {
        for (const date of dates.slice(0, 8)) {
          traded.push({ date, type: "bazaar_sold", source });
        }
      }
    } catch {
      // Ignore transient source failures so the search can continue.
    }
  }

  try {
    const exevopanHtml = await fetchText(EXEVOPAN_URL);
    if (exevopanHtml) {
      const auctions = parseExevopanAuctions(exevopanHtml);
      const match = auctions.find((x) => normalize(x.name) === lowerCharacter);
      if (match) {
        traded.push({
          date: new Date().toISOString().slice(0, 10),
          type: "bazaar_listed",
          source: "exevopan"
        });
      }
    }
  } catch {
    // Keep processing with the remaining sources.
  }

  try {
    const [tibiaDataNews, tibiaComNews] = await Promise.allSettled([
      fetchTibiaDataLatestNews(),
      fetchTibiaComLatestNews()
    ]);

    const news = [
      ...(tibiaDataNews.status === "fulfilled" ? tibiaDataNews.value : []),
      ...(tibiaComNews.status === "fulfilled" ? tibiaComNews.value : [])
    ];

    const matchingNews = news.filter((item) => {
      const haystack = `${item.title} ${item.category}`.toLowerCase();
      return haystack.includes(lowerCharacter) && /(bazaar|auction|trade)/i.test(haystack);
    });

    for (const item of matchingNews.slice(0, 5)) {
      traded.push({
        date: item.date || new Date().toISOString().slice(0, 10),
        type: "news_trade_reference",
        source: item.source
      });
    }
  } catch {
    // News source processing is optional for trade signal enrichment.
  }

  return {
    traded: dedupeEvents(traded, (x) => `${x.source}|${x.date}|${x.type}`),
    transfers: dedupeEvents(transfers, (x) => `${x.source}|${x.date}|${x.from}|${x.to}`)
  };
}

export async function getCharacters() {
  return sampleData.map((row) => normalizeCharacter(row, "sample")).filter(Boolean);
}

export async function getCharacterProfile(characterName) {
  const sampleMatch = sampleData
    .map((row) => normalizeCharacter(row, "sample"))
    .find((c) => normalize(c?.name) === normalize(characterName));

  if (!ENABLE_LIVE) return sampleMatch || null;

  try {
    const live = await fetchTibiaDataCharacter(characterName);
    if (live) {
      const merged = {
        ...sampleMatch,
        ...live,
        tradeEvents: sampleMatch?.tradeEvents || [],
        transferEvents: sampleMatch?.transferEvents || []
      };

      return normalizeCharacter(merged, sampleMatch ? "tibiadata+sample" : "tibiadata");
    }
  } catch {
    // ignore and try other sources
  }

  try {
    const vip = await fetchTibiaVipCharacter(characterName);
    if (vip) return normalizeCharacter({ ...sampleMatch, ...vip }, "tibiavip");
  } catch {
    // ignore
  }

  try {
    const tibiaCom = await fetchTibiaComCharacter(characterName);
    if (tibiaCom) return normalizeCharacter({ ...sampleMatch, ...tibiaCom }, "tibia.com");
  } catch {
    // ignore
  }

  return sampleMatch || null;
}

export async function getGuildMembers(guildName) {
  const sampleMatches = sampleData
    .map((row) => normalizeCharacter(row, "sample"))
    .filter((c) => normalize(c?.guild).includes(normalize(guildName)));

  if (!ENABLE_LIVE) return sampleMatches;

  try {
    const live = await fetchTibiaDataGuildMembers(guildName);
    return uniqueByName([...live, ...sampleMatches]);
  } catch {
    return sampleMatches;
  }
}

export async function getAltCandidatePool(seedCharacter) {
  const sampleCandidates = sampleData.map((row) => normalizeCharacter(row, "sample")).filter(Boolean);

  if (!ENABLE_LIVE) return uniqueByName(sampleCandidates);

  const tasks = [];
  if (seedCharacter?.guild) tasks.push(fetchTibiaDataGuildMembers(seedCharacter.guild));
  if (seedCharacter?.world) tasks.push(fetchTibiaDataWorldOnline(seedCharacter.world));

  try {
    const results = await Promise.allSettled(tasks);
    const liveCandidates = results
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => r.value);

    return uniqueByName([...liveCandidates, ...sampleCandidates]);
  } catch {
    return uniqueByName(sampleCandidates);
  }
}

export async function getTradeAndTransferSignals(characterName) {
  const sampleMatch = sampleData
    .map((row) => normalizeCharacter(row, "sample"))
    .find((c) => normalize(c?.name) === normalize(characterName));

  const sampleSignals = {
    traded: sampleMatch?.tradeEvents || [],
    transfers: sampleMatch?.transferEvents || []
  };

  if (!ENABLE_LIVE) return sampleSignals;

  try {
    const liveSignals = await scrapeTradeSignals(characterName);
    return {
      traded: dedupeEvents([...liveSignals.traded, ...sampleSignals.traded], (x) => `${x.source}|${x.date}|${x.type || ""}`),
      transfers: dedupeEvents([...liveSignals.transfers, ...sampleSignals.transfers], (x) => `${x.source}|${x.date}|${x.from || ""}|${x.to || ""}`)
    };
  } catch {
    return sampleSignals;
  }
}

export async function getExtraCharacterSignals(characterName) {
  if (!ENABLE_LIVE) {
    return { houses: 0, deaths: 0, huntingExp: 0 };
  }

  const [tibiaComResult, guildstatsResult] = await Promise.allSettled([
    fetchTibiaComCharacter(characterName),
    fetchGuildstatsHuntingExp(characterName)
  ]);

  const tibiaCom = tibiaComResult.status === "fulfilled" ? tibiaComResult.value : null;
  const guildstats = guildstatsResult.status === "fulfilled" ? guildstatsResult.value : null;

  return {
    houses: tibiaCom?.houses || 0,
    deaths: tibiaCom?.deaths || 0,
    huntingExp: guildstats?.huntingExp || 0
  };
}

export async function getSourceStatus() {
  const checks = [
    checkSource("tibiadata", `${TIBIADATA_API_BASE}/news/latest`, async () => {
      const news = await fetchTibiaDataLatestNews();
      return { items: news.length };
    }),
    checkSource("exevopan", EXEVOPAN_URL, async () => {
      const html = await fetchText(EXEVOPAN_URL);
      if (!html) throw new Error("no response body");
      const auctions = parseExevopanAuctions(html);
      return { auctionMentions: auctions.length };
    })
  ];

  if (ENABLE_TIBIA_COM_NEWS) {
    checks.splice(1, 0, checkSource("tibia.com", TIBIA_LATESTNEWS_URL, async () => {
      const news = await fetchTibiaComLatestNews();
      return { items: news.length };
    }));
  }

  if (GUILDSTATS_TEST_NAME) {
    const template = process.env.GUILDSTATS_CHARACTER_URL_TEMPLATE || "https://guildstats.eu/character?nick={name}";
    const url = template.replace("{name}", encodeName(GUILDSTATS_TEST_NAME));
    checks.push(checkSource("guildstats.eu", url, async () => {
      const html = await fetchText(url);
      if (!html) throw new Error("no response body");
      const nameFound = html.toLowerCase().includes(GUILDSTATS_TEST_NAME.toLowerCase());
      return { testName: GUILDSTATS_TEST_NAME, nameFound };
    }));
  }

  if (TIBIAVIP_TEST_NAME) {
    const url = TIBIAVIP_CHARACTER_URL_TEMPLATE.replace("{name}", encodeName(TIBIAVIP_TEST_NAME));
    checks.push(checkSource("tibiavip.app", url, async () => {
      const html = await fetchText(url);
      if (!html) throw new Error("no response body");
      const nameFound = html.toLowerCase().includes(TIBIAVIP_TEST_NAME.toLowerCase());
      return { testName: TIBIAVIP_TEST_NAME, nameFound };
    }));
  }

  const results = await Promise.all(checks);

  return {
    checkedAt: new Date().toISOString(),
    liveEnabled: ENABLE_LIVE,
    sources: results
  };
}
