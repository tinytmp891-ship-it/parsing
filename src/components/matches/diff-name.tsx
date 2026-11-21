"use client";

import { diffSideName } from "@/lib/diff-names";

/**
 * Renders a partial-match team or player name compared against a reference name:
 * - Matching team/player names are underlined.
 * - Differing parts inside a mismatched name are highlighted in red.
 * - Equivalent markers (U19, Under 19, (U19), (19), (w), (women), (wom)) are ignored.
 */
export function DiffName({
  reference,
  candidate,
  individual = false,
}: {
  reference: string;
  candidate: string;
  individual?: boolean;
}) {
  const { segments } = diffSideName(reference, candidate, { individual });

  return (
    <span>
      {segments.map((segment, idx) => {
        if (segment.kind === "match") {
          return (
            <span key={idx} className="underline decoration-emerald-600 decoration-2 underline-offset-2 dark:decoration-emerald-700">
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "same") {
          return (
            <span key={idx} className="underline decoration-slate-400 decoration-1 underline-offset-2">
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "diff") {
          return (
            <span key={idx} className="font-bold text-rose-600 dark:text-rose-700">
              {segment.text}
            </span>
          );
        }
        return <span key={idx}>{segment.text}</span>;
      })}
    </span>
  );
}
