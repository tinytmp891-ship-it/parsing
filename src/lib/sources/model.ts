import type { MatchFormat } from "./format";
import type { MatchVenueInfo, TournamentStage } from "./match-details";

/**
 * Shared types and helpers for all bookmaker sources:
 * a normalized event shape, sport canonicalization, age/women tag handling, and team/player similarity.
 */

export type SourceId =
  | "1xbet"
  | "fonbet"
  | "betcity"
  | "marathon"
  | "vbet"
  | "unibet"
  | "netbet"
  | "bcgame"
  | "parimatch"
  | "oddsportal"
  | "oddspedia"
  | "bet365"
  | "bwin"
  | "totogaming"
  | "stake"
  | "pinnacle";

export const SOURCE_IDS: readonly SourceId[] = [
  "1xbet",
  "fonbet",
  "betcity",
  "marathon",
  "vbet",
  "unibet",
  "netbet",
  "bcgame",
  "parimatch",
  "oddsportal",
  "oddspedia",
  "bet365",
  "bwin",
  "totogaming",
  "stake",
  "pinnacle",
];

export const SOURCE_LABELS: Record<SourceId, string> = {
  "1xbet": "1xBet",
  fonbet: "Fonbet",
  betcity: "Betcity",
  marathon: "Marathonbet",
  vbet: "Vbet",
  unibet: "Unibet",
  netbet: "NetBet",
  bcgame: "BC.Game",
  parimatch: "Parimatch",
  oddsportal: "OddsPortal",
  oddspedia: "Oddspedia",
  bet365: "bet365",
  bwin: "bwin",
  totogaming: "TotoGaming",
  stake: "Stake",
  pinnacle: "Pinnacle",
};

export type LocalizedText = { en: string; ru: string };

export type NormalizedEvent = {
  source: SourceId;
  externalId: string;
  sportKey: string;
  sportName: LocalizedText;
  leagueName: LocalizedText;
  home: LocalizedText;
  away: LocalizedText;
  startsAt: Date;
  sourceHost: string | null;
  matchFormat?: MatchFormat | null;
  tournamentStage?: TournamentStage | null;
  matchInfo?: MatchVenueInfo | null;
};

export type SourceTask = {
  label: string;
  run: () => Promise<NormalizedEvent[]>;
};

export type SourceAdapter = {
  id: SourceId;
  /** How many tasks may run at the same time. */
  concurrency: number;
  /** Lists the work to do (leagues, listings). Throws when the source is unavailable. */
  createTasks: () => Promise<SourceTask[]>;
};

/** Thrown by a bookmaker that cannot be read from this server (blocked, legal restriction, or no parser yet). */
export class SourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  return Promise.all(runners).then(() => undefined);
}

/** Canonical sport labels (used for display and for matching sports across bookmakers). */
const SPORT_LABELS: Record<string, LocalizedText> = {
  football: { en: "Football", ru: "Футбол" },
  "ice-hockey": { en: "Ice Hockey", ru: "Хоккей" },
  tennis: { en: "Tennis", ru: "Теннис" },
  basketball: { en: "Basketball", ru: "Баскетбол" },
  "basketball-3x3": { en: "Basketball 3x3", ru: "Баскетбол 3x3" },
  volleyball: { en: "Volleyball", ru: "Волейбол" },
  "table-tennis": { en: "Table Tennis", ru: "Настольный теннис" },
  cricket: { en: "Cricket", ru: "Крикет" },
  "american-football": { en: "American Football", ru: "Американский футбол" },
  "aussie-rules": { en: "Aussie Rules", ru: "Австралийский футбол" },
  esports: { en: "Esports", ru: "Киберспорт" },
  handball: { en: "Handball", ru: "Гандбол" },
  futsal: { en: "Futsal", ru: "Футзал" },
  baseball: { en: "Baseball", ru: "Бейсбол" },
  rugby: { en: "Rugby", ru: "Регби" },
  "rugby-league": { en: "Rugby League", ru: "Регби-лига" },
  "rugby-union": { en: "Rugby Union", ru: "Регби-юнион" },
  boxing: { en: "Boxing", ru: "Бокс" },
  mma: { en: "MMA / UFC", ru: "ММА / UFC" },
  badminton: { en: "Badminton", ru: "Бадминтон" },
  darts: { en: "Darts", ru: "Дартс" },
  snooker: { en: "Snooker", ru: "Снукер" },
  billiards: { en: "Billiards", ru: "Бильярд" },
  pool: { en: "Pool", ru: "Пул" },
  squash: { en: "Squash", ru: "Сквош" },
  "water-polo": { en: "Water Polo", ru: "Водное поло" },
  "field-hockey": { en: "Field Hockey", ru: "Хоккей на траве" },
  golf: { en: "Golf", ru: "Гольф" },
  chess: { en: "Chess", ru: "Шахматы" },
  "formula-1": { en: "Formula 1", ru: "Формула 1" },
  autosport: { en: "Autosport", ru: "Автоспорт" },
  "horse-racing": { en: "Horse Racing", ru: "Конный спорт" },
  floorball: { en: "Floorball", ru: "Флорбол" },
  bandy: { en: "Bandy", ru: "Бенди" },
  biathlon: { en: "Biathlon", ru: "Биатлон" },
  "alpine-skiing": { en: "Alpine Skiing", ru: "Горные лыжи" },
  "cross-country-skiing": { en: "Cross-country Skiing", ru: "Лыжные гонки" },
  "ski-jumping": { en: "Ski Jumping", ru: "Прыжки с трамплина" },
  curling: { en: "Curling", ru: "Керлинг" },
  cycling: { en: "Cycling", ru: "Велоспорт" },
  sumo: { en: "Sumo", ru: "Сумо" },
  wrestling: { en: "Wrestling", ru: "Борьба" },
  "gaelic-sport": { en: "Gaelic Sport", ru: "Гэльский спорт" },
};

