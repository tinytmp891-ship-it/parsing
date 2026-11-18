/**
 * Shared types and helpers for all bookmaker sources:
 * a normalized event shape, sport canonicalization and team-name similarity.
 */

export type SourceId = "1xbet" | "fonbet" | "bet365" | "marathon" | "vbet" | "bwin" | "stake" | "pinnacle";

export const SOURCE_IDS: readonly SourceId[] = [
  "1xbet",
  "fonbet",
  "bet365",
  "marathon",
  "vbet",
  "bwin",
  "stake",
  "pinnacle",
];

export const SOURCE_LABELS: Record<SourceId, string> = {
  "1xbet": "1xBet",
  fonbet: "Fonbet",
  bet365: "bet365",
  marathon: "Marathonbet",
  vbet: "Vbet",
  bwin: "bwin",
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
  volleyball: { en: "Volleyball", ru: "Волейбол" },
  "table-tennis": { en: "Table Tennis", ru: "Настольный теннис" },
  cricket: { en: "Cricket", ru: "Крикет" },
  "american-football": { en: "American Football", ru: "Американский футбол" },
  esports: { en: "Esports", ru: "Киберспорт" },
  handball: { en: "Handball", ru: "Гандбол" },
  futsal: { en: "Futsal", ru: "Футзал" },
  baseball: { en: "Baseball", ru: "Бейсбол" },
  rugby: { en: "Rugby", ru: "Регби" },
  boxing: { en: "Boxing", ru: "Бокс" },
  mma: { en: "MMA / UFC", ru: "ММА / UFC" },
  badminton: { en: "Badminton", ru: "Бадминтон" },
  darts: { en: "Darts", ru: "Дартс" },
  snooker: { en: "Snooker", ru: "Снукер" },
  billiards: { en: "Billiards", ru: "Бильярд" },
  "water-polo": { en: "Water Polo", ru: "Водное поло" },
  golf: { en: "Golf", ru: "Гольф" },
  chess: { en: "Chess", ru: "Шахматы" },
  "formula-1": { en: "Formula 1", ru: "Формула 1" },
  "horse-racing": { en: "Horse Racing", ru: "Конный спорт" },
  floorball: { en: "Floorball", ru: "Флорбол" },
  bandy: { en: "Bandy", ru: "Бенди" },
  biathlon: { en: "Biathlon", ru: "Биатлон" },
  "alpine-skiing": { en: "Alpine Skiing", ru: "Горные лыжи" },
  sumo: { en: "Sumo", ru: "Сумо" },
};

/** Source sport names that map to a different canonical key. */
const SPORT_ALIASES: Record<string, string> = {
  hockey: "ice-hockey",
  "mix. fights": "mma",
  mma: "mma",
  ufc: "mma",
  billiard: "billiards",
  "alpine ski": "alpine-skiing",
  soccer: "football",
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

/** Lowercase, strip accents and punctuation, and drop bracketed nicknames and club prefixes. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(fc|cf|sc|ac|afc)\b/g, " ")
    // Age groups ("U20", "U-20", "Under 20") are ignored, so "Dukla Jihlava U20" and "Dukla Jihlava" are one team.
    .replace(/\b(?:u|under) ?\d{1,2}\b/g, " ")
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

/**
 * Team-name similarity for normalized names. A name whose words all appear in the other name
 * counts as a match, so "ceske budejovice" matches "motor ceske budejovice".
 */
export function teamSimilarity(a: string, b: string): number {
  const direct = nameSimilarity(a, b);
  if (!a || !b) return direct;
  const first = a.split(" ");
  const second = b.split(" ");
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length < 2) return direct;
  const longerWords = new Set(longer);
  return shorter.every((word) => longerWords.has(word)) ? Math.max(direct, CONTAINED_NAME_SCORE) : direct;
}

/** Age group written in raw text ("U20", "U-20", "Under 20") as "u20", or null. */
export function ageGroupOf(text: string): string | null {
  const match = text.toLowerCase().match(/\b(?:u[\s-]?|under[\s-]?)(\d{1,2})\b/);
  return match ? `u${Number(match[1])}` : null;
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
