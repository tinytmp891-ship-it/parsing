import {
  ageGroupOf,
  eventAgeGroup,
  INDIVIDUAL_SPORTS,
  normalizeName,
  SOURCE_IDS,
  sportKeyFromText,
  teamSimilarity,
  type LocalizedText,
  type NormalizedEvent,
  type SourceId,
} from "./model";

/**
 * Checks pasted match lines against the stored schedule.
 *
 * A line looks like: "Team A - Team B    Sport.Country. League    770943807"
 * - the trailing number, when present, is a bookmaker event ID (a bonus when it matches a 1xBet event)
 * - both team names are compared with every event that starts within the next 24 hours
 *   (English and Russian names, either order)
 * - the stated sport is searched first; if nothing matches there, all sports are searched
 * - individual sports also match participant names written with initials (e.g. "J. Sinner" vs "Jannik Sinner")
 *
 * green  = both teams match a scheduled match
 * yellow = exactly one team matches
 * red    = no scheduled match in the window shares a team name
 */

export const MAX_CHECK_LINES = 100;
/** Only matches that start within this window are checked. */
export const CHECK_WINDOW_MS = 24 * 3600_000;

const SIDE_THRESHOLD = 0.8;
const SIBLING_TIME_MS = 10 * 60_000;
const ID_BONUS = 0.1;
const PREFIX_LENGTH = 3;
const RANK = { green: 3, yellow: 2, red: 1, invalid: 0 } as const;

export type CheckStatus = "green" | "yellow" | "red" | "invalid";

export type ParsedLine = {
  home: string;
  away: string;
  sportText: string;
  sportKey: string | null;
  league: string | null;
  externalId: string | null;
};

export type CheckResult = ParsedLine & {
  index: number;
  raw: string;
  status: CheckStatus;
  homeMatched: boolean;
  awayMatched: boolean;
  homeScore: number;
  awayScore: number;
  match: {
    id: string;
    startsAt: string;
    sportKey: string;
    sportName: LocalizedText;
    leagueName: LocalizedText;
    home: LocalizedText;
    away: LocalizedText;
    sources: string[];
    idMatched: boolean;
  } | null;
};

