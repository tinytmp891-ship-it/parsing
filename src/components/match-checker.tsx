"use client";

import { useState } from "react";
import { Check, Clock, ListChecks, Sparkles, X } from "lucide-react";
import { checkerDictionaries } from "@/lib/checker-i18n";
import { dictionaries, type Lang } from "@/lib/i18n";
import { pick, SOURCE_NAMES } from "@/lib/matches-types";
import { StarLabels } from "./matches/bookmaker-chip";

type Status = "green" | "yellow" | "red" | "invalid";

type CheckResult = {
  index: number;
  raw: string;
  home: string;
  away: string;
  sportText: string;
  sportKey: string | null;
  league: string | null;
  externalId: string | null;
  status: Status;
  homeMatched: boolean;
  awayMatched: boolean;
  match: {
    id: string;
    startsAt: string;
    sportKey: string;
    sportName: { en: string; ru: string };
    leagueName: { en: string; ru: string };
    home: { en: string; ru: string };
    away: { en: string; ru: string };
    sources: string[];
    idMatched: boolean;
  } | null;
};

type Summary = Record<Status, number>;

const SAMPLE = `Эссекс Ребелс - Ноттингем Хоудс       Баскетбол.Великобритания. БЦБ  с ОТ  770943807
Лоугхбороугх Ридерс - Сити оф Бирмингэм Рокетс       Баскетбол.Великобритания. БЦБ  с ОТ  770943805`;

const STATUS_STYLE: Record<Status, { box: string; badge: string }> = {
  green: { box: "border-emerald-300 bg-emerald-50/90", badge: "bg-emerald-600 text-white" },
  yellow: { box: "border-amber-300 bg-amber-50/90", badge: "bg-amber-500 text-white" },
  red: { box: "border-rose-300 bg-rose-50/90", badge: "bg-rose-600 text-white" },
  invalid: { box: "border-slate-300 bg-slate-50", badge: "bg-slate-500 text-white" },
};

