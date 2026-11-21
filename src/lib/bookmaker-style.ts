import { normalizeHex } from "./match-colors";
import { SOURCE_IDS, type SourceId } from "./sources/model";

/**
 * Per-bookmaker colour (used for stars and labels) and optional icon image link.
 * Stored in the browser; values are validated before they are used.
 */

export type BookmakerStyle = { color: string; iconUrl: string };
export type BookmakerStyles = Record<SourceId, BookmakerStyle>;

export const BOOKMAKER_IDS: readonly SourceId[] = SOURCE_IDS;

export const DEFAULT_BOOKMAKER_COLORS: Record<SourceId, string> = {
  "1xbet": "#0284c7",
  fonbet: "#7c3aed",
  betcity: "#2563eb",
  marathon: "#65a30d",
  vbet: "#ea580c",
  unibet: "#16a34a",
  netbet: "#0f766e",
  bcgame: "#10b981",
  parimatch: "#ca8a04",
  oddsportal: "#0891b2",
  oddspedia: "#9333ea",
  bet365: "#0d9488",
  bwin: "#db2777",
  totogaming: "#dc2626",
  stake: "#4f46e5",
  pinnacle: "#f43f5e",
};

const FALLBACK_COLOR = "#64748b";
const MAX_ICON_URL_LENGTH = 500;

export function defaultBookmakerStyles(): BookmakerStyles {
  const styles = {} as BookmakerStyles;
  for (const id of BOOKMAKER_IDS) styles[id] = { color: DEFAULT_BOOKMAKER_COLORS[id], iconUrl: "" };
  return styles;
}

/** Accepts only full http:// or https:// image links. Anything else becomes "" (no icon). */
export function normalizeIconUrl(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ICON_URL_LENGTH || /\s/.test(trimmed)) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : "";
  } catch {
    return "";
  }
}

/** Rebuilds the full settings object from stored data, replacing anything invalid with defaults. */
export function normalizeBookmakerStyles(raw: unknown): BookmakerStyles {
  const styles = defaultBookmakerStyles();
  if (typeof raw !== "object" || raw === null) return styles;

  const record = raw as Record<string, unknown>;
  for (const id of BOOKMAKER_IDS) {
    const entry = record[id];
    if (typeof entry !== "object" || entry === null) continue;
    const fields = entry as { color?: unknown; iconUrl?: unknown };
    styles[id] = {
      color: normalizeHex(typeof fields.color === "string" ? fields.color : null, DEFAULT_BOOKMAKER_COLORS[id]),
      iconUrl: normalizeIconUrl(typeof fields.iconUrl === "string" ? fields.iconUrl : null),
    };
  }
  return styles;
}

function isBookmakerId(id: string): id is SourceId {
  return (BOOKMAKER_IDS as readonly string[]).includes(id);
}

/** Style for a bookmaker id; unknown ids get a neutral grey so nothing breaks. */
export function styleOf(styles: BookmakerStyles, id: string): BookmakerStyle {
  return isBookmakerId(id) ? styles[id] : { color: FALLBACK_COLOR, iconUrl: "" };
}
