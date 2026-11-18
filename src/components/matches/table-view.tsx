"use client";

import { Fragment, type ReactNode } from "react";
import type { Dict, Lang } from "@/lib/i18n";
import { tintOf } from "@/lib/match-colors";
import {
  pick,
  sourceUrl,
  sportIcon,
  type Day,
  type Entry,
  type GroupBy,
  type Tab,
  type TournamentGroup,
} from "@/lib/matches-types";
import { BookmakerChip, StarLabels } from "./bookmaker-chip";
import { Countdown, Elapsed } from "./countdown";
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
};

/**
 * Table with one row per match. Partial matches get an extra row for every bookmaker's
 * name variant, so the differences between the names are visible.
 */
export function TableView({ mode, days, tournaments, lang, t, tab, showCountdown }: Props) {
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

    return (
      <Fragment key={entry.id}>
        <tr className="border-t border-slate-100 hover:bg-slate-50" style={background ? { backgroundColor: background } : undefined}>
          <td className="whitespace-nowrap px-4 py-2.5 text-base font-bold tabular-nums text-slate-950">{time}</td>
          {showCountdown ? <td className="whitespace-nowrap px-4 py-2.5">{countdown}</td> : null}
          <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
            <span aria-hidden>{sportIcon(entry.sportKey)}</span> {pick(entry.sportName, lang)}
          </td>
          <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-600" title={pick(entry.leagueName, lang)}>
            {pick(entry.leagueName, lang)}
          </td>
          <td className="min-w-[240px] px-4 py-2.5 font-semibold text-slate-900">
            <span className="flex items-center gap-2">
              <StarLabels sources={entry.sources} t={t} />
              <span>
                {pick(entry.home, lang)} <span className="font-normal text-slate-400">vs</span> {pick(entry.away, lang)}
              </span>
            </span>
          </td>
          <td className="px-4 py-2.5">
            <div className="flex flex-wrap gap-1">
              {entry.sources.map((source) => (
                <BookmakerChip key={`${source.source}-${source.externalId}`} sourceId={source.source} href={sourceUrl(source)} />
              ))}
            </div>
          </td>
          <td className="whitespace-nowrap px-4 py-2.5 text-xs">
            <div className="flex flex-col items-start gap-1.5">
              <span
                title={partial ? t.partialHint : undefined}
                className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${TYPE_STYLES[entry.matchType]}`}
              >
                {partial ? "⚠ " : ""}
                {typeLabel}
              </span>
              {partial ? <CheckToggle id={entry.id} checked={checked} t={t} /> : null}
            </div>
          </td>
        </tr>

        {partial
          ? entry.sources.map((source) => {
              const mismatch = source.relation === "partial";
              return (
                <tr key={`variant-${source.source}-${source.externalId}`} style={{ backgroundColor: background }}>
                  <td colSpan={columns} className="px-4 py-1.5 pl-12 text-xs">
                    <BookmakerChip sourceId={source.source} className="mr-2" />
                    <span className={mismatch ? "font-semibold text-amber-900" : "text-slate-700"}>
                      {pick(source.home, lang)} <span className="text-slate-400">–</span> {pick(source.away, lang)}
                    </span>
                    <span className="ml-2" aria-hidden>
                      {mismatch ? "⚠" : "✓"}
                    </span>
                  </td>
                </tr>
              );
            })
          : null}
      </Fragment>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-2.5 font-semibold">{t.tableTime}</th>
            {showCountdown ? (
              <th className="px-4 py-2.5 font-semibold">{tab === "started" ? t.showElapsed : t.tableCountdown}</th>
            ) : null}
            <th className="px-4 py-2.5 font-semibold">{t.tableSport}</th>
            <th className="px-4 py-2.5 font-semibold">{t.tableLeague}</th>
            <th className="px-4 py-2.5 font-semibold">{t.tableMatch}</th>
            <th className="px-4 py-2.5 font-semibold">{t.tableBookmakers}</th>
            <th className="px-4 py-2.5 font-semibold">{t.tableType}</th>
          </tr>
        </thead>
        <tbody>
          {mode === "tournament"
            ? tournaments.map((group) => (
                <Fragment key={group.key}>
                  <tr className="bg-slate-50">
                    <td colSpan={columns} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-bold text-slate-900">
                          <span aria-hidden>{sportIcon(group.sportKey)}</span> {pick(group.leagueName, lang)}
                        </span>
                        <span className="text-xs text-slate-500">{pick(group.sportName, lang)}</span>
                        <span className="ml-auto text-xs font-medium text-slate-500">{t.count(group.count)}</span>
                      </div>
                    </td>
                  </tr>
                  {group.rows.map((row) =>
                    renderEntry(
                      row.entry,
                      <>
                        <span className="block text-xs font-medium text-slate-500">{row.date}</span>
                        {row.time}
                      </>,
                      countdownFor(row.startsAt),
                    ),
                  )}
                </Fragment>
              ))
            : days.map((day) => (
                <Fragment key={day.key}>
                  <tr>
                    <td colSpan={columns} className="px-4 pb-2 pt-5 text-sm font-bold uppercase tracking-wide text-slate-900">
                      {day.label}
                      <span className="ml-3 text-xs font-medium normal-case tracking-normal text-slate-500">
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
