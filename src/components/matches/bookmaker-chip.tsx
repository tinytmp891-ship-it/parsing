"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { styleOf, type BookmakerStyle } from "@/lib/bookmaker-style";
import type { Dict } from "@/lib/i18n";
import { tintOf } from "@/lib/match-colors";
import { SOURCE_NAMES } from "@/lib/matches-types";
import { useMatchStyle } from "./match-style";

/** The bookmaker's icon image, or a coloured dot when no icon is set or the image cannot be loaded. */
function BookmakerIcon({ style }: { style: BookmakerStyle }) {
  const [failed, setFailed] = useState(false);

  if (!style.iconUrl || failed) {
    return (
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.color }}
      />
    );
  }

  return (
    <img
      src={style.iconUrl}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
    />
  );
}

/** Bookmaker label in its colour, with the icon if one is set. Becomes a link when `href` is given. */
export function BookmakerChip({
  sourceId,
  href,
  className = "",
}: {
  sourceId: string;
  href?: string;
  className?: string;
}) {
  const { bookmakerStyles } = useMatchStyle();
  const style = styleOf(bookmakerStyles, sourceId);
  const classes = `ui-control inline-flex max-w-full items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold text-slate-900 ${
    href ? "transition hover:opacity-80" : ""
  } ${className}`;
  const chipStyle = { backgroundColor: tintOf(style.color), boxShadow: `inset 0 0 0 1px ${style.color}` };
  const inner = (
    <>
      <BookmakerIcon key={style.iconUrl} style={style} />
      <span className="truncate">{SOURCE_NAMES[sourceId] ?? sourceId}</span>
      {href ? <ArrowUpRight className="h-3 w-3 shrink-0 opacity-75" aria-hidden /> : null}
    </>
  );

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={classes} style={chipStyle}>
      {inner}
    </a>
  ) : (
    <span className={classes} style={chipStyle}>
      {inner}
    </span>
  );
}

/** One star per bookmaker that lists the match, each in that bookmaker's colour. */
export function StarLabels({ sources, t }: { sources: { source: string }[]; t: Dict }) {
  const { bookmakerStyles } = useMatchStyle();
  if (sources.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 leading-none" title={t.starsHint}>
      {sources.map((source) => {
        const style = styleOf(bookmakerStyles, source.source);
        const name = SOURCE_NAMES[source.source] ?? source.source;
        return (
          <span key={source.source} role="img" aria-label={name} title={name} className="text-lg" style={{ color: style.color }}>
            ★
          </span>
        );
      })}
    </span>
  );
}
