import type { LocalizedText } from "./model";

export type MatchFormatCategory =
  | "quarters"
  | "halves"
  | "periods"
  | "series"
  | "sets"
  | "innings"
  | "rounds";

export type MatchFormatOrigin = "feed" | "title" | "league" | "sport";

export type MatchFormat = {
  /** Compact architectural code shown in match cards & tables, e.g. "4×10", "BO3", "2×45", "Bo5 Sets". */
  code: string;
  category: MatchFormatCategory;
  /** Localized human-readable breakdown for badges & tooltips, e.g. "4 quarters × 10 min". */
  label: LocalizedText;
  /** Specificity of how this format was determined: direct feed metadata > event/league text > competition rule > sport rule. */
  origin: MatchFormatOrigin;
};

export type FormatExtractInput = {
  sportKey: string;
  leagueEn: string;
  leagueRu?: string;
  homeEn?: string;
  awayEn?: string;
  /** Total regulation minutes directly reported by a bookmaker feed (e.g. Vbet `match_length`). */
  feedMinutes?: number | null;
  /** Explicit best-of count reported by a bookmaker feed (e.g. Pinnacle esports `periods`). */
  feedBestOf?: number | null;
  /** Raw format metadata strings exposed by a bookmaker (e.g. 1xBet `MIO.MaF`, `MIO.TSt`, `SC.CPS`). */
  feedHints?: (string | null | undefined)[];
};

const ORIGIN_RANK: Record<MatchFormatOrigin, number> = {
  feed: 4,
  title: 3,
  league: 2,
  sport: 1,
};

/** Selects the higher-confidence format between two candidates (e.g., when merging bookmakers). */
export function pickBestMatchFormat(
  a: MatchFormat | null | undefined,
  b: MatchFormat | null | undefined,
): MatchFormat | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const rankDiff = ORIGIN_RANK[b.origin] - ORIGIN_RANK[a.origin];
  if (rankDiff > 0) return b;
  if (rankDiff < 0) return a;
  // Same origin: prefer timed or specific codes over generic ones, or keep first.
  return a;
}

export function serializeMatchFormat(format: MatchFormat | null | undefined): string | null {
  return format ? JSON.stringify(format) : null;
}

export function parseStoredMatchFormat(raw: string | null | undefined): MatchFormat | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MatchFormat>;
    if (
      typeof parsed?.code === "string" &&
      typeof parsed?.category === "string" &&
      typeof parsed?.label?.en === "string" &&
      typeof parsed?.label?.ru === "string" &&
      typeof parsed?.origin === "string"
    ) {
      return parsed as MatchFormat;
    }
  } catch {
    // Ignore malformed stored format JSON.
  }
  return null;
}

const VALID_COUNTS = new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 15]);
const VALID_MINUTES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40, 45]);

const TIMED_TEAM_SPORTS = new Set([
  "football",
  "futsal",
  "basketball",
  "basketball-3x3",
  "ice-hockey",
  "handball",
  "water-polo",
  "field-hockey",
  "rugby",
  "rugby-union",
  "rugby-league",
  "american-football",
  "aussie-rules",
  "floorball",
  "bandy",
  "baseball",
]);

function makeTimedFormat(
  sportKey: string,
  count: number,
  minutes: number,
  origin: MatchFormatOrigin,
): MatchFormat {
  const code = `${count}×${minutes}`;

  if (sportKey === "boxing" || sportKey === "mma" || sportKey === "mixed-martial-arts" || sportKey === "bare-knuckle-boxing") {
    return {
      code,
      category: "rounds",
      label: {
        en: `${count} rounds × ${minutes} min`,
        ru: `${count} раунд. × ${minutes} мин`,
      },
      origin,
    };
  }

  if (count === 4 || (sportKey === "field-hockey" && count === 4)) {
    return {
      code,
      category: "quarters",
      label: {
        en: `${count} quarters × ${minutes} min`,
        ru: `${count} четв. × ${minutes} мин`,
      },
      origin,
    };
  }

  if (count === 2) {
    return {
      code,
      category: "halves",
      label: {
        en: `2 halves × ${minutes} min`,
        ru: `2 тайма × ${minutes} мин`,
      },
      origin,
    };
  }

  return {
    code,
    category: "periods",
    label: {
      en: `${count} ${count === 1 ? "period" : "periods"} × ${minutes} min`,
      ru: `${count} ${count === 1 ? "период" : count <= 4 ? "периода" : "периодов"} × ${minutes} мин`,
    },
    origin,
  };
}

