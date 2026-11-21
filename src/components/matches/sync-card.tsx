"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, Shield } from "lucide-react";
import type { Dict } from "@/lib/i18n";
import { formatElapsed, statusOf, type SyncSource, type SyncStatus } from "@/lib/matches-types";

const FEEDS_OPEN_KEY = "matches-feeds-open";

type Tone = "ok" | "busy" | "bad" | "warn" | "idle";
type View = { label: string; tone: Tone; detail: string; percent: number | null; note: string | null };

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  busy: "bg-sky-500 animate-pulse",
  bad: "bg-rose-500",
  warn: "bg-amber-500",
  idle: "bg-slate-400",
};
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-700",
  busy: "text-sky-700",
  bad: "text-rose-700",
  warn: "text-amber-700",
  idle: "text-slate-600",
};
const TONE_BAR: Record<Tone, string> = {
  ok: "bg-emerald-500",
  busy: "bg-sky-500",
  bad: "bg-rose-500",
  warn: "bg-amber-500",
  idle: "bg-slate-400",
};

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso || !now) return null;
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

/** Turns one bookmaker's live state into a label, a tone, and a short explanation. */
function describeSource(source: SyncSource, t: Dict, now: number): View {
  const finished = source.lastRun?.finishedAt ?? source.lastRun?.startedAt ?? null;
  const ago = minutesSince(finished, now);
  const storedLine = [
    source.lastRun ? t.matchesStored(source.lastRun.matchesCount) : "",
    ago !== null ? t.timeAgo(ago) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  switch (source.state) {
    case "loading":
      return { label: t.stateConnecting, tone: "busy", detail: "", percent: null, note: null };
    case "fetching": {
      const percent = source.tasksTotal > 0 ? Math.round((source.tasksDone / source.tasksTotal) * 100) : null;
      return {
        label: t.stateFetching(source.tasksDone, source.tasksTotal),
        tone: "busy",
        detail: t.eventsSaved(source.eventsSaved),
        percent,
        note: null,
      };
    }
    case "finishing":
      return { label: t.stateFinishing, tone: "busy", detail: t.eventsSaved(source.eventsSaved), percent: 100, note: null };
    case "unavailable": {
      const minutesLeft =
        source.unavailableUntil && now ? Math.ceil((Date.parse(source.unavailableUntil) - now) / 60_000) : 0;
      return {
        label: t.statusUnavailable,
        tone: "bad",
        detail: source.error ?? "",
        percent: null,
        note: minutesLeft > 0 ? t.recheckIn(minutesLeft) : null,
      };
    }
    case "failed":
      return { label: t.statusError, tone: "bad", detail: source.error ?? "", percent: null, note: storedLine || null };
    case "done":
      return { label: t.statusOnline, tone: "ok", detail: storedLine, percent: null, note: null };
    default: {
      if (!source.lastRun) return { label: t.statusNever, tone: "idle", detail: "", percent: null, note: null };
      const status = statusOf(source.lastRun.status);
      if (status === "ok") return { label: t.statusOnline, tone: "ok", detail: storedLine, percent: null, note: null };
      if (status === "partial") {
        return { label: t.statusPartial, tone: "warn", detail: storedLine, percent: null, note: null };
      }
      return {
        label: t.statusError,
        tone: "bad",
        detail: source.lastRun.error ?? "",
        percent: null,
        note: storedLine || null,
      };
    }
  }
}

export function SyncCard({
  sync,
  t,
  refreshing,
  onRefresh,
  onOpenProxyManager,
}: {
  sync: SyncStatus;
  t: Dict;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenProxyManager?: () => void;
}) {
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (window.localStorage.getItem(FEEDS_OPEN_KEY) === "0") setOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const tick = window.setTimeout(() => setNow(Date.now()), 0);
    if (!sync.running) return () => window.clearTimeout(tick);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(tick);
      window.clearInterval(id);
    };
  }, [sync.running]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    window.localStorage.setItem(FEEDS_OPEN_KEY, next ? "1" : "0");
  };

  const elapsed = sync.startedAt && now ? now - Date.parse(sync.startedAt) : 0;
  const views = sync.sources.map((source) => ({ source, view: describeSource(source, t, now) }));
  const online = views.filter(({ view }) => view.tone === "ok").length;
  const unavailable = views.filter(({ view }) => view.tone === "bad").length;

  return (
    <section className="ui-card ui-card-pad bg-white shadow-sm ring-1 ring-slate-200/90">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.sourcesTitle}</p>
          <span className="text-xs font-medium text-slate-600">{t.feedsSummary(online, unavailable)}</span>
          {sync.running ? (
            <span className="ui-control inline-flex items-center gap-2 bg-sky-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-sky-900">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
              {t.syncElapsed(formatElapsed(elapsed))}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {unavailable > 0 && onOpenProxyManager ? (
            <button
              type="button"
              onClick={onOpenProxyManager}
              className="ui-control inline-flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-100"
            >
              <Shield className="h-3.5 w-3.5" aria-hidden />
              {t.proxyOpenManager}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={open}
            className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            {open ? t.feedsCollapse : t.feedsExpand}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || sync.running}
            className="ui-control ui-accent-bg inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing || sync.running ? "animate-spin" : ""}`} aria-hidden />
            {refreshing || sync.running ? t.syncing : t.refresh}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {views.map(({ source, view }) => (
              <div
                key={source.id}
                className="rounded-xl bg-slate-50/90 p-3 ring-1 ring-inset ring-slate-200/80 transition hover:ring-slate-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{source.label}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${TONE_TEXT[view.tone]}`}>
                    <span className={`h-2 w-2 rounded-full ${TONE_DOT[view.tone]}`} />
                    {view.label}
                  </span>
                </div>

                {view.percent !== null || view.tone === "busy" ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    {view.percent !== null ? (
                      <div
                        className={`h-full rounded-full transition-all ${TONE_BAR[view.tone]}`}
                        style={{ width: `${view.percent}%` }}
                      />
                    ) : (
                      <div className={`h-full w-1/3 animate-pulse rounded-full ${TONE_BAR[view.tone]}`} />
                    )}
                  </div>
                ) : null}

                {view.detail ? (
                  <p
                    className={`mt-1.5 line-clamp-2 text-xs ${view.tone === "bad" ? "text-rose-700" : "text-slate-500"}`}
                    title={view.detail}
                  >
                    {view.detail}
                  </p>
                ) : null}
                {view.note ? <p className="mt-1 text-xs text-slate-500">{view.note}</p> : null}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {sync.feedHealth.domains.map((domain) => {
              const tone =
                domain.ok === true
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : domain.ok === false
                    ? "bg-rose-50 text-rose-800 ring-rose-200"
                    : "bg-slate-100 text-slate-600 ring-slate-200";
              return (
                <span
                  key={domain.domain}
                  title={domain.error ?? undefined}
                  className={`ui-control inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium ring-1 ring-inset ${tone}`}
                >
                  1xBet · {domain.domain} · {domain.ok === false ? t.domainOffline : domain.ok ? t.domainOnline : "—"}
                  {sync.feedHealth.lastGoodDomain === domain.domain ? ` · ${t.inUse}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {views.map(({ source, view }) => (
            <span
              key={source.id}
              title={view.detail || view.label}
              className={`ui-control inline-flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-slate-200 ${TONE_TEXT[view.tone]}`}
            >
              <span className={`h-2 w-2 rounded-full ${TONE_DOT[view.tone]}`} />
              {source.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
