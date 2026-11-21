import type { LocalizedText } from "./model";

export type StageOrigin = "feed" | "title";

export type TournamentStage = {
  label: LocalizedText;
  origin: StageOrigin;
};

export type MatchVenueInfo = {
  country?: string;
  city?: string;
  stadium?: string;
  venueRaw?: string;
  surface?: LocalizedText;
  weather?: string;
  temperature?: string;
  wind?: string;
  humidity?: string;
  note?: string;
};

export type StageExtractInput = {
  leagueEn: string;
  leagueRu?: string;
  feedHints?: (string | number | null | undefined)[];
};

export type VenueExtractInput = {
  country?: string | null;
  locationRaw?: string | null;
  city?: string | null;
  stadium?: string | null;
  surface?: string | null;
  temperature?: string | null;
  weather?: string | null;
  windSpeed?: string | null;
  windDir?: string | null;
  humidity?: string | null;
  note?: string | null;
};

const NON_COUNTRY_REGIONS = new Set([
  "world",
  "international",
  "international clubs",
  "international youth",
  "europe",
  "asia",
  "africa",
  "north america",
  "south america",
  "america",
  "oceania",
  "other",
  "others",
  "simulated",
  "srl",
  "srl matches",
  "virtual",
  "e-sports",
  "esports",
  "cybersport",
  "short football",
  "alternative",
  "friendly",
  "friendlies",
  "olympics",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const NON_COUNTRY_PATTERN =
  /^(?:world|international|esports?|e-?sports?|efootball|e-?football|e-?soccer|e-?basketball|ecup|virtual|simulated|srl|cyber|friendly|friendlies|sis\b|electronic|short\s+football|alternative|womens?|men)/i;

const NON_COUNTRY_KEYWORDS =
  /\b(?:gaming|league|leagues|cup|series|tour|championship|division|circuit|club|clubs|open|masters|challenger|itf|atp|wta|nba|nhl|nfl|mlb|fifa|uefa|fiba|esl|pgl|blast|pro\s+league|penalty\s+kicks|drag\s+racing|esports?|e-?sports?|footballl?|soccer|basketball|tennis|hockey|volleyball|handball|cyber|arena|battle)\b/i;

export function cleanCountryName(raw: string | null | undefined): string | undefined {
  const clean = normalizeText(raw);
  if (!clean) return undefined;
  const lower = clean.toLowerCase();
  if (NON_COUNTRY_REGIONS.has(lower)) return undefined;
  if (NON_COUNTRY_PATTERN.test(clean) || NON_COUNTRY_KEYWORDS.test(clean)) return undefined;
  return clean;
}

const SURFACE_MAP: { pattern: RegExp; label: LocalizedText }[] = [
  { pattern: /\b(?:indoor\s*hard|hard\s*indoor)\b/i, label: { en: "Indoor Hard", ru: "Хард (зал)" } },
  { pattern: /\b(?:hard|хард)\b/iu, label: { en: "Hard", ru: "Хард" } },
  { pattern: /\b(?:clay|грунт)\b/iu, label: { en: "Clay", ru: "Грунт" } },
  { pattern: /\b(?:grass|трава)\b/iu, label: { en: "Grass", ru: "Трава" } },
  { pattern: /\b(?:carpet|ковер|ковёр)\b/iu, label: { en: "Carpet", ru: "Ковёр" } },
  { pattern: /\b(?:synthetic|artificial\s*turf|turf)\b/i, label: { en: "Artificial turf", ru: "Искусственный газон" } },
];

function translateSurface(raw: string | null | undefined): LocalizedText | undefined {
  const clean = normalizeText(raw);
  if (!clean) return undefined;
  for (const item of SURFACE_MAP) {
    if (item.pattern.test(clean)) return item.label;
  }
  return { en: clean, ru: clean };
}

function translateSingleStagePart(part: string): LocalizedText | null {
  const clean = normalizeText(part);
  if (!clean) return null;

  // Ignore pure format specs ("4x10 min", "BO3", "7 Games Match") or URLs.
  if (/^https?:\/\//i.test(clean)) return null;
  if (/^\d+\s*[xх×]\s*\d+\s*(?:min|мин)?$/iu.test(clean)) return null;
  if (/^\d+\s*(?:halves|quarters|periods|games?\s+match)\b/i.test(clean)) return null;

  const fraction = clean.match(/\b1\s*\/\s*(2|4|8|16|32|64)\s*(?:finals?|финал(?:а|ов)?)?\b/iu);
  if (fraction) {
    const denom = Number(fraction[1]);
    if (denom === 2) return { en: "Semifinals", ru: "Полуфинал" };
    if (denom === 4) return { en: "Quarterfinals", ru: "Четвертьфинал" };
    return { en: `1/${denom} Final`, ru: `1/${denom} финала` };
  }

  if (/\b(?:grand\s*finals?|гранд[-\s]*финал)\b/iu.test(clean)) {
    return { en: "Grand Final", ru: "Гранд-финал" };
  }
  if (/\b(?:3rd|third)\s*place\b|\bbronze\s*(?:medal|match)\b|за\s*3-?е\s*место/iu.test(clean)) {
    return { en: "3rd Place Match", ru: "Матч за 3-е место" };
  }
  if (/\b(?:semi[-\s]?finals?|полуфинал(?:ы|а)?)\b/iu.test(clean)) {
    return { en: "Semifinals", ru: "Полуфинал" };
  }
  if (/\b(?:quarter[-\s]?finals?|четвертьфинал(?:ы|а)?)\b/iu.test(clean)) {
    return { en: "Quarterfinals", ru: "Четвертьфинал" };
  }
  if (/\bround\s*of\s*(8|16|32|64|128)\b/i.test(clean)) {
    const n = Number(clean.match(/\bround\s*of\s*(\d+)\b/i)![1]);
    if (n === 8) return { en: "Round of 8 (1/4)", ru: "1/4 финала (Round of 8)" };
    return { en: `Round of ${n}`, ru: `1/${n / 2} финала` };
  }
  if (/\b(?:play[-\s]?offs?|плей[-\s]?офф)\b/iu.test(clean)) {
    return { en: "Play-offs", ru: "Плей-офф" };
  }
  if (/\b(?:play[-\s]?in|плей[-\s]?ин)\b/iu.test(clean)) {
    return { en: "Play-In", ru: "Плей-ин" };
  }
  if (/\b(?:regular\s*season|регулярн(?:ый|ого)\s*сезон(?:а)?)\b/iu.test(clean)) {
    return { en: "Regular Season", ru: "Регулярный сезон" };
  }
  if (/\b(?:group\s*stage|группов(?:ой|ого)\s*этап(?:а)?)\b/iu.test(clean)) {
    return { en: "Group Stage", ru: "Групповой этап" };
  }
  const groupLetter = clean.match(/\b(?:group|группа)\s+([A-H1-8])\b/iu);
  if (groupLetter) {
    const g = groupLetter[1].toUpperCase();
    return { en: `Group ${g}`, ru: `Группа ${g}` };
  }
  if (/\b(?:qualif(?:ication|iers|ying)|квалификац(?:ия|ии))\b/iu.test(clean)) {
    return { en: "Qualification", ru: "Квалификация" };
  }
  if (/\b(?:main\s*draw|основн(?:ая|ой)\s*сетк(?:а|е))\b/iu.test(clean)) {
    return { en: "Main Draw", ru: "Основная сетка" };
  }
  if (/\b(?:relegation|promotion\s*playoff|стыков(?:ые|ых)\s*матч(?:и|ей)?)\b/iu.test(clean)) {
    return { en: "Relegation / Play-out", ru: "Стыковые матчи" };
  }
  if (/\b(?:pre[-\s]?season|предсезон(?:ка|ный))\b/iu.test(clean)) {
    return { en: "Pre-season", ru: "Предсезонка" };
  }
  if (/\b(?:exhibition|friendly\s*match|товарищеск(?:ий|ие)\s*матч)\b/iu.test(clean)) {
    return { en: "Exhibition", ru: "Товарищеский" };
  }

  const tour = clean.match(/\b(?:tour|matchday|gameweek|week)\s*#?\s*(\d{1,2})\b|(?:^|\s)тур\s*#?\s*(\d{1,2})\b/iu);
  if (tour) {
    const n = tour[1] ?? tour[2];
    const isWeek = /\b(?:week|gameweek)\b/i.test(clean);
    return isWeek
      ? { en: `Week ${n}`, ru: `Неделя ${n}` }
      : { en: `Tour ${n}`, ru: `Тур ${n}` };
  }

  const roundNum = clean.match(/\b(?:round|раунд)\s*#?\s*(\d{1,2})\b/iu);
  if (roundNum) {
    return { en: `Round ${roundNum[1]}`, ru: `Раунд ${roundNum[1]}` };
  }

  const ordRound = clean.match(/\b(\d)(?:st|nd|rd|th)\s+round\b/i);
  if (ordRound) {
    return { en: `Round ${ordRound[1]}`, ru: `Раунд ${ordRound[1]}` };
  }

  const stageNum = clean.match(/\b(?:stage|этап)\s*#?\s*(\d{1,2})\b/iu);
  if (stageNum) {
    return { en: `Stage ${stageNum[1]}`, ru: `Этап ${stageNum[1]}` };
  }

  const legNum = clean.match(/\b(?:leg|матч)\s*(1|2)\b|\b(1st|2nd)\s+leg\b/i);
  if (legNum) {
    const leg = legNum[1] ?? (legNum[2]?.startsWith("1") ? "1" : "2");
    return { en: `Leg ${leg}`, ru: `${leg}-й матч` };
  }

  // Trailing standalone "Final" / "Finals" (checked after Semi-final, Quarter-final, Grand Final).
  if (/(?:^|\.\s*|-\s*|\bthe\s+)(?:finals?|финал)(?:$|\s*\.)/iu.test(clean)) {
    return { en: "Final", ru: "Финал" };
  }

  return null;
}

function isIgnoredStageHint(clean: string): boolean {
  if (/^https?:\/\//i.test(clean)) return true;
  if (/^#?\d+$/.test(clean)) return true;
  if (/^\d+\s*[xх×]\s*\d+\s*(?:min|мин)?$/iu.test(clean)) return true;
  if (/^bo\s*\d+$/i.test(clean)) return true;
  if (/^\d+\s*(?:halves|quarters|periods|sets|maps|frames|games?\s+match)\b/i.test(clean)) return true;
  if (/^srl\b/i.test(clean)) return true;
  if (/^(?:regular|match|game|normal)$/i.test(clean)) return true;
  return false;
}

function translateStageText(raw: string, allowRawFallback: boolean): LocalizedText | null {
  const clean = normalizeText(raw);
  if (!clean || isIgnoredStageHint(clean)) return null;

  // Handle compound feed stage labels like "Play-off. Round 1" or "Group Stage. Tour 4".
  const parts = clean.split(/\s*[.;/]\s*/).filter(Boolean);
  if (parts.length > 1) {
    const translated = parts.map(translateSingleStagePart).filter((x): x is LocalizedText => x !== null);
    if (translated.length > 0) {
      // Deduplicate consecutive identical parts.
      const dedupEn: string[] = [];
      const dedupRu: string[] = [];
      for (const item of translated) {
        if (dedupEn[dedupEn.length - 1] !== item.en) dedupEn.push(item.en);
        if (dedupRu[dedupRu.length - 1] !== item.ru) dedupRu.push(item.ru);
      }
      return { en: dedupEn.join(" · "), ru: dedupRu.join(" · ") };
    }
  }

  const single = translateSingleStagePart(clean);
  if (single) return single;

  if (
    allowRawFallback &&
    clean.length <= 42 &&
    !parts.every(isIgnoredStageHint) &&
    /[a-zA-Zа-яА-ЯёЁ]/u.test(clean)
  ) {
    // Reject strings containing match format specs like "(4x5min)" or "(2x4 min)" or Best of N.
    if (!/\b\d+\s*[xх×]\s*\d+\s*(?:min|мин)?/iu.test(clean) && !/\bbest\s*of\s*\d+\b/i.test(clean)) {
      return { en: clean, ru: clean };
    }
  }
  return null;
}

export function extractTournamentStage(input: StageExtractInput): TournamentStage | null {
  const leagueNorm = normalizeText(input.leagueEn).toLowerCase();
  // 1. Direct feed stage fields (e.g. 1xBet MIO.TSt, Vbet game.round / add_info_name, Betcity comment_ev)
  for (const hint of input.feedHints ?? []) {
    if (hint === null || hint === undefined) continue;
    if (typeof hint === "number" && Number.isInteger(hint) && hint >= 1 && hint <= 99) {
      return { label: { en: `Round ${hint}`, ru: `Тур ${hint}` }, origin: "feed" };
    }
    const str = normalizeText(String(hint));
    if (!str) continue;
    const isSameAsLeague = leagueNorm.includes(str.toLowerCase()) && !translateStageText(str, false);
    if (isSameAsLeague) continue;
    const translated = translateStageText(str, true);
    if (translated) return { label: translated, origin: "feed" };
  }

  // 2. Explicit stage inside tournament / league name
  for (const text of [input.leagueEn, input.leagueRu]) {
    if (!text) continue;
    // Check dot-separated segments right-to-left (most specific stage segment sits at the tail)
    const segments = text.split(/\s*\.\s*/).filter(Boolean).reverse();
    const matched: LocalizedText[] = [];
    for (const seg of segments) {
      const parsed = translateStageText(seg, false);
      if (parsed) matched.unshift(parsed);
    }
    if (matched.length > 0) {
      const enParts: string[] = [];
      const ruParts: string[] = [];
      for (const item of matched) {
        if (!enParts.includes(item.en)) enParts.push(item.en);
        if (!ruParts.includes(item.ru)) ruParts.push(item.ru);
      }
      return {
        label: { en: enParts.join(" · "), ru: ruParts.join(" · ") },
        origin: "title",
      };
    }
  }

  return null;
}

export function pickBestTournamentStage(
  a: TournamentStage | null | undefined,
  b: TournamentStage | null | undefined,
): TournamentStage | null {
  if (!a) return b ?? null;
  if (!b) return a;
  if (a.origin === "feed" && b.origin !== "feed") return a;
  if (b.origin === "feed" && a.origin !== "feed") return b;
  return b.label.en.length > a.label.en.length ? b : a;
}

export function serializeTournamentStage(stage: TournamentStage | null | undefined): string | null {
  return stage ? JSON.stringify(stage) : null;
}

export function parseStoredTournamentStage(raw: string | null | undefined): TournamentStage | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TournamentStage>;
    if (
      typeof parsed?.label?.en === "string" &&
      typeof parsed?.label?.ru === "string" &&
      (parsed.origin === "feed" || parsed.origin === "title")
    ) {
      return parsed as TournamentStage;
    }
  } catch {
    // Ignore malformed stored stage JSON.
  }
  return null;
}

/** Splits "BayArena (Leverkusen)" -> { stadium: "BayArena", city: "Leverkusen" }. */
export function parseVenueLocation(locationRaw: string | null | undefined): {
  stadium?: string;
  city?: string;
  venueRaw?: string;
} {
  const clean = normalizeText(locationRaw);
  if (!clean) return {};
  const match = clean.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (match) {
    const stadium = normalizeText(match[1]);
    const city = normalizeText(match[2]);
    if (stadium && city) return { stadium, city };
  }
  return { venueRaw: clean };
}

export function extractMatchVenueInfo(input: VenueExtractInput): MatchVenueInfo | null {
  const info: MatchVenueInfo = {};

  const country = cleanCountryName(input.country);
  if (country) info.country = country;

  const parsedLoc = parseVenueLocation(input.locationRaw);
  const stadium = normalizeText(input.stadium) || parsedLoc.stadium;
  const city = normalizeText(input.city) || parsedLoc.city;
  if (stadium) info.stadium = stadium;
  if (city) info.city = city;
  if (!stadium && !city && parsedLoc.venueRaw) {
    info.venueRaw = parsedLoc.venueRaw;
  }

  const surface = translateSurface(input.surface);
  if (surface) info.surface = surface;

  const temperature = normalizeText(input.temperature);
  if (temperature) info.temperature = temperature;

  const weather = normalizeText(input.weather);
  if (weather) info.weather = weather;

  const windSpeed = normalizeText(input.windSpeed);
  const windDir = normalizeText(input.windDir);
  if (windSpeed) {
    const dirShort = windDir ? windDir.replace(/wind.*$/i, "").trim() : "";
    info.wind = [dirShort, `${windSpeed} m/s`].filter(Boolean).join(" ");
  }

  const rawHum = normalizeText(input.humidity);
  if (rawHum) {
    info.humidity = rawHum.includes("%") ? rawHum : `${rawHum}%`;
  }

  const note = normalizeText(input.note);
  if (note && !/^https?:\/\//i.test(note) && !/^srl\b/i.test(note)) {
    info.note = note;
  }

  return Object.keys(info).length > 0 ? info : null;
}

export function mergeMatchVenueInfo(
  a: MatchVenueInfo | null | undefined,
  b: MatchVenueInfo | null | undefined,
): MatchVenueInfo | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const merged: MatchVenueInfo = {
    ...(a.country || b.country ? { country: a.country || b.country } : {}),
    ...(a.city || b.city ? { city: a.city || b.city } : {}),
    ...(a.stadium || b.stadium ? { stadium: a.stadium || b.stadium } : {}),
    ...(!a.stadium && !b.stadium && (a.venueRaw || b.venueRaw) ? { venueRaw: a.venueRaw || b.venueRaw } : {}),
    ...(a.surface || b.surface ? { surface: a.surface || b.surface } : {}),
    ...(a.temperature || b.temperature ? { temperature: a.temperature || b.temperature } : {}),
    ...(a.weather || b.weather ? { weather: a.weather || b.weather } : {}),
    ...(a.wind || b.wind ? { wind: a.wind || b.wind } : {}),
    ...(a.humidity || b.humidity ? { humidity: a.humidity || b.humidity } : {}),
    ...(a.note || b.note ? { note: a.note || b.note } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

export function serializeMatchVenueInfo(info: MatchVenueInfo | null | undefined): string | null {
  return info ? JSON.stringify(info) : null;
}

export function parseStoredMatchVenueInfo(raw: string | null | undefined): MatchVenueInfo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MatchVenueInfo;
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
      return parsed;
    }
  } catch {
    // Ignore malformed stored venue JSON.
  }
  return null;
}
