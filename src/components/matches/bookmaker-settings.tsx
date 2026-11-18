"use client";

import { useEffect, useState } from "react";
import { BOOKMAKER_IDS, normalizeIconUrl, type BookmakerStyle, type BookmakerStyles } from "@/lib/bookmaker-style";
import type { Dict } from "@/lib/i18n";
import { SOURCE_NAMES } from "@/lib/matches-types";
import type { SourceId } from "@/lib/sources/model";
import { BookmakerChip } from "./bookmaker-chip";

/**
 * Icon link input. Only a valid http(s) link is saved; a half-typed link keeps the last saved icon
 * and shows an error, so the label does not flicker while typing.
 */
function IconUrlField({
  value,
  label,
  placeholder,
  invalidText,
  onSave,
}: {
  value: string;
  label: string;
  placeholder: string;
  invalidText: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const trimmed = draft.trim();
  const invalid = trimmed.length > 0 && normalizeIconUrl(trimmed) === "";

  return (
    <div>
      <input
        type="url"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const candidate = next.trim();
          if (candidate === "") onSave("");
          else {
            const valid = normalizeIconUrl(candidate);
            if (valid) onSave(valid);
          }
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
      />
      {invalid ? <p className="mt-1 text-xs text-rose-700">{invalidText}</p> : null}
    </div>
  );
}

/** Colour and icon setting for every bookmaker, with a live preview label. */
export function BookmakerSettings({
  styles,
  t,
  onChange,
  onReset,
}: {
  styles: BookmakerStyles;
  t: Dict;
  onChange: (id: SourceId, patch: Partial<BookmakerStyle>) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">{t.bookmakerStylesTitle}</p>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          {t.bookmakerStylesReset}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t.bookmakerStylesHint}</p>

      <ul className="mt-3 space-y-2">
        {BOOKMAKER_IDS.map((id) => {
          const style = styles[id];
          return (
            <li
              key={id}
              className="grid items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200 md:grid-cols-[200px_1fr_auto]"
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`${SOURCE_NAMES[id]} ${t.bookmakerColorLabel}`}
                  value={style.color}
                  onChange={(event) => onChange(id, { color: event.target.value })}
                  className="h-8 w-12 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
                />
                <span className="text-sm font-semibold text-slate-900">{SOURCE_NAMES[id]}</span>
              </div>

              <IconUrlField
                value={style.iconUrl}
                label={`${SOURCE_NAMES[id]} ${t.bookmakerIconLabel}`}
                placeholder={t.bookmakerIconPlaceholder}
                invalidText={t.bookmakerIconInvalid}
                onSave={(url) => onChange(id, { iconUrl: url })}
              />

              <BookmakerChip sourceId={id} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
