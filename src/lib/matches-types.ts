import type { Lang } from "./i18n";

/** Types and helpers shared by the matches page components. */

export type LocalizedText = { en: string; ru: string };
export type Relation = "primary" | "full" | "partial";
export type Theme = "light" | "dark";
export type Tab = "upcoming" | "started";
export type View = "bubbles" | "table";
export type MatchType = "single" | "full" | "partial";

export type Entry = {
  id: string;
  startsAt: string;
  sportKey: string;
  sportName: LocalizedText;
  leagueName: LocalizedText;
  home: LocalizedText;
  away: LocalizedText;
  matchType: MatchType;
  sources: {
    source: string;
    externalId: string;
    home: LocalizedText;
    away: LocalizedText;
    league: LocalizedText;
    relation: Relation;
    sourceHost: string | null;
  }[];
};

export type Slot = { minute: number; startsAt: number; time: string; entries: Entry[] };
export type Day = { key: string; label: string; count: number; slots: Slot[] };

export type SportFacet = { key: string; name: LocalizedText; count: number };

export type LeagueFacet = { key: string; sportKey: string; name: LocalizedText; count: number };

export type GroupBy = "time" | "tournament";

export type TournamentRow = { entry: Entry; startsAt: number; time: string; date: string };

export type TournamentGroup = {
  key: string;
  sportKey: string;
  sportName: LocalizedText;
  leagueName: LocalizedText;
  count: number;
  startsAt: number;
  rows: TournamentRow[];
};

export type BookmakerFacet = {
  id: string;
  label: string;
  count: number;
  selected: boolean;
  lastStatus: string | null;
  lastError: string | null;
};

export type SyncState = "idle" | "loading" | "fetching" | "finishing" | "done" | "failed" | "unavailable";

export type SyncSource = {
  id: string;
  label: string;
  state: SyncState;
  startedAt: string | null;
  tasksTotal: number;
  tasksDone: number;
  tasksFailed: number;
  eventsSaved: number;
  error: string | null;
  unavailableUntil: string | null;
  lastRun: {
    id: number;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    matchesCount: number;
    error: string | null;
    sourceDomain: string | null;
  } | null;
};

export type SyncStatus = {
  running: boolean;
  startedAt: string | null;
  sources: SyncSource[];
  feedHealth: {
    lastGoodDomain: string | null;
    domains: { domain: string; ok: boolean | null; error: string | null }[];
  };
};

export type ApiResponse = {
  tab: Tab;
  range: { from: string; to: string };
  total: number;
  truncated: boolean;
  entries: Entry[];
  facets: { sports: SportFacet[]; bookmakers: BookmakerFacet[]; leagues: LeagueFacet[] };
  coverageUntil: string | null;
  sync: SyncStatus;
  generatedAt: string;
};

export const SOURCE_NAMES: Record<string, string> = {
  "1xbet": "1xBet",
  fonbet: "Fonbet",
  bet365: "bet365",
  marathon: "Marathonbet",
  vbet: "Vbet",
  bwin: "bwin",
  stake: "Stake",
  pinnacle: "Pinnacle",
};

export const SOURCE_SITES: Record<string, string> = {
  "1xbet": "https://1xbet.com",
  fonbet: "https://fonbet.by",
  bet365: "https://www.bet365.com",
  marathon: "https://www.marathonbet.com",
  vbet: "https://sport.vbet.am",
  bwin: "https://www.bwin.com",
  stake: "https://stake.com/sports/",
  pinnacle: "https://www.pinnacle.com/en/hockey/matchups/",
};

export const SOURCE_STYLES: Record<string, string> = {
  "1xbet": "bg-sky-100 text-sky-800 ring-sky-200",
  fonbet: "bg-violet-100 text-violet-800 ring-violet-200",
  bet365: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  marathon: "bg-lime-100 text-lime-800 ring-lime-200",
  vbet: "bg-orange-100 text-orange-800 ring-orange-200",
  bwin: "bg-slate-200 text-slate-800 ring-slate-300",
  stake: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  pinnacle: "bg-rose-100 text-rose-800 ring-rose-200",
};

export const STATUS_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-500",
  failed: "bg-rose-500",
  never: "bg-slate-400",
};

/** Solid accent for time-group bubbles, cycled so neighbouring groups are easy to tell apart. */
export const ACCENT_BAR = ["bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-amber-500"];

const SPORT_ICONS: Record<string, string> = {
  football: "⚽",
  futsal: "⚽",
  "e-football": "🎮",
  "ice-hockey": "🏒",
  bandy: "🏒",
  tennis: "🎾",
  squash: "🎾",
  basketball: "🏀",
  "e-basketball": "🎮",
  volleyball: "🏐",
  "table-tennis": "🏓",
  cricket: "🏏",
  "american-football": "🏈",
  esports: "🎮",
  handball: "🤾",
  baseball: "⚾",
  rugby: "🏉",
  "rugby-union": "🏉",
  "rugby-league": "🏉",
  boxing: "🥊",
  mma: "🥋",
  badminton: "🏸",
  darts: "🎯",
  snooker: "🎱",
  billiards: "🎱",
  pool: "🎱",
  golf: "⛳",
  chess: "♟️",
  "formula-1": "🏎️",
  "horse-racing": "🏇",
  floorball: "🏑",
  biathlon: "🎿",
  "alpine-skiing": "⛷️",
  sumo: "🤼",
  "water-polo": "🤽",
};

export function sportIcon(key: string): string {
  return SPORT_ICONS[key] ?? "🏅";
}

export function pick(text: LocalizedText, lang: Lang): string {
  return text[lang] || text.en;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalInput(date: Date): string {
  return `${dayKeyOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function sourceUrl(source: { source: string; sourceHost: string | null }): string {
  if (source.source === "1xbet" && source.sourceHost) return `https://${source.sourceHost}`;
  return SOURCE_SITES[source.source] ?? "#";
}

export function statusOf(lastStatus: string | null): "ok" | "partial" | "failed" | "never" {
  if (lastStatus === "success") return "ok";
  if (lastStatus === "partial") return "partial";
  if (lastStatus === "failed") return "failed";
  return "never";
}