export function parseMatchLine(raw: string): ParsedLine {
  const original = raw.trim();
  let body = original;
  let externalId: string | null = null;

  const idMatch = original.match(/(\d{6,})\s*$/);
  if (idMatch && idMatch.index !== undefined) {
    externalId = idMatch[1];
    body = original.slice(0, idMatch.index).trim();
  }

  // Columns in the pasted text are separated by two or more spaces (or tabs).
  const parts = body
    .split(/\s{2,}|\t+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const teams = (parts[0] ?? "")
    .split(/\s+[-–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const home = teams[0] ?? "";
  const away = teams.length > 1 ? teams.slice(1).join(" - ") : "";

  const info = parts.slice(1).join(" ").trim();
  const sportText = info.split(".")[0]?.trim() ?? "";
  const sportKey = sportText ? sportKeyFromText(sportText) : null;
  const league = info.slice(sportText.length).replace(/^\.\s*/, "").trim() || null;

  return { home, away, sportText, sportKey, league, externalId };
}

type Indexed = {
  event: NormalizedEvent;
  homeNames: string[];
  awayNames: string[];
  prefixes: Set<string>;
  ageGroup: string | null;
  individual: boolean;
};

type Best = {
  item: Indexed;
  home: number;
  away: number;
  status: CheckStatus;
  score: number;
  idMatched: boolean;
};

function namesOf(text: LocalizedText): string[] {
  return [...new Set([normalizeName(text.ru), normalizeName(text.en)].filter(Boolean))];
}

function prefixesOf(names: string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const name of names) {
    for (const token of name.split(" ")) {
      if (token.length >= 2) prefixes.add(token.slice(0, Math.min(PREFIX_LENGTH, token.length)));
    }
  }
  return prefixes;
}

function buildIndex(events: NormalizedEvent[]): Indexed[] {
  return events.map((event) => {
    const homeNames = namesOf(event.home);
    const awayNames = namesOf(event.away);
    return {
      event,
      homeNames,
      awayNames,
      prefixes: prefixesOf([...homeNames, ...awayNames]),
      ageGroup: eventAgeGroup(event),
      individual: INDIVIDUAL_SPORTS.has(event.sportKey),
    };
  });
}

function bestSide(name: string, candidates: string[], individual: boolean): number {
  let best = 0;
  for (const candidate of candidates) {
    const score = teamSimilarity(name, candidate, { individual });
    if (score > best) best = score;
  }
  return best;
}

/** Scores the pasted home/away names against an event, trying both home/away orders. */
function evaluate(homeName: string, awayName: string, item: Indexed) {
  const individual = item.individual;
  const straightHome = bestSide(homeName, item.homeNames, individual);
  const straightAway = bestSide(awayName, item.awayNames, individual);
  const crossedHome = bestSide(homeName, item.awayNames, individual);
  const crossedAway = bestSide(awayName, item.homeNames, individual);
  if (crossedHome + crossedAway > straightHome + straightAway) {
    return { home: crossedHome, away: crossedAway };
  }
  return { home: straightHome, away: straightAway };
}

function bestPairScore(aList: string[], bList: string[], individual: boolean): number {
  let best = 0;
  for (const a of aList) {
    for (const b of bList) {
      const score = teamSimilarity(a, b, { individual });
      if (score > best) best = score;
    }
  }
  return best;
}

/** Finds every bookmaker in `index` that lists the same scheduled match as `target`. */
function collectSourcesForMatch(target: Indexed, index: Indexed[]): SourceId[] {
  const sources = new Set<SourceId>([target.event.source]);
  const targetMs = target.event.startsAt.getTime();
  const individual = target.individual;

  for (const candidate of index) {
    if (candidate.event.source === target.event.source) continue;
    if (candidate.event.sportKey !== target.event.sportKey) continue;
    if (Math.abs(candidate.event.startsAt.getTime() - targetMs) > SIBLING_TIME_MS) continue;
    if (target.ageGroup && candidate.ageGroup && target.ageGroup !== candidate.ageGroup) continue;

    const straightOk =
      bestPairScore(target.homeNames, candidate.homeNames, individual) >= SIDE_THRESHOLD &&
      bestPairScore(target.awayNames, candidate.awayNames, individual) >= SIDE_THRESHOLD;
    const crossedOk =
      bestPairScore(target.homeNames, candidate.awayNames, individual) >= SIDE_THRESHOLD &&
      bestPairScore(target.awayNames, candidate.homeNames, individual) >= SIDE_THRESHOLD;

    if (straightOk || crossedOk) {
      sources.add(candidate.event.source);
    }
  }

  return SOURCE_IDS.filter((id) => sources.has(id));
}

/** Best green/yellow candidate among events in the window (optionally limited to one sport). */
function findBest(
  homeName: string,
  awayName: string,
  externalId: string | null,
  index: Indexed[],
  sportKey: string | null,
  ageGroup: string | null,
  nowMs: number,
): Best | null {
  const pastedPrefixes = prefixesOf([homeName, awayName]);
  let best: Best | null = null;

  for (const item of index) {
    if (sportKey && item.event.sportKey !== sportKey) continue;
    if (ageGroup && item.ageGroup && ageGroup !== item.ageGroup) continue;

    // Only the upcoming matches inside the window are candidates.
    const startsIn = item.event.startsAt.getTime() - nowMs;
    if (startsIn <= 0 || startsIn > CHECK_WINDOW_MS) continue;

    let shares = false;
    for (const prefix of pastedPrefixes) {
      if (item.prefixes.has(prefix)) {
        shares = true;
        break;
      }
    }
    if (!shares) continue;

    const scores = evaluate(homeName, awayName, item);
    const homeOk = scores.home >= SIDE_THRESHOLD;
    const awayOk = scores.away >= SIDE_THRESHOLD;
    const status: CheckStatus = homeOk && awayOk ? "green" : homeOk || awayOk ? "yellow" : "red";
    if (status === "red") continue;

    const idMatched =
      Boolean(externalId) && item.event.source === "1xbet" && item.event.externalId === externalId;
    // Higher status first, then closer team names, an ID match, and the nearest start.
    const hoursAhead = startsIn / 3600_000;
    const score =
      RANK[status] * 10 + scores.home + scores.away + (idMatched ? ID_BONUS : 0) - hoursAhead * 0.001;
    if (!best || score > best.score) {
      best = { item, home: scores.home, away: scores.away, status, score, idMatched };
    }
  }

  return best;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function checkLines(rawLines: string[], events: NormalizedEvent[], nowMs = Date.now()): CheckResult[] {
  const index = buildIndex(events);

  return rawLines.map((raw, position) => {
    const parsed = parseMatchLine(raw);
    const base = { ...parsed, index: position + 1, raw: raw.trim() };
    const empty = { homeMatched: false, awayMatched: false, homeScore: 0, awayScore: 0, match: null };

    if (!parsed.home || !parsed.away) {
      return { ...base, ...empty, status: "invalid" as const };
    }

    const homeName = normalizeName(parsed.home);
    const awayName = normalizeName(parsed.away);

    // Search the stated sport first; also search all sports and keep whichever scores higher.
    const pastedAge = ageGroupOf(raw);
    const inSport = findBest(homeName, awayName, parsed.externalId, index, parsed.sportKey, pastedAge, nowMs);
    const anySport = parsed.sportKey
      ? findBest(homeName, awayName, parsed.externalId, index, null, pastedAge, nowMs)
      : null;
    const best =
      inSport && anySport ? (anySport.score > inSport.score ? anySport : inSport) : (inSport ?? anySport);

    if (!best) {
      return { ...base, ...empty, status: "red" as const };
    }

    const event = best.item.event;
    const sources = collectSourcesForMatch(best.item, index);
    return {
      ...base,
      status: best.status,
      homeMatched: best.home >= SIDE_THRESHOLD,
      awayMatched: best.away >= SIDE_THRESHOLD,
      homeScore: round2(best.home),
      awayScore: round2(best.away),
      match: {
        id: `${event.source}-${event.externalId}`,
        startsAt: event.startsAt.toISOString(),
        sportKey: event.sportKey,
        sportName: event.sportName,
        leagueName: event.leagueName,
        home: event.home,
        away: event.away,
        sources,
        idMatched: best.idMatched,
      },
    };
  });
}
