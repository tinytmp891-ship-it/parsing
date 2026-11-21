"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Check, Flag, X } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";
import { leagueKeyOf } from "@/lib/league-key";
import { tintOf } from "@/lib/match-colors";
import { pick, SOURCE_NAMES, sourceUrl, sportIcon, type Entry, type LocalizedText } from "@/lib/matches-types";
import { INDIVIDUAL_SPORTS } from "@/lib/sources/model";
import { BookmakerChip, StarLabels } from "./bookmaker-chip";
import { DiffName } from "./diff-name";
import { MatchFormatBadge } from "./match-format-badge";
import { MatchInfoPopover } from "./match-info-popover";
import { CheckToggle, useMatchStyle } from "./match-style";

/**
 * One match row, in this order:
 * 1. the full match title (never cut off), with the stars,
 * 2. sport, tournament, optional stage tag, venue `i` popover trigger, and hide action,
 * 3. the other information: partial marker, check control, bookmakers,
 * 4. for partial matches, each bookmaker's variant with matching teams underlined and differing parts in red.
 */
export function EntryCard({
  entry,
  lang,
  t,
  leading,
  onHideLeague,
}: {
  entry: Entry;
  lang: Lang;
  t: Dict;
  leading?: ReactNode;
  onHideLeague?: (league: { key: string; sportKey: string; name: LocalizedText }) => void;
}) {
  const { partialColor, checkedColor, checkedIds } = useMatchStyle();
  const partial = entry.matchType === "partial";
  const checked = partial && checkedIds.has(entry.id);
  const background = partial ? tintOf(checked ? checkedColor : partialColor) : undefined;
  const individual = INDIVIDUAL_SPORTS.has(entry.sportKey);

  const primarySource = entry.sources[0];
  const compareSource = entry.sources.find((s) => s.relation === "partial") ?? entry.sources[1];
  const leagueName = pick(entry.leagueName, lang);
  const leagueKey = leagueKeyOf(entry.sportKey, entry.leagueName.en);
  const matchTitle = `${pick(entry.home, lang)} vs ${pick(entry.away, lang)}`;

  return (
    <li className="ui-row-pad px-5 transition-colors hover:bg-slate-50/70" style={background ? { backgroundColor: background } : undefined}>
      <div className={leading ? "flex gap-5" : undefined}>
        {leading ? <div className="w-40 shrink-0">{leading}</div> : null}

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="flex items-start gap-2 text-base font-semibold leading-snug text-slate-900">
                <StarLabels sources={entry.sources} t={t} />
                <span className="min-w-0 break-words">
                  {partial && compareSource ? (
                    <>
                      <DiffName
                        reference={pick(compareSource.home, lang)}
                        candidate={pick(entry.home, lang)}
                        individual={individual}
                      />{" "}
                      <span className="font-normal text-slate-400">vs</span>{" "}
                      <DiffName
                        reference={pick(compareSource.away, lang)}
                        candidate={pick(entry.away, lang)}
                        individual={individual}
                      />
                    </>
                  ) : (
                    <>
                      {pick(entry.home, lang)} <span className="font-normal text-slate-400">vs</span> {pick(entry.away, lang)}
                    </>
                  )}
                </span>
              </p>

              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span>
                  <span className="mr-1" aria-hidden>
                    {sportIcon(entry.sportKey)}
                  </span>
                  {pick(entry.sportName, lang)} · {leagueName}
                </span>
                {entry.tournamentStage ? (
                  <span
                    title={t.stageLabel}
                    data-testid="match-stage-badge"
                    className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-sky-800 ring-1 ring-inset ring-sky-200"
                  >
                    <Flag className="h-2.5 w-2.5 shrink-0 text-sky-600" aria-hidden />
                    {pick(entry.tournamentStage.label, lang)}
                  </span>
                ) : null}
                {entry.matchInfo ? (
                  <MatchInfoPopover info={entry.matchInfo} matchTitle={matchTitle} lang={lang} t={t} />
                ) : null}
                {onHideLeague ? (
                  <button
                    type="button"
                    onClick={() => onHideLeague({ key: leagueKey, sportKey: entry.sportKey, name: entry.leagueName })}
                    aria-label={`${t.hideTournamentPermanently}: ${leagueName}`}
                    title={`${t.hideTournamentPermanently}: ${leagueName}`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-100 hover:text-rose-700"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            {entry.matchFormat ? (
              <div className="self-start">
                <MatchFormatBadge format={entry.matchFormat} lang={lang} t={t} variant="bubble" />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {partial ? (
              <span
                title={t.partialHint}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
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
            <ul className="space-y-1 rounded-lg bg-white p-2.5 text-xs ring-1 ring-inset ring-amber-200">
              {entry.sources.map((source, idx) => {
                const mismatch = source.relation === "partial";
                const refSource = idx === 0 ? compareSource : primarySource;
                return (
                  <li
                    key={`detail-${source.source}-${source.externalId}`}
                    className={`flex flex-wrap items-center gap-1.5 ${mismatch ? "font-medium text-slate-900" : "text-slate-700"}`}
                  >
                    <span className="font-semibold">{SOURCE_NAMES[source.source] ?? source.source}:</span>
                    <span>
                      {refSource ? (
                        <>
                          <DiffName
                            reference={pick(refSource.home, lang)}
                            candidate={pick(source.home, lang)}
                            individual={individual}
                          />{" "}
                          –{" "}
                          <DiffName
                            reference={pick(refSource.away, lang)}
                            candidate={pick(source.away, lang)}
                            individual={individual}
                          />
                        </>
                      ) : (
                        <>
                          {pick(source.home, lang)} – {pick(source.away, lang)}
                        </>
                      )}
                    </span>
                    {mismatch ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                    )}
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
