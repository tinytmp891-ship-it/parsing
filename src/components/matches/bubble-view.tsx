"use client";

import type { Dict, Lang } from "@/lib/i18n";
import { ACCENT_BAR, pick, sportIcon, type Day, type Tab, type TournamentGroup } from "@/lib/matches-types";
import { Countdown, Elapsed } from "./countdown";
import { EntryCard } from "./entry-card";

function Timing({ startsAt, tab, t }: { startsAt: number; tab: Tab; t: Dict }) {
  return tab === "started" ? <Elapsed startedAt={startsAt} t={t} /> : <Countdown startsAt={startsAt} t={t} />;
}

/** One full-width bubble per time group, stacked vertically. */
export function BubbleView({
  days,
  lang,
  t,
  tab,
  showCountdown,
}: {
  days: Day[];
  lang: Lang;
  t: Dict;
  tab: Tab;
  showCountdown: boolean;
}) {
  return (
    <div className="space-y-6 p-3 sm:p-4">
      {days.map((day) => (
        <div key={day.key}>
          <div className="sticky top-0 z-20 mb-3 flex items-center gap-3 rounded-xl bg-white/95 px-2 py-2 backdrop-blur">
            <span className="text-sm font-bold uppercase tracking-wide text-slate-900">{day.label}</span>
            <span className="h-px flex-1 bg-slate-200" aria-hidden />
            <span className="text-xs font-medium text-slate-500">{t.count(day.count)}</span>
          </div>

          <div className="space-y-4">
            {day.slots.map((slot, index) => (
              <section
                key={slot.minute}
                className="overflow-hidden rounded-3xl bg-white shadow-lg ring-1 ring-slate-200"
              >
                <header className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
                  <span
                    className={`rounded-2xl px-4 py-2 text-2xl font-extrabold tabular-nums text-white shadow-sm ${
                      ACCENT_BAR[index % ACCENT_BAR.length]
                    }`}
                  >
                    {slot.time}
                  </span>
                  {showCountdown ? <Timing startsAt={slot.startsAt} tab={tab} t={t} /> : null}
                  <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                    {t.count(slot.entries.length)}
                  </span>
                </header>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {slot.entries.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} lang={lang} t={t} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One full-width bubble per tournament. Each row shows its own date, time and countdown. */
export function TournamentBubbleView({
  groups,
  lang,
  t,
  tab,
  showCountdown,
}: {
  groups: TournamentGroup[];
  lang: Lang;
  t: Dict;
  tab: Tab;
  showCountdown: boolean;
}) {
  return (
    <div className="space-y-4 p-3 sm:p-4">
      {groups.map((group, index) => (
        <section key={group.key} className="overflow-hidden rounded-3xl bg-white shadow-lg ring-1 ring-slate-200">
          <header className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
            <span
              className={`min-w-0 max-w-full truncate rounded-2xl px-4 py-2 text-base font-bold text-white shadow-sm ${
                ACCENT_BAR[index % ACCENT_BAR.length]
              }`}
            >
              <span aria-hidden>{sportIcon(group.sportKey)}</span> {pick(group.leagueName, lang)}
            </span>
            <span className="text-sm text-slate-600">{pick(group.sportName, lang)}</span>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
              {t.count(group.count)}
            </span>
          </header>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {group.rows.map((row) => (
              <EntryCard
                key={row.entry.id}
                entry={row.entry}
                lang={lang}
                t={t}
                leading={
                  <div className="flex flex-col items-start gap-1.5">
                    <span className="text-xs font-medium text-slate-500">{row.date}</span>
                    <span className="text-xl font-bold tabular-nums text-slate-950">{row.time}</span>
                    {showCountdown ? <Timing startsAt={row.startsAt} tab={tab} t={t} /> : null}
                  </div>
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
