"use client";

import { useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import { formatCountdown, formatElapsed } from "@/lib/matches-types";

/** Time left until kickoff, ticking every second. */
export function Countdown({ startsAt, t }: { startsAt: number; t: Dict }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = startsAt - now;
  if (remaining <= 0) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
        {t.startingNow}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-200">
      <span className="opacity-70">{t.startsIn}</span>
      <span>{formatCountdown(remaining)}</span>
    </span>
  );
}

/** Time since kickoff, for matches in the Started tab. */
export function Elapsed({ startedAt, t }: { startedAt: number; t: Dict }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const label = elapsed < 60_000 ? t.justStarted : t.startedAgo(formatElapsed(elapsed));
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold tabular-nums text-amber-900 ring-1 ring-inset ring-amber-300">
      {label}
    </span>
  );
}
