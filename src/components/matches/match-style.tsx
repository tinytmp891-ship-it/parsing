"use client";

import { createContext, useContext } from "react";
import { defaultBookmakerStyles, type BookmakerStyles } from "@/lib/bookmaker-style";
import type { Dict } from "@/lib/i18n";
import { DEFAULT_CHECKED_COLOR, DEFAULT_PARTIAL_COLOR } from "@/lib/match-colors";

/** Colours, checked state and bookmaker styles shared by every match view (bubbles, tournaments, table). */
export type MatchStyleValue = {
  partialColor: string;
  checkedColor: string;
  checkedIds: ReadonlySet<string>;
  toggleChecked: (id: string) => void;
  bookmakerStyles: BookmakerStyles;
};

export const MatchStyleContext = createContext<MatchStyleValue>({
  partialColor: DEFAULT_PARTIAL_COLOR,
  checkedColor: DEFAULT_CHECKED_COLOR,
  checkedIds: new Set<string>(),
  toggleChecked: () => {},
  bookmakerStyles: defaultBookmakerStyles(),
});

export function useMatchStyle(): MatchStyleValue {
  return useContext(MatchStyleContext);
}

/**
 * Icon-only control that marks a partial match as checked (✓) or unchecked (☐).
 * The text is kept for screen readers and the tooltip, but only the icon is drawn.
 */
export function CheckToggle({ id, checked, t }: { id: string; checked: boolean; t: Dict }) {
  const { toggleChecked } = useMatchStyle();
  const label = checked ? t.checkedBadge : t.markChecked;

  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      title={label}
      onClick={() => toggleChecked(id)}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ring-inset transition ${
        checked
          ? "bg-emerald-600 text-white ring-emerald-700 hover:bg-emerald-500"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-100"
      }`}
    >
      <span aria-hidden>{checked ? "✓" : "☐"}</span>
    </button>
  );
}
