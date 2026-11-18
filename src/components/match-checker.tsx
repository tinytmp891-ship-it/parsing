"use client";

import { useState } from "react";
import { checkerDictionaries } from "@/lib/checker-i18n";
import type { Lang } from "@/lib/i18n";

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
  green: { box: "border-emerald-300 bg-emerald-50", badge: "bg-emerald-600 text-white" },
  yellow: { box: "border-amber-300 bg-amber-50", badge: "bg-amber-500 text-white" },
  red: { box: "border-rose-300 bg-rose-50", badge: "bg-rose-600 text-white" },
  invalid: { box: "border-slate-300 bg-slate-50", badge: "bg-slate-500 text-white" },
};

const SOURCE_NAMES: Record<string, string> = {
  "1xbet": "1xBet",
  fonbet: "Fonbet",
  bet365: "bet365",
  marathon: "Marathonbet",
  vbet: "Vbet",
  bwin: "bwin",
  stake: "Stake",
  pinnacle: "Pinnacle",
};

function pick(text: { en: string; ru: string }, lang: Lang): string {
  return text[lang] || text.en;
}

export default function MatchChecker({ lang }: { lang: Lang }) {
  const t = checkerDictionaries[lang];
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

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{t.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{t.subtitle}</p>
        <p className="mt-1 text-xs text-slate-500">{t.legend}</p>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t.placeholder}
        rows={5}
        spellCheck={false}
        className="mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runCheck}
          disabled={busy || text.trim().length === 0}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? t.checking : t.check}
        </button>
        <button
          type="button"
          onClick={() => setText(SAMPLE)}
          className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          {t.sample}
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          {t.clear}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {summary && results ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-600 px-3 py-1 font-semibold text-white">{summary.green}</span>
            <span className="rounded-full bg-amber-500 px-3 py-1 font-semibold text-white">{summary.yellow}</span>
            <span className="rounded-full bg-rose-600 px-3 py-1 font-semibold text-white">{summary.red}</span>
            <span className="text-slate-600">{t.summary(summary.green, summary.yellow, summary.red)}</span>
            <span className="text-xs text-slate-500">· {t.schedulePrefix(scheduleSize)}</span>
          </div>

          <ul className="space-y-3">
            {results.map((result) => {
              const style = STATUS_STYLE[result.status];
              const stamp = result.match
                ? new Intl.DateTimeFormat(locale, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(result.match.startsAt))
                : null;
              return (
                <li key={result.index} className={`rounded-xl border p-4 ${style.box}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
                      {labelOf[result.status]}
                    </span>
                    <span className="text-xs text-slate-500">#{result.index}</span>
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
                    <div className="mt-3 rounded-lg bg-white/80 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                      <p className="font-semibold text-slate-900">
                        {t.schedule}: {pick(result.match.home, lang)} – {pick(result.match.away, lang)}
                        {result.match.idMatched ? (
                          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800">
                            {t.sameId}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-slate-500">
                        {stamp} · {pick(result.match.sportName, lang)} · {pick(result.match.leagueName, lang)} ·{" "}
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