function makeBestOfSeries(n: number, origin: MatchFormatOrigin): MatchFormat {
  const wins = Math.floor(n / 2) + 1;
  return {
    code: `BO${n}`,
    category: "series",
    label: {
      en: n === 1 ? "Single map (BO1)" : n === 2 ? "Best of 2 maps" : `Best of ${n} maps`,
      ru: n === 1 ? "1 карта (BO1)" : n === 2 ? "2 карты (BO2)" : `До ${wins} побед (BO${n})`,
    },
    origin,
  };
}

function makeBestOfUnits(
  n: number,
  unit: "sets" | "frames" | "legs" | "games",
  origin: MatchFormatOrigin,
): MatchFormat {
  const wins = Math.floor(n / 2) + 1;
  if (unit === "sets") {
    return {
      code: `Bo${n} Sets`,
      category: "sets",
      label: {
        en: `Best of ${n} sets`,
        ru: `До ${wins} побед (из ${n} сетов)`,
      },
      origin,
    };
  }
  if (unit === "games") {
    return {
      code: `Bo${n} Games`,
      category: "sets",
      label: {
        en: `Best of ${n} games · 21 pts`,
        ru: `До ${wins} партий (до 21 очка)`,
      },
      origin,
    };
  }
  if (unit === "frames") {
    return {
      code: `Bo${n} Frames`,
      category: "sets",
      label: {
        en: `Best of ${n} frames`,
        ru: `До ${wins} фрейм. (из ${n})`,
      },
      origin,
    };
  }
  return {
    code: `Bo${n} Legs`,
    category: "sets",
    label: {
      en: `Best of ${n} legs`,
      ru: `До ${wins} легов (из ${n})`,
    },
    origin,
  };
}

