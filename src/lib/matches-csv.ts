import { dictionaries, type Lang } from "./i18n";
import { pad, pick, SOURCE_NAMES, type Entry } from "./matches-types";

const HEADERS: Record<Lang, string[]> = {
  en: ["Date", "Time", "Start (UTC)", "Sport", "Format", "Stage", "Venue", "League", "Home", "Away", "Match type", "Bookmakers", "Bookmaker names", "Bookmaker IDs"],
  ru: ["Дата", "Время", "Начало (UTC)", "Вид спорта", "Формат", "Этап", "Место", "Лига", "Хозяева", "Гости", "Тип совпадения", "Букмекеры", "Названия у букмекеров", "ID у букмекеров"],
};

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Builds a UTF-8 CSV (with a BOM so Excel shows Cyrillic correctly), one row per match. */
export function buildMatchesCsv(entries: Entry[], lang: Lang): string {
  const t = dictionaries[lang];
  const rows = entries.map((entry) => {
    const starts = new Date(entry.startsAt);
    const bookmakers = entry.sources.map((source) => SOURCE_NAMES[source.source] ?? source.source);
    const names = entry.sources.map(
      (source) => `${SOURCE_NAMES[source.source] ?? source.source}: ${pick(source.home, lang)} - ${pick(source.away, lang)}`,
    );
    const ids = entry.sources.map((source) => `${SOURCE_NAMES[source.source] ?? source.source} ${source.externalId}`);
    const matchType =
      entry.matchType === "partial" ? t.typePartial : entry.matchType === "full" ? t.typeFull : t.typeSingle;
    const venueSummary = entry.matchInfo
      ? [entry.matchInfo.stadium || entry.matchInfo.venueRaw, entry.matchInfo.city, entry.matchInfo.country]
          .filter(Boolean)
          .join(", ")
      : "";

    return [
      `${starts.getFullYear()}-${pad(starts.getMonth() + 1)}-${pad(starts.getDate())}`,
      `${pad(starts.getHours())}:${pad(starts.getMinutes())}`,
      entry.startsAt,
      pick(entry.sportName, lang),
      entry.matchFormat ? `${entry.matchFormat.code} (${pick(entry.matchFormat.label, lang)})` : "",
      entry.tournamentStage ? pick(entry.tournamentStage.label, lang) : "",
      venueSummary,
      pick(entry.leagueName, lang),
      pick(entry.home, lang),
      pick(entry.away, lang),
      matchType,
      bookmakers.join(", "),
      names.join("; "),
      ids.join("; "),
    ];
  });

  const lines = [HEADERS[lang], ...rows].map((row) => row.map(escapeCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Saves text as a file in the browser. Call only from event handlers. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
