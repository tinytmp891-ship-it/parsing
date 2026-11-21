"use client";

import { Fragment, type ReactNode } from "react";
import { AlertTriangle, Check, Flag, X } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";
import { leagueKeyOf } from "@/lib/league-key";
import { tintOf } from "@/lib/match-colors";
import {
  pick,
  sourceUrl,
  sportIcon,
  type Day,
  type Entry,
  type GroupBy,
  type LocalizedText,
  type Tab,
  type TournamentGroup,
} from "@/lib/matches-types";
import { INDIVIDUAL_SPORTS } from "@/lib/sources/model";
import { BookmakerChip, StarLabels } from "./bookmaker-chip";
import { Countdown, Elapsed } from "./countdown";
import { DiffName } from "./diff-name";
import { MatchFormatBadge } from "./match-format-badge";
import { MatchInfoPopover } from "./match-info-popover";
import { CheckToggle, useMatchStyle } from "./match-style";

const TYPE_STYLES = {
  single: "bg-slate-100 text-slate-700 ring-slate-200",
  full: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  partial: "bg-amber-100 text-amber-900 ring-amber-300",
} as const;

type Props = {
  mode: GroupBy;
  days: Day[];
  tournaments: TournamentGroup[];
  lang: Lang;
  t: Dict;
  tab: Tab;
  showCountdown: boolean;
  onHideLeague?: (league: { key: string; sportKey: string; name: LocalizedText }) => void;
};

/**
 * Responsive full-width table with no horizontal scroll on desktop/tablet viewports.
 * Partial matches underline matching team names, highlight differing parts in red,
 * and expand a variant row for every bookmaker.
 */
