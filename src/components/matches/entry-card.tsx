"use client";

import type { ReactNode } from "react";
import type { Dict, Lang } from "@/lib/i18n";
import { tintOf } from "@/lib/match-colors";
import { pick, SOURCE_NAMES, sourceUrl, sportIcon, type Entry } from "@/lib/matches-types";
import { BookmakerChip, StarLabels } from "./bookmaker-chip";
import { CheckToggle, useMatchStyle } from "./match-style";

/**
 * One match row, in this order:
 * 1. the full match title (never cut off), with the stars,
 * 2. sport and tournament,
 * 3. the other information: partial marker, check control, bookmakers,
 * 4. for partial matches, the name of each bookmaker.
 * `leading` adds a left column (used by tournament bubbles for the time and countdown).
 */
export function EntryCard({
  entry,
  lang,
  t,
  leading,
}: {
  entry: Entry;
  lang: Lang;
  t: Dict;
  leading?: ReactNode;
}) {
  const { partialColor, checkedColor, checkedIds } = useMatchStyle();
  const partial = entry.matchType === "partial";
  const checked = partial && checkedIds.has(entry.id);
  const background = partial ? tintOf(checked ? checkedColor : partialColor) : undefined;

  return (
    <li className="px-5 py-3.5" style={background ? { backgroundColor: background } : undefined}>
      <div className={leading ? "flex gap-5" : undefined}>
        {leading ? <div className="w-40 shrink-0">{leading}</div> : null}

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="flex items-start gap-2 text-base font-semibold leading-snug text-slate-900">
            <StarLabels sources={entry.sources} t={t} />
            <span className="min-w-0 break-words">
              {pick(entry.home, lang)} <span className="font-normal text-slate-400">vs</span> {pick(entry.away, lang)}
            </span>
          </p>

          <p className="text-xs text-slate-500">
            <span className="mr-1" aria-hidden>
              {sportIcon(entry.sportKey)}
            </span>
            {pick(entry.sportName, lang)} · {pick(entry.leagueName, lang)}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {partial ? (
              <span
                title={t.partialHint}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm ring-1 ring-inset ring-amber-300"
              >
                <span aria-hidden>⚠</span>
                <span className="sr-only">{t.partialBadge}</span>
              </span>
            ) : null}
            {partial ? <CheckToggle id={entry.id} checked={checked} t={t} /> : null}
            {entry.sources.map((source) => (
              <BookmakerChip
                key={`${source.source}-${source.externalId}`}
                sourceId={source.source}
                href={sourceUrl(source)}
              />
            ))}
            <span className="text-xs text-slate-500">
              {entry.sources.length > 1
                ? t.listedOnMany(entry.sources.length)
                : `${t.listedOnOne} ${SOURCE_NAMES[entry.sources[0]?.source] ?? ""}`}
            </span>
          </div>

          {partial ? (
            <ul className="space-y-1 rounded-lg bg-white p-2 text-xs ring-1 ring-inset ring-amber-200">
              {entry.sources.map((source) => {
                const mismatch = source.relation === "partial";
                return (
                  <li
                    key={`detail-${source.source}-${source.externalId}`}
                    className={mismatch ? "font-medium text-amber-900" : "text-slate-600"}
                  >
                    <span className="font-semibold">{SOURCE_NAMES[source.source] ?? source.source}:</span>{" "}
                    {pick(source.home, lang)} – {pick(source.away, lang)} {mismatch ? "⚠" : "✓"}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}