function parseFromText(
  text: string,
  sportKey: string,
  origin: MatchFormatOrigin,
): MatchFormat | null {
  if (!text) return null;

  // 1. Cricket explicit formats ("T20", "ODI", "T10", "35 overs", "Test match")
  if (sportKey === "cricket" || /\b(?:twenty20|t20i?|odi|overs)\b/i.test(text)) {
    if (/\bt20i?\b|\btwenty\s*20\b/i.test(text)) {
      return {
        code: "T20",
        category: "innings",
        label: { en: "Twenty20 · 20 overs", ru: "T20 · 20 оверов" },
        origin,
      };
    }
    if (/\bt10\b/i.test(text)) {
      return {
        code: "T10",
        category: "innings",
        label: { en: "T10 · 10 overs", ru: "T10 · 10 оверов" },
        origin,
      };
    }
    if (/\bodi\b|\bone[\s-]?day\b/i.test(text)) {
      return {
        code: "ODI",
        category: "innings",
        label: { en: "One Day · 50 overs", ru: "ODI · 50 оверов" },
        origin,
      };
    }
    const oversMatch = text.match(/\b(\d{1,2})\s*overs\b/i);
    if (oversMatch) {
      const overs = Number(oversMatch[1]);
      if (overs >= 5 && overs <= 60) {
        return {
          code: `${overs} Overs`,
          category: "innings",
          label: { en: `${overs} overs per side`, ru: `${overs} оверов` },
          origin,
        };
      }
    }
    if (sportKey === "cricket" && /\b(?:test\s*match|first[\s-]?class)\b/i.test(text)) {
      return {
        code: "Test",
        category: "innings",
        label: { en: "Test match · up to 5 days", ru: "Тест-матч · до 5 дней" },
        origin,
      };
    }
  }

  // 2. Prose round / period phrasing ("10 rounds of 2 min", "4 quarters of 10 min", "2 halves of 45 min")
  const roundOfMin = text.match(/(\d{1,2})\s*(?:rounds?|раунд(?:а|ов)?)\s*(?:of|by|по|×|x)\s*(\d{1,2})\s*(?:min|mins|minutes|мин)/iu);
  if (roundOfMin) {
    const rounds = Number(roundOfMin[1]);
    const mins = Number(roundOfMin[2]);
    if (rounds >= 2 && rounds <= 15 && mins >= 1 && mins <= 10) {
      return makeTimedFormat(sportKey, rounds, mins, origin);
    }
  }

  const prosePeriod = text.match(
    /(\d{1,2})\s*(halves|quarters|periods|тайм(?:а|ов)?|четверт(?:и|ей)?|период(?:а|ов)?)\s*(?:of|by|по|×|x)\s*(\d{1,2})\s*(?:min|mins|minutes|мин)?/iu,
  );
  if (prosePeriod) {
    const count = Number(prosePeriod[1]);
    const mins = Number(prosePeriod[3]);
    if (VALID_COUNTS.has(count) && VALID_MINUTES.has(mins)) {
      return makeTimedFormat(sportKey, count, mins, origin);
    }
  }

  // 3. Explicit NxM period notation (e.g. "4x12 min", "3x10", "2x20", "2x45")
  const nxmMatches = [
    ...text.matchAll(
      /(?:^|[^\p{L}\p{N}])(\d{1,2})\s*[xх×]\s*(\d{1,2}(?:[.,]\d)?)\s*(min|mins|minutes|мин|km|км|m|м)?(?=$|[^\p{L}\p{N}])/giu,
    ),
  ];
  for (const m of nxmMatches) {
    const unit = (m[3] ?? "").toLowerCase();
    // Skip relay distances ("4x6 km", "4x7.5 km").
    if (unit === "km" || unit === "км" || unit === "m" || unit === "м") continue;
    const rawCount = Number(m[1]);
    const rawMins = Number(m[2].replace(",", "."));
    if (!Number.isInteger(rawMins)) continue;
    const hasMinUnit = unit === "min" || unit === "mins" || unit === "minutes" || unit === "мин";
    // Skip team-size notation like 2x2, 3x3, 4x4, 5x5, 6x6 unless explicitly labeled with "min".
    if (rawCount === rawMins && rawCount >= 2 && rawCount <= 8 && !hasMinUnit) continue;
    if (!VALID_COUNTS.has(rawCount) || !VALID_MINUTES.has(rawMins)) continue;
    if (rawCount === 1 && rawMins < 10) continue;
    return makeTimedFormat(sportKey, rawCount, rawMins, origin);
  }

  // 4. 1xBet "7 Games Match" / "5 Games Match"
  const gamesMatch = text.match(/\b(3|5|7|9)\s+games?\s+match\b/i);
  if (gamesMatch) {
    return makeBestOfUnits(Number(gamesMatch[1]), "sets", origin);
  }

  // 5. Explicit Best-of / BO / legs / frames / sets
  const allowBestOf = !TIMED_TEAM_SPORTS.has(sportKey);
  if (allowBestOf) {
    const boFrames = text.match(/(?:best\s+of|bo)\s*[-:]?\s*(\d{1,2})\s*frames?\b/i);
    if (boFrames) {
      const n = Number(boFrames[1]);
      if (n >= 3 && n <= 35) return makeBestOfUnits(n, "frames", origin);
    }

    const boLegs = text.match(/(?:best\s+of|bo)\s*[-:]?\s*(\d{1,2})\s*legs?\b|\b(\d{1,2})\s*legs\b/i);
    if (boLegs) {
      const n = Number(boLegs[1] ?? boLegs[2]);
      if (n >= 3 && n <= 35) return makeBestOfUnits(n, "legs", origin);
    }

    const boSets = text.match(/(?:best\s+of|bo)\s*[-:]?\s*(3|5|7)\s*sets?\b/i);
    if (boSets) {
      return makeBestOfUnits(Number(boSets[1]), "sets", origin);
    }

    const genericBo = text.match(/(?:^|[^\p{L}\p{N}])(?:best\s*of|bo)\s*[-:]?\s*(\d{1,2})(?=$|[^\p{L}\p{N}])/iu);
    if (genericBo) {
      const n = Number(genericBo[1]);
      if (n >= 1 && n <= 35) {
        if (sportKey === "snooker" || sportKey === "pool" || sportKey === "billiards") {
          return makeBestOfUnits(n, "frames", origin);
        }
        if (sportKey === "darts") {
          return makeBestOfUnits(n, "legs", origin);
        }
        if (
          sportKey === "tennis" ||
          sportKey === "table-tennis" ||
          sportKey === "volleyball" ||
          sportKey === "squash"
        ) {
          return makeBestOfUnits(n, "sets", origin);
        }
        if (sportKey === "badminton") {
          return makeBestOfUnits(n, "games", origin);
        }
        return makeBestOfSeries(n, origin);
      }
    }

    const ruWins = text.match(/до\s*([1-9])\s*побед/iu);
    if (ruWins) {
      const wins = Number(ruWins[1]);
      const bo = wins * 2 - 1;
      if (sportKey === "esports") return makeBestOfSeries(bo, origin);
      if (sportKey === "snooker" || sportKey === "pool") return makeBestOfUnits(bo, "frames", origin);
      if (sportKey === "darts") return makeBestOfUnits(bo, "legs", origin);
      return makeBestOfUnits(bo, "sets", origin);
    }
  }

  // 6. Boxing / MMA explicit round count
  if (sportKey === "boxing" || sportKey === "mma") {
    const roundsMatch = text.match(/\b(3|4|5|6|8|10|12)\s*rounds?\b/i);
    if (roundsMatch) {
      const n = Number(roundsMatch[1]);
      return {
        code: `${n}R`,
        category: "rounds",
        label: { en: `${n} rounds`, ru: `${n} раундов` },
        origin,
      };
    }
  }

  // 7. Baseball explicit innings
  if (sportKey === "baseball") {
    const inn = text.match(/\b(7|9)\s*innings?\b/i);
    if (inn) {
      const n = Number(inn[1]);
      return {
        code: `${n} Inn`,
        category: "innings",
        label: { en: `${n} innings`, ru: `${n} иннингов` },
        origin,
      };
    }
  }

  return null;
}