export function TableView({ mode, days, tournaments, lang, t, tab, showCountdown, onHideLeague }: Props) {
  const { partialColor, checkedColor, checkedIds } = useMatchStyle();
  const columns = showCountdown ? 7 : 6;

  const countdownFor = (startsAt: number): ReactNode =>
    tab === "started" ? <Elapsed startedAt={startsAt} t={t} /> : <Countdown startsAt={startsAt} t={t} />;

  const renderEntry = (entry: Entry, time: ReactNode, countdown: ReactNode) => {
    const typeLabel =
      entry.matchType === "partial" ? t.typePartial : entry.matchType === "full" ? t.typeFull : t.typeSingle;
    const partial = entry.matchType === "partial";
    const checked = partial && checkedIds.has(entry.id);
    const background = partial ? tintOf(checked ? checkedColor : partialColor) : undefined;
    const individual = INDIVIDUAL_SPORTS.has(entry.sportKey);

    const primarySource = entry.sources[0];
    const compareSource = entry.sources.find((s) => s.relation === "partial") ?? entry.sources[1];
    const leagueLabel = pick(entry.leagueName, lang);
    const leagueKey = leagueKeyOf(entry.sportKey, entry.leagueName.en);

    return (
      <Fragment key={entry.id}>
        <tr className="border-t border-slate-100 align-top transition-colors hover:bg-slate-50/80" style={background ? { backgroundColor: background } : undefined}>
          <td className="px-2 py-2.5 text-sm font-bold tabular-nums text-slate-950 sm:px-2.5 sm:text-base">{time}</td>
          {showCountdown ? <td className="px-2 py-2.5 sm:px-2.5">{countdown}</td> : null}
          <td className="break-words px-2 py-2.5 text-xs text-slate-700 sm:px-2.5">
            <div>
              <span aria-hidden>{sportIcon(entry.sportKey)}</span> {pick(entry.sportName, lang)}
            </div>
            {entry.matchFormat ? (
              <MatchFormatBadge format={entry.matchFormat} lang={lang} t={t} variant="compact" />
            ) : null}
          </td>
          <td className="break-words px-2 py-2.5 text-xs text-slate-600 sm:px-2.5" title={leagueLabel}>
            <div className="flex items-start justify-between gap-1">
              <span className="min-w-0 break-words">{leagueLabel}</span>
              <div className="flex shrink-0 items-center gap-0.5">
                {entry.matchInfo ? (
                  <MatchInfoPopover
                    info={entry.matchInfo}
                    matchTitle={`${pick(entry.home, lang)} vs ${pick(entry.away, lang)}`}
                    lang={lang}
                    t={t}
                  />
                ) : null}
                {onHideLeague ? (
                  <button
                    type="button"
                    onClick={() => onHideLeague({ key: leagueKey, sportKey: entry.sportKey, name: entry.leagueName })}
                    aria-label={`${t.hideTournamentPermanently}: ${leagueLabel}`}
                    title={`${t.hideTournamentPermanently}: ${leagueLabel}`}
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-100 hover:text-rose-700"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
            {entry.tournamentStage ? (
              <span
                title={t.stageLabel}
                className="mt-1 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-sky-800 ring-1 ring-inset ring-sky-200"
              >
                <Flag className="h-2.5 w-2.5 shrink-0 text-sky-600" aria-hidden />
                {pick(entry.tournamentStage.label, lang)}
              </span>
            ) : null}
          </td>
          <td className="break-words px-2 py-2.5 font-semibold text-slate-900 sm:px-2.5">
            <div className="flex items-start gap-1.5">
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
            </div>
          </td>
          <td className="px-2 py-2.5 sm:px-2.5">
            <div className="flex flex-wrap gap-1">
              {entry.sources.map((source) => (
                <BookmakerChip
                  key={`${source.source}-${source.externalId}`}
                  sourceId={source.source}
                  href={sourceUrl(source)}
                  className="px-2 py-0.5 text-[11px]"
                />
              ))}
            </div>
          </td>
          <td className="px-2 py-2.5 text-xs sm:px-2.5">
            <div className="flex flex-col items-start gap-1.5">
              <span
                title={partial ? t.partialHint : undefined}
                className={`ui-control inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold leading-tight ring-1 ring-inset ${TYPE_STYLES[entry.matchType]}`}
              >
                {partial ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> : null}
                {typeLabel}
              </span>
              {partial ? <CheckToggle id={entry.id} checked={checked} t={t} /> : null}
            </div>
          </td>
        </tr>

        {partial
          ? entry.sources.map((source, idx) => {
              const mismatch = source.relation === "partial";
              const refSource = idx === 0 ? compareSource : primarySource;
              return (
                <tr key={`variant-${source.source}-${source.externalId}`} style={{ backgroundColor: background }}>
                  <td colSpan={columns} className="px-3 py-1.5 pl-8 text-xs sm:pl-10">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <BookmakerChip sourceId={source.source} className="px-2 py-0.5 text-[11px]" />
                      <span className={mismatch ? "font-semibold text-slate-900" : "text-slate-700"}>
                        {refSource ? (
                          <>
                            <DiffName
                              reference={pick(refSource.home, lang)}
                              candidate={pick(source.home, lang)}
                              individual={individual}
                            />{" "}
                            <span className="text-slate-400">–</span>{" "}
                            <DiffName
                              reference={pick(refSource.away, lang)}
                              candidate={pick(source.away, lang)}
                              individual={individual}
                            />
                          </>
                        ) : (
                          <>
                            {pick(source.home, lang)} <span className="text-slate-400">–</span> {pick(source.away, lang)}
                          </>
                        )}
                      </span>
                      {mismatch ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          : null}
      </Fragment>
    );
  };

  return (
    <div className="w-full" data-testid="matches-table-wrap">
      <table className="w-full table-fixed border-collapse text-left text-xs sm:text-sm">
        <colgroup>
          <col className={showCountdown ? "w-[9%]" : "w-[10%]"} />
          {showCountdown ? <col className="w-[10%]" /> : null}
          <col className={showCountdown ? "w-[11%]" : "w-[12%]"} />
          <col className={showCountdown ? "w-[16%]" : "w-[18%]"} />
          <col className={showCountdown ? "w-[27%]" : "w-[31%]"} />
          <col className={showCountdown ? "w-[15%]" : "w-[17%]"} />
          <col className={showCountdown ? "w-[12%]" : "w-[12%]"} />
        </colgroup>
        <thead className="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-600 sm:text-xs">
          <tr>
            <th className="px-2 py-2.5 font-semibold sm:px-2.5">{t.tableTime}</th>
            {showCountdown ? (
              <th className="px-2 py-2.5 font-semibold sm:px-2.5">{tab === "started" ? t.showElapsed : t.tableCountdown}</th>
            ) : null}
            <th className="px-2 py-2.5 font-semibold sm:px-2.5">{t.tableSport}</th>
            <th className="px-2 py-2.5 font-semibold sm:px-2.5">{t.tableLeague}</th>
            <th className="px-2 py-2.5 font-semibold sm:px-2.5">{t.tableMatch}</th>
            <th className="px-2 py-2.5 font-semibold sm:px-2.5">{t.tableBookmakers}</th>
            <th className="px-2 py-2.5 font-semibold sm:px-2.5">{t.tableType}</th>
          </tr>
        </thead>
        <tbody>
          {mode === "tournament"
            ? tournaments.map((group) => {
                const leagueLabel = pick(group.leagueName, lang);
                return (
                  <Fragment key={group.key}>
                    <tr className="bg-slate-50">
                      <td colSpan={columns} className="px-2.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            <span aria-hidden>{sportIcon(group.sportKey)}</span> {leagueLabel}
                          </span>
                          <span className="text-xs text-slate-500">{pick(group.sportName, lang)}</span>
                          {onHideLeague ? (
                            <button
                              type="button"
                              onClick={() =>
                                onHideLeague({ key: group.key, sportKey: group.sportKey, name: group.leagueName })
                              }
                              aria-label={`${t.hideTournamentPermanently}: ${leagueLabel}`}
                              title={`${t.hideTournamentPermanently}: ${leagueLabel}`}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-100 hover:text-rose-700"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          ) : null}
                          <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">{t.count(group.count)}</span>
                        </div>
                      </td>
                    </tr>
                    {group.rows.map((row) =>
                      renderEntry(
                        row.entry,
                        <>
                          <span className="block text-[11px] font-medium text-slate-500">{row.date}</span>
                          {row.time}
                        </>,
                        countdownFor(row.startsAt),
                      ),
                    )}
                  </Fragment>
                );
              })
            : days.map((day) => (
                <Fragment key={day.key}>
                  <tr>
                    <td colSpan={columns} className="px-2.5 pb-1.5 pt-4 text-sm font-bold uppercase tracking-wide text-slate-900">
                      {day.label}
                      <span className="ml-3 text-xs font-medium normal-case tracking-normal tabular-nums text-slate-500">
                        {t.count(day.count)}
                      </span>
                    </td>
                  </tr>
                  {day.slots.flatMap((slot) =>
                    slot.entries.map((entry, index) =>
                      renderEntry(entry, slot.time, index === 0 ? countdownFor(slot.startsAt) : null),
                    ),
                  )}
                </Fragment>
              ))}
        </tbody>
      </table>
    </div>
  );
}
