"use client";

import { Clock, Flag, Layers, Shield, Swords, Timer } from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";
import { pick, type MatchFormat, type MatchFormatCategory, type MatchFormatOrigin } from "@/lib/matches-types";

type CategoryVisual = {
  boxClass: string;
  iconClass: string;
  Icon: typeof Timer;
};

const CATEGORY_VISUALS: Record<MatchFormatCategory, CategoryVisual> = {
  quarters: {
    boxClass: "bg-sky-50/80 text-sky-900 ring-sky-200/90",
    iconClass: "text-sky-600",
    Icon: Timer,
  },
  periods: {
    boxClass: "bg-sky-50/80 text-sky-900 ring-sky-200/90",
    iconClass: "text-sky-600",
    Icon: Timer,
  },
  halves: {
    boxClass: "bg-emerald-50/80 text-emerald-900 ring-emerald-200/90",
    iconClass: "text-emerald-600",
    Icon: Clock,
  },
  series: {
    boxClass: "bg-violet-50/85 text-violet-900 ring-violet-200/90",
    iconClass: "text-violet-600",
    Icon: Swords,
  },
  sets: {
    boxClass: "bg-violet-50/85 text-violet-900 ring-violet-200/90",
    iconClass: "text-violet-600",
    Icon: Layers,
  },
  innings: {
    boxClass: "bg-lime-50/85 text-lime-900 ring-lime-200/90",
    iconClass: "text-lime-700",
    Icon: Flag,
  },
  rounds: {
    boxClass: "bg-orange-50/85 text-orange-900 ring-orange-200/90",
    iconClass: "text-orange-700",
    Icon: Shield,
  },
};

function originHint(origin: MatchFormatOrigin, t: Dict): string {
  switch (origin) {
    case "feed":
      return t.formatOriginFeed;
    case "title":
      return t.formatOriginTitle;
    case "league":
      return t.formatOriginLeague;
    case "sport":
      return t.formatOriginSport;
  }
}

export function MatchFormatBadge({
  format,
  lang,
  t,
  variant = "bubble",
}: {
  format: MatchFormat;
  lang: Lang;
  t: Dict;
  variant?: "bubble" | "compact";
}) {
  const visual = CATEGORY_VISUALS[format.category] ?? CATEGORY_VISUALS.periods;
  const { Icon } = visual;
  const detail = pick(format.label, lang);
  const title = `${detail} · ${originHint(format.origin, t)}`;

  if (variant === "compact") {
    return (
      <span
        title={title}
        data-testid="match-format-badge"
        className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-tight tabular-nums ring-1 ring-inset ${visual.boxClass}`}
      >
        <Icon className={`h-3 w-3 shrink-0 ${visual.iconClass}`} aria-hidden />
        <span>{format.code}</span>
      </span>
    );
  }

  return (
    <div
      title={title}
      data-testid="match-format-badge"
      className={`inline-flex shrink-0 flex-row items-center gap-2 rounded-lg px-2.5 py-1 ring-1 ring-inset sm:flex-col sm:items-end sm:gap-0.5 sm:px-3 sm:py-1.5 ${visual.boxClass}`}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold tracking-tight tabular-nums">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${visual.iconClass}`} aria-hidden />
        <span>{format.code}</span>
      </span>
      <span className="text-[11px] font-medium leading-tight opacity-80 sm:text-right">
        {detail}
      </span>
    </div>
  );
}