function formatFromFeedMinutes(
  minutes: number,
  sportKey: string,
  leagueText: string,
): MatchFormat | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);

  if (sportKey === "football" || sportKey === "bandy") {
    if (rounded === 90) return makeTimedFormat(sportKey, 2, 45, "feed");
    if (rounded === 80) return makeTimedFormat(sportKey, 2, 40, "feed");
    if (rounded === 70) return makeTimedFormat(sportKey, 2, 35, "feed");
    if (rounded === 60) return makeTimedFormat(sportKey, 2, 30, "feed");
    if (rounded === 50) return makeTimedFormat(sportKey, 2, 25, "feed");
    if (rounded === 40) return makeTimedFormat(sportKey, 2, 20, "feed");
    if (rounded === 12 || rounded === 10 || rounded === 8 || rounded === 6) {
      return makeTimedFormat(sportKey, 2, rounded / 2, "feed");
    }
  }
  if (sportKey === "futsal") {
    if (rounded === 40) return makeTimedFormat(sportKey, 2, 20, "feed");
    if (rounded === 50) return makeTimedFormat(sportKey, 2, 25, "feed");
  }
  if (sportKey === "handball") {
    if (rounded === 60) return makeTimedFormat(sportKey, 2, 30, "feed");
    if (rounded === 50) return makeTimedFormat(sportKey, 2, 25, "feed");
    if (rounded === 40) return makeTimedFormat(sportKey, 2, 20, "feed");
  }
  if (sportKey === "basketball") {
    if (rounded === 48) return makeTimedFormat(sportKey, 4, 12, "feed");
    if (rounded === 40) {
      const isCollege = /\b(?:ncaa|ncaab|ncaaw|naia|college)\b/i.test(leagueText);
      return makeTimedFormat(sportKey, isCollege ? 2 : 4, isCollege ? 20 : 10, "feed");
    }
    if (rounded === 32) return makeTimedFormat(sportKey, 4, 8, "feed");
  }
  if (sportKey === "ice-hockey" || sportKey === "floorball") {
    if (rounded === 60) return makeTimedFormat(sportKey, 3, 20, "feed");
    if (rounded === 45) return makeTimedFormat(sportKey, 3, 15, "feed");
    if (rounded === 30) return makeTimedFormat(sportKey, 3, 10, "feed");
  }
  if (sportKey === "water-polo" && rounded === 32) return makeTimedFormat(sportKey, 4, 8, "feed");
  if (sportKey === "field-hockey" && rounded === 60) return makeTimedFormat(sportKey, 4, 15, "feed");
  if (sportKey === "american-football" && rounded === 60) return makeTimedFormat(sportKey, 4, 15, "feed");
  if (sportKey === "aussie-rules" && rounded === 80) return makeTimedFormat(sportKey, 4, 20, "feed");
  if ((sportKey === "rugby" || sportKey === "rugby-union" || sportKey === "rugby-league") && rounded === 80) {
    return makeTimedFormat(sportKey, 2, 40, "feed");
  }
  if (sportKey === "esports") {
    if (rounded === 12) return makeTimedFormat(sportKey, 2, 6, "feed");
    if (rounded === 10) return makeTimedFormat(sportKey, 2, 5, "feed");
    if (rounded === 8) return makeTimedFormat(sportKey, 2, 4, "feed");
  }

  return null;
}

