"use client";

import { useMemo, useState } from "react";
import { Check, RotateCcw, Search } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";
import { pick, sportIcon, type LeagueFacet, type LocalizedText } from "@/lib/matches-types";

export type HiddenLeague = {
  key: string;
  sportKey: string;
  name: LocalizedText;
};

/**
 * Tournaments of the selected sports. Clicking a tournament hides it permanently (persisted in localStorage);
 * clicking a hidden tournament or using the restore list returns it.
 */
export function LeagueFilter({
  leagues,
  selectedSportKeys,
  hiddenLeagues,
  lang,
  t,
  onToggle,
  onRestoreAll,
}: {
  leagues: LeagueFacet[];
  selectedSportKeys: string[];
  hiddenLeagues: HiddenLeague[];
  lang: Lang;
  t: Dict;
  onToggle: (league: HiddenLeague) => void;
  onRestoreAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const hiddenMap = useMemo(() => new Map(hiddenLeagues.map((h) => [h.key, h])), [hiddenLeagues]);

  const combined = useMemo(() => {
    const map = new Map<string, LeagueFacet>();
    for (const league of leagues) map.set(league.key, league);
    for (const h of hiddenLeagues) {
      if (selectedSportKeys.includes(h.sportKey) && !map.has(h.key)) {
        map.set(h.key, { key: h.key, sportKey: h.sportKey, name: h.name, count: 0 });
      }
    }
    return [...map.values()];
  }, [leagues, hiddenLeagues, selectedSportKeys]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return combined;
    return combined.filter((league) => `${league.name.en} ${league.name.ru}`.toLowerCase().includes(term));
  }, [combined, query]);

  if (combined.length === 0) return null;

  const shownCount = combined.filter((league) => !hiddenMap.has(league.key)).length;
  const hiddenInSelection = combined.filter((league) => hiddenMap.has(league.key)).length;

  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.tournamentsTitle}</p>
          <p className="text-xs tabular-nums text-slate-500">{t.tournamentsShown(shownCount, combined.length)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.filterTournaments}
              className="ui-accent-input w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>
          <button
            type="button"
            onClick={onRestoreAll}
            disabled={hiddenInSelection === 0}
            className="ui-control bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.showAllTournaments}
          </button>
        </div>
      </div>

      <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
        {filtered.map((league) => {
          const shown = !hiddenMap.has(league.key);
          return (
            <button
              key={league.key}
              type="button"
              aria-pressed={shown}
              onClick={() => onToggle({ key: league.key, sportKey: league.sportKey, name: league.name })}
              className={`ui-control inline-flex max-w-full items-center gap-2 px-3 py-1.5 text-sm font-medium transition ${
                shown
                  ? "bg-white text-slate-800 ring-1 ring-inset ring-emerald-300 hover:bg-emerald-50"
                  : "bg-slate-100 text-slate-400 line-through ring-1 ring-inset ring-slate-200 hover:bg-slate-200"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  shown ? "ui-accent-bg border-transparent" : "border-slate-300 bg-white text-transparent"
                }`}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span aria-hidden>{sportIcon(league.sportKey)}</span>
              <span className="truncate">{pick(league.name, lang)}</span>
              {league.count > 0 ? <span className="shrink-0 tabular-nums opacity-70">({league.count})</span> : null}
            </button>
          );
        })}
        {filtered.length === 0 ? <p className="text-sm text-slate-500">{t.noTournaments}</p> : null}
      </div>
    </div>
  );
}

/** Persistent bar/list displaying permanently hidden championships with one-click Return and Return all. */
export function HiddenLeaguesBar({
  hiddenLeagues,
  lang,
  t,
  onRestore,
  onRestoreAll,
}: {
  hiddenLeagues: HiddenLeague[];
  lang: Lang;
  t: Dict;
  onRestore: (key: string) => void;
  onRestoreAll: () => void;
}) {
  if (hiddenLeagues.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {t.hiddenTournamentsTitle} ({hiddenLeagues.length})
        </p>
        <button
          type="button"
          onClick={onRestoreAll}
          className="ui-control ui-accent-soft inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold transition hover:opacity-85"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          {t.restoreAllTournaments}
        </button>
      </div>
      <div className="mt-2.5 flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
        {hiddenLeagues.map((league) => {
          const label = pick(league.name, lang);
          return (
            <div
              key={league.key}
              className="ui-control inline-flex max-w-full items-center gap-1.5 bg-white py-1 pl-3 pr-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200"
            >
              <span aria-hidden>{sportIcon(league.sportKey)}</span>
              <span className="truncate">{label}</span>
              <button
                type="button"
                onClick={() => onRestore(league.key)}
                aria-label={`${t.restoreTournament}: ${label}`}
                className="ui-control ui-accent-soft inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold transition hover:opacity-85"
              >
                <RotateCcw className="h-2.5 w-2.5" aria-hidden />
                {t.restoreTournament}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
