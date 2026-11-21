"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  CloudSun,
  Droplets,
  FileText,
  Globe,
  Info,
  Landmark,
  Layers,
  MapPin,
  Thermometer,
  Wind,
  X,
} from "lucide-react";
import type { Dict, Lang } from "@/lib/i18n";
import { pick, type MatchVenueInfo } from "@/lib/matches-types";

type PopoverPos = {
  top: number;
  left: number;
  width: number;
};

/**
 * Compact `i` icon button that opens a viewport-safe floating info window with
 * country, city, stadium/venue, court surface, and weather details when available.
 * Portaled to document.body so parent match bubbles with `overflow-hidden` never clip it.
 */
export function MatchInfoPopover({
  info,
  matchTitle,
  lang,
  t,
}: {
  info: MatchVenueInfo;
  matchTitle: string;
  lang: Lang;
  t: Dict;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();

  const surfaceText = info.surface ? pick(info.surface, lang) : undefined;

  const rows = [
    info.country ? { key: "country", icon: Globe, label: t.infoCountry, value: info.country } : null,
    info.city ? { key: "city", icon: Building2, label: t.infoCity, value: info.city } : null,
    info.stadium ? { key: "stadium", icon: Landmark, label: t.infoStadium, value: info.stadium } : null,
    !info.stadium && info.venueRaw ? { key: "venue", icon: MapPin, label: t.infoVenue, value: info.venueRaw } : null,
    surfaceText ? { key: "surface", icon: Layers, label: t.infoSurface, value: surfaceText } : null,
    info.temperature ? { key: "temp", icon: Thermometer, label: t.infoTemperature, value: info.temperature } : null,
    info.weather ? { key: "weather", icon: CloudSun, label: t.infoWeather, value: info.weather } : null,
    info.wind ? { key: "wind", icon: Wind, label: t.infoWind, value: info.wind } : null,
    info.humidity ? { key: "humidity", icon: Droplets, label: t.infoHumidity, value: info.humidity } : null,
    info.note ? { key: "note", icon: FileText, label: t.infoNote, value: info.note } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(310, Math.max(240, vw - 16));
    const estHeight = Math.min(320, 68 + rows.length * 30);

    let left = rect.left;
    if (left + width > vw - 8) {
      left = Math.max(8, vw - width - 8);
    }
    if (left < 8) left = 8;

    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    let top = rect.bottom + 6;
    if (spaceBelow < estHeight && spaceAbove > spaceBelow) {
      top = Math.max(8, rect.top - estHeight - 6);
    } else if (top + estHeight > vh - 8) {
      top = Math.max(8, vh - estHeight - 8);
    }

    setPos({ top, left, width });
  }, [rows.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(id);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (dialogRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onViewportChange = () => updatePosition();

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, updatePosition]);

  if (rows.length === 0) return null;

  const summaryHint = [info.stadium || info.venueRaw, info.city, info.country].filter(Boolean).join(", ") || t.matchInfoTrigger;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        aria-label={`${t.matchInfoTrigger}: ${summaryHint}`}
        title={summaryHint}
        data-testid="match-info-trigger"
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition ${
          open
            ? "bg-sky-600 text-white ring-sky-600 shadow-sm"
            : "bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100 hover:text-sky-900"
        }`}
      >
        <Info className="h-3 w-3" aria-hidden />
      </button>

      {open && typeof document !== "undefined" && pos
        ? createPortal(
            <div
              ref={dialogRef}
              id={dialogId}
              role="dialog"
              aria-label={t.matchInfoTitle}
              data-testid="match-info-popover"
              style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}
              className="fixed z-50 rounded-xl bg-white p-3.5 text-xs shadow-xl ring-1 ring-slate-200"
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                    <Info className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
                    <span>{t.matchInfoTitle}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500" title={matchTitle}>
                    {matchTitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.close}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>

              <dl className="mt-2.5 space-y-2">
                {rows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.key} className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <dt className="w-24 shrink-0 text-[11px] font-medium text-slate-500">{row.label}</dt>
                      <dd className="min-w-0 flex-1 break-words font-medium text-slate-900">{row.value}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