/** Individual (1v1 / solo / doubles) sports where bookmakers or searches often use player initials. */
export const INDIVIDUAL_SPORTS = new Set<string>([
  "tennis",
  "table-tennis",
  "badminton",
  "snooker",
  "billiards",
  "pool",
  "squash",
  "darts",
  "boxing",
  "mma",
  "kickboxing",
  "muay-thai",
  "chess",
  "golf",
  "cycling",
  "biathlon",
  "alpine-skiing",
  "cross-country-skiing",
  "ski-jumping",
  "autosport",
  "motosport",
  "formula-1",
  "sumo",
  "wrestling",
  "horse-racing",
]);

/** Source sport names that map to a different canonical key. */
const SPORT_ALIASES: Record<string, string> = {
  hockey: "ice-hockey",
  "ice hockey": "ice-hockey",
  "mix. fights": "mma",
  mma: "mma",
  ufc: "mma",
  "ufc/mma": "mma",
  "mma / ufc": "mma",
  "martial arts/ufc": "mma",
  "martial arts": "mma",
  billiard: "billiards",
  "alpine ski": "alpine-skiing",
  "winter sports": "alpine-skiing",
  skiing: "cross-country-skiing",
  "cross-country skiing": "cross-country-skiing",
  soccer: "football",
  "e-sports": "esports",
  "e sports": "esports",
  esports: "esports",
  cybersport: "esports",
  "counter-strike 2": "esports",
  "counter-strike": "esports",
  "dota 2": "esports",
  "league of legends": "esports",
  valorant: "esports",
  "e-football": "esports",
  efootball: "esports",
  "e-basketball": "esports",
  ebasketball: "esports",
  "e-ice hockey": "esports",
  "basketball 3x3": "basketball-3x3",
  "3x3 basketball": "basketball-3x3",
  "3 x 3 basketball": "basketball-3x3",
  "australian football": "aussie-rules",
  "australian rules": "aussie-rules",
  "aussie rules": "aussie-rules",
  "hockey with ball": "bandy",
  "auto racing": "autosport",
  "motor racing": "autosport",
  motorsport: "autosport",
  "padel tennis": "tennis",
  padel: "tennis",
  "gaelic football": "gaelic-sport",
  hurling: "gaelic-sport",
  "gaelic sports": "gaelic-sport",
  "ball hockey": "floorball",
  "water polo": "water-polo",
  "table tennis": "table-tennis",
  "american football": "american-football",
  "rugby union": "rugby-union",
  "rugby league": "rugby-league",
};

/** Maps a sport name as written in pasted text (English or Russian) to a canonical key. */
export function sportKeyFromText(text: string): string | null {
  const needle = text.trim().toLowerCase().replace(/ё/g, "е");
  if (!needle) return null;
  for (const [key, labels] of Object.entries(SPORT_LABELS)) {
    if (labels.en.toLowerCase() === needle || labels.ru.toLowerCase().replace(/ё/g, "е") === needle) {
      return key;
    }
  }
  if (needle === "мма") return "mma";
  return SPORT_ALIASES[needle] ?? null;
}

