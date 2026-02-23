import {
  getAltCandidatePool,
  getCharacterProfile,
  getExtraCharacterSignals,
  getGuildMembers,
  getTradeAndTransferSignals
} from "./providers.js";
import { getAdjacencyAltCandidates, getTrackedCharacters, getTransitionAltCandidates } from "./online-tracker.js";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function minutesFromHHMM(value) {
  const [hh, mm] = value.split(":").map(Number);
  return hh * 60 + mm;
}

function closestLoginDelta(patternA, patternB) {
  if (!patternA.length || !patternB.length) return 999;

  let minDelta = 999;
  for (const a of patternA) {
    for (const b of patternB) {
      const delta = Math.abs(minutesFromHHMM(a) - minutesFromHHMM(b));
      if (delta < minDelta) minDelta = delta;
    }
  }

  return minDelta;
}

function dateToTs(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function latestTradeDate(character) {
  const allDates = [
    ...(character.tradeEvents || []).map((x) => x.date),
    ...(character.transferEvents || []).map((x) => x.date)
  ].filter(Boolean);

  if (!allDates.length) return null;
  return allDates.sort((a, b) => dateToTs(b) - dateToTs(a))[0] || null;
}

function altScore(seed, candidate) {
  let score = 0;
  const reasons = [];
  const signals = {
    world: false,
    guild: false,
    login: false,
    tradePeriod: false,
    tracker: false,
    trackerPairs: false
  };

  if (seed.world && seed.world === candidate.world) {
    score += 25;
    reasons.push("same world");
    signals.world = true;
  }

  if (seed.guild && seed.guild === candidate.guild) {
    score += 20;
    reasons.push("same guild");
    signals.guild = true;
  }

  const loginDelta = closestLoginDelta(seed.loginPattern || [], candidate.loginPattern || []);
  if (loginDelta <= 3) {
    score += 30;
    reasons.push(`login windows overlap (${loginDelta}m)`);
    signals.login = true;
  } else if (loginDelta <= 8) {
    score += 15;
    reasons.push(`similar login windows (${loginDelta}m)`);
    signals.login = true;
  }

  const seedTrade = latestTradeDate(seed);
  const candidateTrade = latestTradeDate(candidate);
  if (seedTrade && candidateTrade && Math.abs(dateToTs(seedTrade) - dateToTs(candidateTrade)) <= 1000 * 60 * 60 * 24 * 10) {
    score += 25;
    reasons.push("trade/transfer period matches");
    signals.tradePeriod = true;
  }

  const trackerAdjacencies = Number(candidate?.trackerAdjacencies || 0);
  const trackerClashes = Number(candidate?.trackerClashes || 0);
  const trackerConsistency = Number(candidate?.trackerConsistency || 0);
  const trackerPairCount = Number(candidate?.trackerPairCount || 0);
  const trackerPairConsistency = Number(candidate?.trackerPairConsistency || 0);

  if (trackerAdjacencies > 0) {
    const trackerBoost = Math.min(40, trackerAdjacencies * 4 + Math.round(trackerConsistency * 10));
    score += trackerBoost;
    reasons.push(`adjacency matches (${trackerAdjacencies} adjacencies, ${trackerClashes} clashes, ${(trackerConsistency * 100).toFixed(0)}% consistency)`);
    signals.tracker = true;
  }

  if (trackerClashes > 0) {
    const clashPenalty = Math.min(35, trackerClashes * 6);
    score -= clashPenalty;
    reasons.push(`clash penalty (${trackerClashes} clashes)`);
  }

  if (trackerPairCount > 0) {
    const pairBoost = Math.min(30, trackerPairCount * 6 + Math.round(trackerPairConsistency * 15));
    score += pairBoost;
    reasons.push(`transition pairs (${trackerPairCount} pairs, ${(trackerPairConsistency * 100).toFixed(0)}% consistency)`);
    signals.trackerPairs = true;
  }

  if (!reasons.length) reasons.push("weak match: limited shared signals");

  return {
    score: Math.max(0, Math.min(score, 100)),
    reasons,
    signals
  };
}

function isEligibleAlt(signals, score, trackerAdjacencies, trackerClashes, mode = "balanced") {
  const hasBehavioralSignal = signals.login || signals.tradePeriod || signals.tracker;
  const hasContextSignal = signals.world || signals.guild;
  const strictScore = score >= 55;
  const balancedScore = score >= 45;
  const strictTracker = trackerAdjacencies >= 2 && trackerClashes <= 1;
  const balancedTracker = trackerAdjacencies >= 1 && trackerClashes <= 2;

  if (mode === "strict") return strictTracker || (strictScore && hasBehavioralSignal && hasContextSignal);
  if (mode === "relaxed") return score >= 20 || trackerAdjacencies >= 1;
  return balancedTracker || (balancedScore && hasBehavioralSignal);
}

function confidenceLabel(confidence) {
  if (confidence >= 70) return "high";
  if (confidence >= 40) return "medium";
  return "low";
}

export async function lookupAltCandidates(characterName, options = {}) {
  const mode = String(options.mode || "balanced").toLowerCase();
  const trackedCharacters = await getTrackedCharacters();
  let seed = await getCharacterProfile(characterName);

  if (!seed) {
    const trackedSeed = trackedCharacters.find((c) => normalize(c.name) === normalize(characterName));
    if (trackedSeed) {
      seed = {
        name: trackedSeed.name,
        world: trackedSeed.world || "",
        guild: "",
        level: 0,
        vocation: "Unknown",
        lastLogin: trackedSeed.lastSeenAt || null,
        loginPattern: [],
        tradeEvents: [],
        transferEvents: [],
        source: "tracker-only"
      };
    }
  }

  if (!seed) {
    return {
      query: characterName,
      found: false,
      message: "Character not found in current index, live provider, or tracker storage.",
      candidates: []
    };
  }

  const trackedSeed = trackedCharacters.find((c) => normalize(c.name) === normalize(seed.name));
  const seedLoginSegments = (trackedSeed?.sessions || []).filter((s) => s?.loginAt && s?.logoutAt).length;
  const minAdjacencies = seedLoginSegments >= 10 ? 2 : 1;
  const distanceSeconds = Number(process.env.TRACKER_TRANSITION_WINDOW_SECONDS || 180);
  const minPairs = Number(process.env.TRACKER_MIN_TRANSITION_PAIRS || 2);

  const [seedSignals, candidatePool, trackerMatches, trackerPairs] = await Promise.all([
    getTradeAndTransferSignals(seed.name),
    getAltCandidatePool(seed),
    getAdjacencyAltCandidates(seed.name, {
      distanceSeconds,
      includeClashes: true,
      minAdjacencies
    }),
    getTransitionAltCandidates(seed.name, {
      windowSeconds: distanceSeconds,
      minPairs
    })
  ]);

  const enrichedSeed = {
    ...seed,
    tradeEvents: seedSignals.traded,
    transferEvents: seedSignals.transfers
  };

  const trackerByName = new Map(trackerMatches.map((m) => [normalize(m.name), m]));
  const trackerPairsByName = new Map(trackerPairs.map((m) => [normalize(m.name), m]));

  const trackerOnlyCandidates = trackedCharacters
    .filter((c) => normalize(c.name) !== normalize(seed.name))
    .filter((c) => trackerByName.has(normalize(c.name)))
    .map((c) => ({
      name: c.name,
      world: c.world || seed.world || "",
      level: 0,
      vocation: "Unknown",
      guild: "",
      loginPattern: [],
      tradeEvents: [],
      transferEvents: [],
      source: "tracker"
    }));

  const unionByName = new Map();
  for (const item of [...candidatePool, ...trackerOnlyCandidates]) {
    const key = normalize(item.name);
    if (!key || unionByName.has(key)) continue;
    unionByName.set(key, item);
  }

  const rankedCandidates = [...unionByName.values()]
    .filter((c) => normalize(c.name) !== normalize(seed.name))
    .map((candidate) => {
      const tracker = trackerByName.get(normalize(candidate.name));
      const pairInfo = trackerPairsByName.get(normalize(candidate.name));
      const trackerAdjacencies = tracker?.adjacencies || 0;
      const candidateForScoring = {
        ...candidate,
        trackerAdjacencies,
        trackerClashes: tracker?.clashes || 0,
        trackerConsistency: tracker?.consistency || 0,
        trackerPairCount: pairInfo?.pairCount || 0,
        trackerPairConsistency: pairInfo?.consistency || 0
      };

      const { score, reasons, signals } = altScore(enrichedSeed, candidateForScoring);

      return {
        name: candidate.name,
        world: candidate.world,
        level: candidate.level,
        vocation: candidate.vocation,
        guild: candidate.guild,
        confidence: score,
        source: candidate.source || "unknown",
        reasons,
        transitions: tracker?.examples || [],
        adjacencies: trackerAdjacencies,
        clashes: tracker?.clashes || 0,
        eligible: isEligibleAlt(signals, score, trackerAdjacencies, tracker?.clashes || 0, mode)
      };
    })
    .sort((a, b) => {
      if (b.adjacencies !== a.adjacencies) return b.adjacencies - a.adjacencies;
      if (a.clashes !== b.clashes) return a.clashes - b.clashes;
      return b.confidence - a.confidence;
    });

  const strictSelected = rankedCandidates.filter((c) => c.eligible && c.clashes <= 1);
  const balancedSelected = rankedCandidates.filter((c) => c.eligible);
  const relaxedSelected = rankedCandidates.filter((c) => c.confidence >= 20 || c.adjacencies >= 1);
  const fallbackSelected = rankedCandidates.filter((c) => c.confidence >= 25);

  const addUniqueByName = (acc, list) => {
    for (const item of list) {
      const key = normalize(item.name);
      if (!key || acc.has(key)) continue;
      acc.set(key, item);
    }
  };

  let selectedPool = mode === "strict"
    ? strictSelected
    : mode === "relaxed"
      ? relaxedSelected
      : balancedSelected;

  if (mode === "best") {
    const bestPool = new Map();
    addUniqueByName(bestPool, strictSelected);
    addUniqueByName(bestPool, balancedSelected);
    addUniqueByName(bestPool, relaxedSelected);
    addUniqueByName(bestPool, fallbackSelected);
    selectedPool = [...bestPool.values()];
  }

  if (!selectedPool.length) selectedPool = fallbackSelected;

  const selectedCandidates = selectedPool
    .map(({ eligible, ...rest }) => rest)
    .map((candidate) => ({
      ...candidate,
      confidenceLabel: confidenceLabel(candidate.confidence)
    }))
    .slice(0, 5);

  const extraSignals = await Promise.all(
    selectedCandidates.map(async (candidate) => {
      const extra = await getExtraCharacterSignals(candidate.name);
      return { name: candidate.name, ...extra };
    })
  );

  const extraByName = new Map(extraSignals.map((e) => [normalize(e.name), e]));

  const withExtras = selectedCandidates.map((candidate) => {
    const extra = extraByName.get(normalize(candidate.name)) || {};
    return {
      ...candidate,
      houses: extra.houses || 0,
      deaths: extra.deaths || 0,
      huntingExp: extra.huntingExp || 0
    };
  });

  const sortedCandidates = withExtras.sort((a, b) => {
    if ((b.houses || 0) !== (a.houses || 0)) return (b.houses || 0) - (a.houses || 0);
    if ((b.huntingExp || 0) !== (a.huntingExp || 0)) return (b.huntingExp || 0) - (a.huntingExp || 0);
    if ((b.deaths || 0) !== (a.deaths || 0)) return (b.deaths || 0) - (a.deaths || 0);
    if ((b.guild || "") !== (a.guild || "")) return (b.guild || "").localeCompare(a.guild || "");
    return b.confidence - a.confidence;
  });

  return {
    query: characterName,
    found: true,
    seed: {
      name: seed.name,
      world: seed.world,
      guild: seed.guild,
      lastLogin: seed.lastLogin,
      source: seed.source || "unknown"
    },
    tracker: {
      candidateCount: trackerMatches.length,
      minPairs,
      windowSeconds: distanceSeconds,
      includeClashes: true,
      seedLoginSegments,
      method: mode === "strict"
        ? "strict-scoring"
        : mode === "relaxed"
          ? "relaxed-scoring"
          : mode === "best"
            ? "best-combined"
          : strictSelected.length
            ? "adjacency-with-clash-filter"
            : "relaxed-scoring-fallback"
    },
    mode,
    candidates: sortedCandidates.map((candidate) => {
      const tracker = trackerByName.get(normalize(candidate.name));
      const pairInfo = trackerPairsByName.get(normalize(candidate.name));
      return {
        ...candidate,
        logins: Number(tracker?.logins || candidate?.transitions?.length || 0),
        transitionPairs: pairInfo?.pairCount || 0,
        transitionConsistency: pairInfo?.consistency || 0
      };
    })
  };
}

export async function lookupGuild(guildName) {
  const members = (await getGuildMembers(guildName))
    .sort((a, b) => b.level - a.level)
    .map((c) => ({
      name: c.name,
      world: c.world,
      vocation: c.vocation,
      level: c.level,
      lastLogin: c.lastLogin,
      source: c.source || "unknown"
    }));

  return {
    query: guildName,
    members,
    count: members.length
  };
}

export async function lookupTraded(characterName) {
  const [char, signals] = await Promise.all([
    getCharacterProfile(characterName),
    getTradeAndTransferSignals(characterName)
  ]);

  const traded = (signals.traded || []).sort((a, b) => dateToTs(b.date) - dateToTs(a.date));
  const transfers = (signals.transfers || []).sort((a, b) => dateToTs(b.date) - dateToTs(a.date));

  if (!char && !traded.length && !transfers.length) {
    return {
      query: characterName,
      found: false,
      message: "No trade or transfer signals found for this character."
    };
  }

  return {
    query: characterName,
    found: true,
    character: {
      name: char?.name || characterName,
      world: char?.world || "",
      level: char?.level || 0,
      vocation: char?.vocation || "Unknown",
      source: char?.source || "signal-only"
    },
    lastTradedAt: traded[0]?.date || null,
    lastTransferredAt: transfers[0]?.date || null,
    traded,
    transfers
  };
}