function formatByCompetition(sportKey: string, leagueText: string): MatchFormat | null {
  if (!leagueText) return null;

  if (sportKey === "basketball") {
    if (/\b(?:nba|g[\s-]?league|p\.?\s*league|tpbl|pba)\b/i.test(leagueText) && !/\bwnba\b/i.test(leagueText)) {
      return makeTimedFormat(sportKey, 4, 12, "league");
    }
    if (/\bchina\b.*\bcba\b|\bcba\b.*\bchina\b/i.test(leagueText)) {
      return makeTimedFormat(sportKey, 4, 12, "league");
    }
    if (/\b(?:ncaa|ncaab|ncaaw|naia|college)\b/i.test(leagueText)) {
      return makeTimedFormat(sportKey, 2, 20, "league");
    }
    if (/\b(?:wnba|euroleague|eurocup|vtb|acb|bbl|lnb|fiba|aba|bsl|kbl|nbl|bcl|eurobasket|olympic|world cup)\b/i.test(leagueText)) {
      return makeTimedFormat(sportKey, 4, 10, "league");
    }
  }

  if (sportKey === "tennis") {
    const isGrandSlam = /\b(?:australian open|french open|roland garros|wimbledon|us open)\b/i.test(leagueText);
    const isShortFormat = /\b(?:women|wta|ladies|girls|doubles|mixed|junior|qualif|challenger|itf)\b/i.test(leagueText);
    if (isGrandSlam && !isShortFormat && /\b(?:atp|men|singles)\b/i.test(leagueText)) {
      return makeBestOfUnits(5, "sets", "league");
    }
    if (/\b(?:atp|wta|challenger|itf|davis cup|billie jean|united cup)\b/i.test(leagueText)) {
      return makeBestOfUnits(3, "sets", "league");
    }
  }

  if (sportKey === "cricket") {
    if (/\b(?:ipl|bbl|big bash|psl|cpl|sa20|ilt20|bpl|mlc|t20|twenty20|blast)\b/i.test(leagueText)) {
      return {
        code: "T20",
        category: "innings",
        label: { en: "Twenty20 · 20 overs", ru: "T20 · 20 оверов" },
        origin: "league",
      };
    }
    if (/\b(?:odi|one[\s-]?day)\b/i.test(leagueText)) {
      return {
        code: "ODI",
        category: "innings",
        label: { en: "One Day · 50 overs", ru: "ODI · 50 оверов" },
        origin: "league",
      };
    }
  }

  if (
    (sportKey === "rugby" || sportKey === "rugby-union" || sportKey === "rugby-league") &&
    /\b(?:sevens|7s)\b/i.test(leagueText)
  ) {
    return makeTimedFormat(sportKey, 2, 7, "league");
  }

  if (sportKey === "curling" && /\b(?:gsoc|grand slam|mixed doubles)\b/i.test(leagueText)) {
    return {
      code: "8 Ends",
      category: "innings",
      label: { en: "8 ends", ru: "8 эндов" },
      origin: "league",
    };
  }

  if (
    sportKey === "bare-knuckle-boxing" ||
    ((sportKey === "mma" || sportKey === "mixed-martial-arts") && /\b(?:bare\s*knuckle|bkfc)\b/i.test(leagueText))
  ) {
    return makeTimedFormat(sportKey, 5, 2, "league");
  }

  if (
    (sportKey === "mma" || sportKey === "mixed-martial-arts") &&
    /\b(?:title\s*(?:bout|fight)|championship\s*(?:bout|fight)|main\s*event|5\s*rounds?)\b/i.test(leagueText)
  ) {
    return makeTimedFormat(sportKey, 5, 5, "league");
  }

  return null;
}

