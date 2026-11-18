"use client";

import { useMemo, useState } from "react";
import type { Dict, Lang } from "@/lib/i18n";
import { pick, sportIcon, type LeagueFacet } from "@/lib/matches-types";

/**
 * Tournaments of the selected sports. A tournament shown with a tick is included; click to hide it.
 */
export function LeagueFilter({
  leagues,
  hidden,
  lang,
  t,
  onToggle,
  onShowAll,
}: {
  leagues: LeagueFacet[];
  hidden: string[];
  lang: Lang;
  t: Dict;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return leagues;
    return leagues.filter((league) => `${league.name.en} ${league.name.ru}`.toLowerCase().includes(term));
  }, [leagues, query]);

  if (leagues.length === 0) return null;

  const shownCount = leagues.filter((league) => !hiddenSet.has(league.key)).length;

  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.tournamentsTitle}</p>
          <p className="text-xs text-slate-500">{t.tournamentsShown(shownCount, leagues.length)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.filterTournaments}
            className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <button
            type="button"
            onClick={onShowAll}
            disabled={hidden.length === 0}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.showAllTournaments}
          </button>
        </div>
      </div>

      <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
        {filtered.map((league) => {
          const shown = !hiddenSet.has(league.key);
          return (
            <button
              key={league.key}
              type="button"
              aria-pressed={shown}
              onClick={() => onToggle(league.key)}
              className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                shown
                  ? "bg-white text-slate-800 ring-1 ring-inset ring-emerald-300 hover:bg-emerald-50"
                  : "bg-slate-100 text-slate-400 line-through ring-1 ring-inset ring-slate-200 hover:bg-slate-200"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                  shown ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent"
                }`}
              >
                ✓
              </span>
              <span aria-hidden>{sportIcon(league.sportKey)}</span>
              <span className="truncate">{pick(league.name, lang)}</span>
              <span className="shrink-0 opacity-70">({league.count})</span>
            </button>
          );
        })}
        {filtered.length === 0 ? <p className="text-sm text-slate-500">{t.noTournaments}</p> : null}
      </div>
    </div>
  );
}