export default function MatchChecker({ lang }: { lang: Lang }) {
  const t = checkerDictionaries[lang];
  const mainDict = dictionaries[lang];
  const locale = lang === "ru" ? "ru-RU" : "en-US";

  const [text, setText] = useState("");
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scheduleSize, setScheduleSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t.failed);
      setResults(json.results as CheckResult[]);
      setSummary(json.summary as Summary);
      setScheduleSize(json.scheduleSize as number);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setText("");
    setResults(null);
    setSummary(null);
    setError(null);
  };

  const labelOf: Record<Status, string> = {
    green: t.green,
    yellow: t.yellow,
    red: t.red,
    invalid: t.invalid,
  };

  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const stampFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Check if all found matches start at the same time (exact HH:MM, or same hour HH).
  const matchedResults = results?.filter((r) => r.match !== null) ?? [];
  let commonStartBanner: string | null = null;
  if (matchedResults.length > 0) {
    const times = matchedResults.map((r) => timeFormatter.format(new Date(r.match!.startsAt)));
    const uniqueTimes = new Set(times);
    if (uniqueTimes.size === 1) {
      commonStartBanner = t.allStartAt(times[0]);
    } else {
      const hours = matchedResults.map((r) => String(new Date(r.match!.startsAt).getHours()).padStart(2, "0"));
      const uniqueHours = new Set(hours);
      if (uniqueHours.size === 1) {
        commonStartBanner = t.allStartInHour(hours[0]);
      }
    }
  }

  return (
    <section className="ui-card ui-card-pad bg-white shadow-sm ring-1 ring-slate-200/90">
      <div className="flex items-start gap-3">
        <span className="ui-accent-soft mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <ListChecks className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-950 sm:text-lg">{t.title}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{t.subtitle}</p>
          <p className="mt-1 text-xs text-slate-500">{t.legend}</p>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t.placeholder}
        rows={4}
        spellCheck={false}
        className="ui-accent-input mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus:bg-white"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runCheck}
          disabled={busy || text.trim().length === 0}
          className="ui-control ui-accent-bg inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Check className="h-4 w-4" aria-hidden />
          {busy ? t.checking : t.check}
        </button>
        <button
          type="button"
          onClick={() => setText(SAMPLE)}
          className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t.sample}
        </button>
        <button
          type="button"
          onClick={clear}
          className="ui-control inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t.clear}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {summary && results ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="ui-control bg-emerald-600 px-3 py-1 font-semibold tabular-nums text-white">{summary.green}</span>
            <span className="ui-control bg-amber-500 px-3 py-1 font-semibold tabular-nums text-white">{summary.yellow}</span>
            <span className="ui-control bg-rose-600 px-3 py-1 font-semibold tabular-nums text-white">{summary.red}</span>
            <span className="text-slate-600">{t.summary(summary.green, summary.yellow, summary.red)}</span>
            <span className="text-xs text-slate-500">· {t.schedulePrefix(scheduleSize)}</span>
            {commonStartBanner ? (
              <span className="ui-control inline-flex items-center gap-1.5 bg-sky-100 px-3 py-1 text-xs font-bold text-sky-900 ring-1 ring-inset ring-sky-300">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {commonStartBanner}
              </span>
            ) : null}
          </div>

          <ul className="space-y-3">
            {results.map((result) => {
              const style = STATUS_STYLE[result.status];
              const matchDate = result.match ? new Date(result.match.startsAt) : null;
              const matchTime = matchDate ? timeFormatter.format(matchDate) : null;
              const stamp = matchDate ? stampFormatter.format(matchDate) : null;

              return (
                <li key={result.index} className={`rounded-xl border p-4 ${style.box}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`ui-control px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
                        {labelOf[result.status]}
                      </span>
                      {matchTime ? (
                        <span
                          title={t.kickoffTime}
                          className="ui-control inline-flex items-center gap-1 bg-white px-2.5 py-0.5 text-xs font-bold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-300"
                        >
                          <Clock className="h-3 w-3 text-slate-500" aria-hidden />
                          {matchTime}
                        </span>
                      ) : null}
                      {result.match ? (
                        <StarLabels
                          sources={result.match.sources.map((source) => ({ source }))}
                          t={mainDict}
                        />
                      ) : null}
                    </div>
                    <span className="font-mono text-xs text-slate-500">#{result.index}</span>
                  </div>

                  <p className="mt-2 text-sm font-semibold">
                    <span className={result.homeMatched ? "text-emerald-700" : "text-rose-700"}>
                      {result.status === "invalid" ? "" : result.homeMatched ? "✓ " : "✗ "}
                      {result.home || result.raw}
                    </span>
                    {result.away ? (
                      <>
                        <span className="px-1.5 text-slate-400">–</span>
                        <span className={result.awayMatched ? "text-emerald-700" : "text-rose-700"}>
                          {result.awayMatched ? "✓ " : "✗ "}
                          {result.away}
                        </span>
                      </>
                    ) : null}
                  </p>

                  {result.sportText || result.league ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {result.sportText}
                      {result.league ? ` · ${result.league}` : ""}
                    </p>
                  ) : null}

                  {result.match ? (
                    <div className="mt-3 rounded-lg bg-white/85 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <StarLabels
                          sources={result.match.sources.map((source) => ({ source }))}
                          t={mainDict}
                        />
                        <p className="font-semibold text-slate-900">
                          {t.schedule}: {pick(result.match.home, lang)} – {pick(result.match.away, lang)}
                          {result.match.idMatched ? (
                            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800">
                              {t.sameId}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <p className="mt-1 text-slate-600">
                        <span className="font-semibold text-slate-800">{stamp}</span> · {pick(result.match.sportName, lang)} ·{" "}
                        {pick(result.match.leagueName, lang)} ·{" "}
                        {result.match.sources.map((source) => SOURCE_NAMES[source] ?? source).join(", ")}
                      </p>
                    </div>
                  ) : result.status !== "invalid" ? (
                    <p className="mt-2 text-xs text-slate-500">{t.noSchedule}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