function formatBySportDefault(sportKey: string): MatchFormat | null {
  switch (sportKey) {
    case "football":
    case "bandy":
      return makeTimedFormat(sportKey, 2, 45, "sport");
    case "futsal":
      return makeTimedFormat(sportKey, 2, 20, "sport");
    case "basketball":
      return makeTimedFormat(sportKey, 4, 10, "sport");
    case "basketball-3x3":
      return {
        code: "1×10 / 21",
        category: "periods",
        label: { en: "1 period × 10 min (or 21 pts)", ru: "1 период × 10 мин (или до 21)" },
        origin: "sport",
      };
    case "ice-hockey":
    case "floorball":
      return makeTimedFormat(sportKey, 3, 20, "sport");
    case "handball":
      return makeTimedFormat(sportKey, 2, 30, "sport");
    case "water-polo":
      return makeTimedFormat(sportKey, 4, 8, "sport");
    case "field-hockey":
      return makeTimedFormat(sportKey, 4, 15, "sport");
    case "rugby":
    case "rugby-union":
    case "rugby-league":
      return makeTimedFormat(sportKey, 2, 40, "sport");
    case "american-football":
      return makeTimedFormat(sportKey, 4, 15, "sport");
    case "aussie-rules":
      return makeTimedFormat(sportKey, 4, 20, "sport");
    case "volleyball":
    case "table-tennis":
      return makeBestOfUnits(5, "sets", "sport");
    case "badminton":
      return makeBestOfUnits(3, "games", "sport");
    case "mma":
    case "mixed-martial-arts":
      return makeTimedFormat(sportKey, 3, 5, "sport");
    case "bare-knuckle-boxing":
      return makeTimedFormat(sportKey, 5, 2, "sport");
    case "baseball":
      return {
        code: "9 Inn",
        category: "innings",
        label: { en: "9 innings", ru: "9 иннингов" },
        origin: "sport",
      };
    case "curling":
      return {
        code: "10 Ends",
        category: "innings",
        label: { en: "10 ends", ru: "10 эндов" },
        origin: "sport",
      };
    default:
      return null;
  }
}

/**
 * Extracts a structured match format for an event in strict priority order:
 * 1. Direct bookmaker feed fields (`feedHints`, `feedBestOf`, `feedMinutes`) -> `origin: "feed"`
 * 2. Explicit format strings in tournament or team titles (`4x12 min`, `BO3`, `3x10`) -> `origin: "title"`
 * 3. Verified competition rules (`NBA -> 4x12`, `NCAA -> 2x20`, `ATP/WTA -> Bo3 Sets`) -> `origin: "league"`
 * 4. Standard sport regulations (`Football -> 2x45`, `Ice Hockey -> 3x20`, etc.) -> `origin: "sport"`
 */
export function extractMatchFormat(input: FormatExtractInput): MatchFormat | null {
  const leagueCombined = [input.leagueEn, input.leagueRu].filter(Boolean).join(" | ");

  // 1a. Explicit bookmaker field hints (e.g. 1xBet MIO.MaF)
  for (const hint of input.feedHints ?? []) {
    if (!hint) continue;
    const fromHint = parseFromText(hint, input.sportKey, "feed");
    if (fromHint) return fromHint;
  }

  // 1b. Explicit bookmaker best-of series count (e.g. Pinnacle esports periods 1..3)
  if (input.feedBestOf && input.feedBestOf >= 2 && input.feedBestOf <= 15) {
    if (input.sportKey === "esports") {
      return makeBestOfSeries(input.feedBestOf, "feed");
    }
    if (
      input.sportKey === "tennis" ||
      input.sportKey === "table-tennis" ||
      input.sportKey === "volleyball" ||
      input.sportKey === "badminton"
    ) {
      return makeBestOfUnits(input.feedBestOf, "sets", "feed");
    }
  }

  // 1c. Explicit bookmaker regulation minutes (e.g. Vbet match_length)
  if (input.feedMinutes) {
    const fromMinutes = formatFromFeedMinutes(input.feedMinutes, input.sportKey, leagueCombined);
    if (fromMinutes) return fromMinutes;
  }

  // 2. Explicit format strings inside tournament/event names
  for (const text of [input.leagueEn, input.leagueRu, input.homeEn, input.awayEn]) {
    if (!text) continue;
    const parsed = parseFromText(text, input.sportKey, "title");
    if (parsed) return parsed;
  }

  // 3. Verified competition / league rules
  const byLeague = formatByCompetition(input.sportKey, leagueCombined);
  if (byLeague) return byLeague;

  // 4. Standard sport regulations
  return formatBySportDefault(input.sportKey);
}