export function resolveSport(sourceEn: string, sourceRu?: string | null): { key: string; name: LocalizedText } {
  const trimmed = sourceEn.trim();
  const lower = trimmed.toLowerCase();
  const key = SPORT_ALIASES[lower] ?? (lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other");
  const name = SPORT_LABELS[key] ?? { en: trimmed, ru: (sourceRu ?? "").trim() || trimmed };
  return { key, name };
}

/**
 * Lowercase, strip accents and punctuation, and drop bracketed nicknames,
 * age-group markers (U19, Under 19, (U19), (19), до 19), women markers
 * ((w), (women), (wom), Women, Wom, (ж), жен), and club prefixes.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(fc|cf|sc|ac|afc|fk|sk|bk)\b/g, " ")
    // Age groups ("U19", "U-19", "Under 19", "до 19") are ignored so they normalize consistently.
    .replace(/\b(?:u|under)\s*\d{1,2}\b/g, " ")
    .replace(/(?<=^|\s)до\s+\d{1,2}(?=\s|$)/gu, " ")
    // Women indicators outside parentheses ("Team Women", "Team Wom", "Team W", "Команда жен")
    .replace(/(?<=^|\s)(?:women|wom|ladies|fem|жен|женщины)(?=\s|$)/gu, " ")
    .replace(/(?<=\s)[wж]$/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** 1 = identical, 0 = completely different (based on normalized Levenshtein distance). */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Similarity score given when one name's words are all found in the other name (2+ words). */
const CONTAINED_NAME_SCORE = 0.9;
/** Similarity score when an individual participant matches via initial + surname (e.g. "j sinner" vs "jannik sinner"). */
const INITIAL_NAME_SCORE = 0.92;

function personWordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) return nameSimilarity(a, b) >= 0.85;
  return false;
}

/**
 * Compares two normalized individual participant names where one or both may use initials
 * (e.g. "j sinner" / "sinner j" vs "jannik sinner", "д медведев" vs "даниил медведев",
 * or doubles "j sinner l sonego" vs "jannik sinner lorenzo sonego").
 */
export function personSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const first = a.split(" ").filter(Boolean);
  const second = b.split(" ").filter(Boolean);
  if (first.length === 0 || second.length === 0) return 0;

  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length < 2) return 0;
  if (!shorter.some((t) => t.length === 1) && !longer.some((t) => t.length === 1)) return 0;

  const usedLonger = new Set<number>();
  const matchedShorter = new Set<number>();
  let fullWordMatches = 0;

  // Pass 1: pair full words first so surnames always bind to surnames.
  for (let i = 0; i < shorter.length; i += 1) {
    const s = shorter[i];
    if (s.length < 2) continue;
    const j = longer.findIndex((l, idx) => !usedLonger.has(idx) && l.length >= 2 && personWordsMatch(s, l));
    if (j !== -1) {
      usedLonger.add(j);
      matchedShorter.add(i);
      fullWordMatches += 1;
    }
  }

  if (fullWordMatches === 0) return 0;

  // Pass 2: pair remaining tokens via initials (1-char initial <-> prefix of full word, or matching initials).
  for (let i = 0; i < shorter.length; i += 1) {
    if (matchedShorter.has(i)) continue;
    const s = shorter[i];
    const j = longer.findIndex((l, idx) => {
      if (usedLonger.has(idx)) return false;
      if (s.length === 1 && l.length >= 2) return l.startsWith(s);
      if (l.length === 1 && s.length >= 2) return s.startsWith(l);
      if (s.length === 1 && l.length === 1) return s === l;
      return false;
    });
    if (j === -1) return 0;
    usedLonger.add(j);
    matchedShorter.add(i);
  }

  return INITIAL_NAME_SCORE;
}

/**
 * Team-name similarity for normalized names. A name whose words all appear in the other name
 * counts as a match, so "ceske budejovice" matches "motor ceske budejovice".
 * For individual sports (`individual: true`), also counts initial + surname matching.
 */
export function teamSimilarity(a: string, b: string, options?: { individual?: boolean }): number {
  const direct = nameSimilarity(a, b);
  if (!a || !b) return direct;

  let best = direct;
  const first = a.split(" ");
  const second = b.split(" ");
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length >= 2) {
    const longerWords = new Set(longer);
    if (shorter.every((word) => longerWords.has(word))) {
      best = Math.max(best, CONTAINED_NAME_SCORE);
    }
  }

  if (options?.individual) {
    best = Math.max(best, personSimilarity(a, b));
  }

  return best;
}

/** Age group written in raw text ("U19", "U-19", "Under 19", "(U19)", "(19)", "до 19") as "u19", or null. */
export function ageGroupOf(text: string): string | null {
  const lower = text.toLowerCase();
  const prefixed = lower.match(/(?:^|[^\p{L}\p{N}])(?:u[\s-]?|under[\s-]?|до[\s-]+)(\d{1,2})(?=[^\p{L}\p{N}]|$)/u);
  if (prefixed) return `u${Number(prefixed[1])}`;

  const parenAge = lower.match(/\(\s*(1[4-9]|2[0-3])\s*\)/);
  if (parenAge) return `u${Number(parenAge[1])}`;

  return null;
}

/**
 * The single age group an event carries, taken from its league or team names.
 * Returns null when no age group is given, or when the names disagree (for example U18 and U20).
 */
export function eventAgeGroup(event: NormalizedEvent): string | null {
  const groups = new Set<string>();
  const texts = [event.leagueName.en, event.leagueName.ru, event.home.en, event.home.ru, event.away.en, event.away.ru];
  for (const text of texts) {
    const group = ageGroupOf(text);
    if (group) groups.add(group);
  }
  return groups.size === 1 ? [...groups][0] : null;
}
