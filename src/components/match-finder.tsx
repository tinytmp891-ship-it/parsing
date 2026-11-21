"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Calendar,
  Clock,
  Download,
  EyeOff,
  LayoutGrid,
  Moon,
  Palette,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Table2,
  Trophy,
  X,
} from "lucide-react";
import { dictionaries, type Dict, type Lang } from "@/lib/i18n";
import { leagueKeyOf } from "@/lib/league-key";
import { buildMatchesCsv, downloadTextFile } from "@/lib/matches-csv";
import {
  dayKeyOf,
  pick,
  sportIcon,
  statusOf,
  STATUS_DOT,
  toLocalInput,
  type ApiResponse,
  type Day,
  type Entry,
  type GroupBy,
  type Slot,
  type Tab,
  type Theme,
  type TournamentGroup,
  type View,
} from "@/lib/matches-types";
import { BubbleView, TournamentBubbleView } from "./matches/bubble-view";
import { HiddenLeaguesBar, LeagueFilter, type HiddenLeague } from "./matches/league-filter";
import { SyncCard } from "./matches/sync-card";
import { TableView } from "./matches/table-view";
import MatchChecker from "./match-checker";
import { DEFAULT_CHECKED_COLOR, DEFAULT_PARTIAL_COLOR, normalizeHex, tintOf } from "@/lib/match-colors";
import {
  defaultBookmakerStyles,
  normalizeBookmakerStyles,
  normalizeIconUrl,
  styleOf,
  type BookmakerStyle,
  type BookmakerStyles,
} from "@/lib/bookmaker-style";
import type { SourceId } from "@/lib/sources/model";
import { BookmakerSettings } from "./matches/bookmaker-settings";
import { MatchStyleContext } from "./matches/match-style";
import { ProxyManager } from "./matches/proxy-manager";
import type { ProxyPoolSnapshot } from "@/lib/proxy/types";
import {
  ACCENT_SWATCHES,
  applyUiPreferencesToRoot,
  DEFAULT_UI_PREFS,
  normalizeUiPreferences,
  UI_PREFS_STORAGE_KEY,
  type AccentPreset,
  type DensityPreset,
  type RadiusPreset,
  type SurfacePreset,
  type UiPreferences,
} from "@/lib/ui-preferences";

const PRESET_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PAGE_SIZE = 80;
const DAY_MS = 24 * 3600_000;
const MAX_CUSTOM_DAYS = 31;
const DEFAULT_GRACE = 10;
const MAX_GRACE = 60;
const LANG_STORAGE_KEY = "matches-lang";
const THEME_STORAGE_KEY = "matches-theme";
const GRACE_STORAGE_KEY = "matches-grace";
const VIEW_STORAGE_KEY = "matches-view";
const GROUP_STORAGE_KEY = "matches-group";
const PARTIAL_COLOR_KEY = "matches-partial-color";
const CHECKED_COLOR_KEY = "matches-checked-color";
const CHECKED_IDS_KEY = "matches-checked-ids";
const BOOKMAKER_STYLES_KEY = "matches-bookmaker-styles";
const HIDDEN_LEAGUES_KEY = "matches-hidden-leagues";
const MARGIN_LEFT_KEY = "matches-margin-left";
const MARGIN_RIGHT_KEY = "matches-margin-right";
const HIDE_PROXY_CONTROLS_KEY = "matches-hide-proxy-controls";
const DEFAULT_HIDE_PROXY_CONTROLS = true;
const DEFAULT_SIDE_MARGIN = 64;
const MAX_SIDE_MARGIN = 360;
const MAX_CHECKED = 2000;

const ACCENT_KEYS: AccentPreset[] = ["emerald", "sky", "indigo", "amber", "rose", "violet"];

function clampMargin(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_SIDE_MARGIN;
  return Math.min(MAX_SIDE_MARGIN, Math.max(0, Math.round(value)));
}

function IconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`ui-control inline-flex h-9 w-9 items-center justify-center shadow-sm ring-1 transition ${
        pressed
          ? "ui-accent-bg ring-transparent"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100 hover:text-slate-950"
      }`}
    >
      <span aria-hidden className="inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  );
}

function ColorField({
  label,
  value,
  previewText,
  onChange,
}: {
  label: string;
  value: string;
  previewText: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-14 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
        />
        <span
          className="ui-control inline-flex items-center px-3 py-1.5 text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-200"
          style={{ backgroundColor: tintOf(value) }}
        >
          {previewText}
        </span>
      </div>
    </label>
  );
}

function SegmentedOptionButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`ui-control px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "ui-accent-bg shadow-sm"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function SettingsPanel({
  grace,
  t,
  theme,
  uiPrefs,
  onUiPrefs,
  onResetUiPrefs,
  onChange,
  marginLeft,
  marginRight,
  onMarginLeft,
  onMarginRight,
  onResetMargins,
  hiddenLeagues,
  lang,
  onRestoreLeague,
  onRestoreAllLeagues,
  partialColor,
  checkedColor,
  checkedCount,
  onPartialColor,
  onCheckedColor,
  onResetColors,
  onClearChecked,
  bookmakerStyles,
  onBookmakerStyle,
  onResetBookmakers,
  hideProxyControls,
  onHideProxyControls,
  onOpenProxyManager,
  onClose,
}: {
  grace: number;
  t: Dict;
  theme: Theme;
  uiPrefs: UiPreferences;
  onUiPrefs: (patch: Partial<UiPreferences>) => void;
  onResetUiPrefs: () => void;
  onChange: (value: number) => void;
  marginLeft: number;
  marginRight: number;
  onMarginLeft: (value: number) => void;
  onMarginRight: (value: number) => void;
  onResetMargins: () => void;
  hiddenLeagues: HiddenLeague[];
  lang: Lang;
  onRestoreLeague: (key: string) => void;
  onRestoreAllLeagues: () => void;
  partialColor: string;
  checkedColor: string;
  checkedCount: number;
  onPartialColor: (value: string) => void;
  onCheckedColor: (value: string) => void;
  onResetColors: () => void;
  onClearChecked: () => void;
  bookmakerStyles: BookmakerStyles;
  onBookmakerStyle: (id: SourceId, patch: Partial<BookmakerStyle>) => void;
  onResetBookmakers: () => void;
  hideProxyControls: boolean;
  onHideProxyControls: (hide: boolean) => void;
  onOpenProxyManager: () => void;
  onClose: () => void;
}) {
  const stylePresets: { id: string; label: string; prefs: UiPreferences }[] = [
    { id: "clean", label: t.uiPresetClean, prefs: DEFAULT_UI_PREFS },
    {
      id: "compact",
      label: t.uiPresetCompact,
      prefs: {
        accent: "sky",
        radius: "rounded",
        density: "compact",
        surface: "matte",
        motionEnabled: true,
        ambientBackdrop: false,
      },
    },
    {
      id: "lounge",
      label: t.uiPresetLounge,
      prefs: {
        accent: "violet",
        radius: "pill",
        density: "spacious",
        surface: "frosted",
        motionEnabled: true,
        ambientBackdrop: true,
      },
    },
    {
      id: "sharp",
      label: t.uiPresetSharp,
      prefs: {
        accent: "indigo",
        radius: "sharp",
        density: "compact",
        surface: "elevated",
        motionEnabled: false,
        ambientBackdrop: false,
      },
    },
  ];

  const isPresetActive = (p: UiPreferences) =>
    p.accent === uiPrefs.accent &&
    p.radius === uiPrefs.radius &&
    p.density === uiPrefs.density &&
    p.surface === uiPrefs.surface &&
    p.motionEnabled === uiPrefs.motionEnabled &&
    p.ambientBackdrop === uiPrefs.ambientBackdrop;

  return (
    <section className="ui-card ui-card-pad bg-white shadow-sm ring-1 ring-slate-200/90">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 ui-accent-text" aria-hidden />
          <h2 className="text-base font-semibold text-slate-950">{t.settingsTitle}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ui-control inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t.close}
        </button>
      </div>

      {/* Fancy UI Appearance Studio */}
      <div className="mt-5 rounded-xl bg-slate-50/90 p-4 ring-1 ring-inset ring-slate-200/80">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
              <Sparkles className="h-4 w-4 ui-accent-text" aria-hidden />
              {t.uiTitle}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t.uiSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onResetUiPrefs}
            className="ui-control inline-flex items-center gap-1.5 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t.uiReset}
          </button>
        </div>

        {/* Quick Style Presets */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.uiPresetLabel}</p>
          <div className="flex flex-wrap gap-2">
            {stylePresets.map((preset) => (
              <SegmentedOptionButton
                key={preset.id}
                active={isPresetActive(preset.prefs)}
                label={preset.label}
                onClick={() => onUiPrefs(preset.prefs)}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Accent Swatches */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.uiAccentLabel}</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_KEYS.map((key) => {
                const active = uiPrefs.accent === key;
                const swatchColor = theme === "dark" ? ACCENT_SWATCHES[key].dark : ACCENT_SWATCHES[key].light;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onUiPrefs({ accent: key })}
                    aria-label={`${t.uiAccentLabel}: ${key}`}
                    aria-pressed={active}
                    className={`ui-control inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold capitalize transition ${
                      active
                        ? "bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/20"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span className="h-3 w-3 rounded-full ring-1 ring-black/15" style={{ backgroundColor: swatchColor }} />
                    {key}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Corner Geometry */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.uiRadiusLabel}</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "sharp", label: t.uiRadiusSharp },
                  { id: "rounded", label: t.uiRadiusRounded },
                  { id: "pill", label: t.uiRadiusPill },
                ] as { id: RadiusPreset; label: string }[]
              ).map((item) => (
                <SegmentedOptionButton
                  key={item.id}
                  active={uiPrefs.radius === item.id}
                  label={item.label}
                  onClick={() => onUiPrefs({ radius: item.id })}
                />
              ))}
            </div>
          </div>

          {/* Layout Density */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.uiDensityLabel}</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "compact", label: t.uiDensityCompact },
                  { id: "balanced", label: t.uiDensityBalanced },
                  { id: "spacious", label: t.uiDensitySpacious },
                ] as { id: DensityPreset; label: string }[]
              ).map((item) => (
                <SegmentedOptionButton
                  key={item.id}
                  active={uiPrefs.density === item.id}
                  label={item.label}
                  onClick={() => onUiPrefs({ density: item.id })}
                />
              ))}
            </div>
          </div>

          {/* Card Surface Finish */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.uiSurfaceLabel}</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "matte", label: t.uiSurfaceMatte },
                  { id: "frosted", label: t.uiSurfaceFrosted },
                  { id: "elevated", label: t.uiSurfaceElevated },
                ] as { id: SurfacePreset; label: string }[]
              ).map((item) => (
                <SegmentedOptionButton
                  key={item.id}
                  active={uiPrefs.surface === item.id}
                  label={item.label}
                  onClick={() => onUiPrefs({ surface: item.id })}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Motion & Ambient Toggles */}
        <div className="mt-4 flex flex-wrap gap-5 border-t border-slate-200/80 pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={uiPrefs.motionEnabled}
              onChange={(event) => onUiPrefs({ motionEnabled: event.target.checked })}
              className="ui-accent-slider h-4 w-4"
            />
            {t.uiMotionLabel}
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={uiPrefs.ambientBackdrop}
              onChange={(event) => onUiPrefs({ ambientBackdrop: event.target.checked })}
              className="ui-accent-slider h-4 w-4"
            />
            {t.uiAmbientLabel}
          </label>
        </div>
      </div>

      <label className="mt-5 block text-sm">
        <span className="font-medium text-slate-800">{t.graceLabel}</span>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={MAX_GRACE}
            step={1}
            value={grace}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange(Number.isNaN(parsed) ? 0 : Math.min(MAX_GRACE, Math.max(0, parsed)));
            }}
            className="ui-accent-input w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <span className="text-sm text-slate-600">{t.graceUnit}</span>
        </div>
      </label>
      <p className="mt-2 text-xs text-slate-500">{t.graceHint}</p>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
            <Shield className="h-4 w-4 text-slate-500" aria-hidden />
            {t.hideProxyTitle}
          </p>
          <button
            type="button"
            onClick={onOpenProxyManager}
            className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <Shield className="h-3.5 w-3.5" aria-hidden />
            {t.openProxyManagerBtn}
          </button>
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={hideProxyControls}
            onChange={(event) => onHideProxyControls(event.target.checked)}
            className="ui-accent-slider h-4 w-4"
          />
          {t.hideProxyLabel}
        </label>
        <p className="mt-1.5 text-xs text-slate-500">{t.hideProxyHint}</p>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-950">{t.marginsTitle}</p>
          <button
            type="button"
            onClick={onResetMargins}
            className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t.marginReset}
          </button>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-800">{t.marginLeftLabel}</span>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={MAX_SIDE_MARGIN}
                step={8}
                value={marginLeft}
                aria-label={t.marginLeftLabel}
                onChange={(event) => onMarginLeft(clampMargin(Number(event.target.value)))}
                className="ui-accent-slider flex-1"
              />
              <input
                type="number"
                min={0}
                max={MAX_SIDE_MARGIN}
                step={8}
                value={marginLeft}
                aria-label={`${t.marginLeftLabel} px`}
                onChange={(event) => onMarginLeft(clampMargin(Number.parseInt(event.target.value, 10)))}
                className="ui-accent-input w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              />
              <span className="text-xs text-slate-500">px</span>
            </div>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-800">{t.marginRightLabel}</span>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={MAX_SIDE_MARGIN}
                step={8}
                value={marginRight}
                aria-label={t.marginRightLabel}
                onChange={(event) => onMarginRight(clampMargin(Number(event.target.value)))}
                className="ui-accent-slider flex-1"
              />
              <input
                type="number"
                min={0}
                max={MAX_SIDE_MARGIN}
                step={8}
                value={marginRight}
                aria-label={`${t.marginRightLabel} px`}
                onChange={(event) => onMarginRight(clampMargin(Number.parseInt(event.target.value, 10)))}
                className="ui-accent-input w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              />
              <span className="text-xs text-slate-500">px</span>
            </div>
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t.marginHint}</p>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
            <EyeOff className="h-4 w-4 text-slate-500" aria-hidden />
            {t.hiddenTournamentsTitle}
          </p>
          {hiddenLeagues.length > 0 ? (
            <button
              type="button"
              onClick={onRestoreAllLeagues}
              className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              {t.restoreAllTournaments}
            </button>
          ) : null}
        </div>
        {hiddenLeagues.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">{t.noHiddenTournaments}</p>
        ) : (
          <HiddenLeaguesBar
            hiddenLeagues={hiddenLeagues}
            lang={lang}
            t={t}
            onRestore={onRestoreLeague}
            onRestoreAll={onRestoreAllLeagues}
          />
        )}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
          <Palette className="h-4 w-4 ui-accent-text" aria-hidden />
          {t.colorsTitle}
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ColorField
            label={t.partialColorLabel}
            value={partialColor}
            previewText={t.partialBadge}
            onChange={onPartialColor}
          />
          <ColorField
            label={t.checkedColorLabel}
            value={checkedColor}
            previewText={t.checkedBadge}
            onChange={onCheckedColor}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">{t.colorHint}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onResetColors}
            className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t.colorReset}
          </button>
          <button
            type="button"
            onClick={onClearChecked}
            disabled={checkedCount === 0}
            className="ui-control bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.clearChecked}
          </button>
          <span className="text-xs text-slate-500">{t.checkedCount(checkedCount)}</span>
        </div>
      </div>

      <BookmakerSettings styles={bookmakerStyles} t={t} onChange={onBookmakerStyle} onReset={onResetBookmakers} />
    </section>
  );
}

export default function MatchFinder() {
  const [lang, setLang] = useState<Lang>("en");
  const [theme, setTheme] = useState<Theme>("light");
  const [view, setView] = useState<View>("bubbles");
  const [groupBy, setGroupBy] = useState<GroupBy>("time");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [grace, setGrace] = useState(DEFAULT_GRACE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [hideProxyControls, setHideProxyControls] = useState(DEFAULT_HIDE_PROXY_CONTROLS);
  const [proxyStats, setProxyStats] = useState<ProxyPoolSnapshot["stats"] | null>(null);
  const [uiPrefs, setUiPrefs] = useState<UiPreferences>(DEFAULT_UI_PREFS);
  const [uiPrefsLoaded, setUiPrefsLoaded] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  // Quick periods ("next 24 h", "next 3 days", "next 7 days") are relative, so the server recomputes them on each request.
  const [quickDays, setQuickDays] = useState<number | null>(null);
  const [hours, setHours] = useState(2);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sportKeys, setSportKeys] = useState<string[]>([]);
  const [hiddenLeagues, setHiddenLeagues] = useState<HiddenLeague[]>([]);
  const [hiddenLeaguesLoaded, setHiddenLeaguesLoaded] = useState(false);
  const [marginLeft, setMarginLeft] = useState(DEFAULT_SIDE_MARGIN);
  const [marginRight, setMarginRight] = useState(DEFAULT_SIDE_MARGIN);
  const [bookmakerIds, setBookmakerIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [showCountdown, setShowCountdown] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0);
  const [partialColor, setPartialColor] = useState(DEFAULT_PARTIAL_COLOR);
  const [checkedColor, setCheckedColor] = useState(DEFAULT_CHECKED_COLOR);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [checkedLoaded, setCheckedLoaded] = useState(false);
  const [bookmakerStyles, setBookmakerStyles] = useState<BookmakerStyles>(defaultBookmakerStyles);
  const [stylesLoaded, setStylesLoaded] = useState(false);

  const t = dictionaries[lang];
  const locale = lang === "ru" ? "ru-RU" : "en-US";

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }),
    [locale],
  );
  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }),
    [locale],
  );
  const stampFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      const savedLang = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (savedLang === "en" || savedLang === "ru") setLang(savedLang);
      const savedGrace = Number.parseInt(window.localStorage.getItem(GRACE_STORAGE_KEY) ?? "", 10);
      if (!Number.isNaN(savedGrace)) setGrace(Math.min(MAX_GRACE, Math.max(0, savedGrace)));
      const savedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (savedView === "bubbles" || savedView === "table") setView(savedView);
      const savedGroup = window.localStorage.getItem(GROUP_STORAGE_KEY);
      if (savedGroup === "time" || savedGroup === "tournament") setGroupBy(savedGroup);
      setPartialColor(normalizeHex(window.localStorage.getItem(PARTIAL_COLOR_KEY), DEFAULT_PARTIAL_COLOR));
      setCheckedColor(normalizeHex(window.localStorage.getItem(CHECKED_COLOR_KEY), DEFAULT_CHECKED_COLOR));
      try {
        const parsedPrefs = normalizeUiPreferences(JSON.parse(window.localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "null"));
        setUiPrefs(parsedPrefs);
        applyUiPreferencesToRoot(parsedPrefs);
      } catch {
        setUiPrefs(DEFAULT_UI_PREFS);
        applyUiPreferencesToRoot(DEFAULT_UI_PREFS);
      }
      setUiPrefsLoaded(true);

      try {
        const saved: unknown = JSON.parse(window.localStorage.getItem(CHECKED_IDS_KEY) ?? "[]");
        if (Array.isArray(saved)) {
          setCheckedIds(saved.filter((id): id is string => typeof id === "string").slice(-MAX_CHECKED));
        }
      } catch {
        // Unreadable saved data is ignored; the checked list starts empty.
      }
      setCheckedLoaded(true);
      try {
        setBookmakerStyles(normalizeBookmakerStyles(JSON.parse(window.localStorage.getItem(BOOKMAKER_STYLES_KEY) ?? "null")));
      } catch {
        setBookmakerStyles(defaultBookmakerStyles());
      }
      setStylesLoaded(true);
      try {
        const savedHidden: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_LEAGUES_KEY) ?? "[]");
        if (Array.isArray(savedHidden)) {
          setHiddenLeagues(
            savedHidden.filter(
              (item): item is HiddenLeague =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as HiddenLeague).key === "string" &&
                typeof (item as HiddenLeague).sportKey === "string" &&
                typeof (item as HiddenLeague).name?.en === "string",
            ),
          );
        }
      } catch {
        // Ignore malformed stored hidden leagues.
      }
      setHiddenLeaguesLoaded(true);
      const savedMl = Number.parseInt(window.localStorage.getItem(MARGIN_LEFT_KEY) ?? "", 10);
      if (!Number.isNaN(savedMl)) setMarginLeft(clampMargin(savedMl));
      const savedMr = Number.parseInt(window.localStorage.getItem(MARGIN_RIGHT_KEY) ?? "", 10);
      if (!Number.isNaN(savedMr)) setMarginRight(clampMargin(savedMr));
      const savedHideProxy = window.localStorage.getItem(HIDE_PROXY_CONTROLS_KEY);
      if (savedHideProxy === "0" || savedHideProxy === "false") setHideProxyControls(false);
      else if (savedHideProxy === "1" || savedHideProxy === "true") setHideProxyControls(true);
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
      setNow(Date.now());
    }, 0);

    const onScroll = () => setShowBackTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    // Fetch initial proxy count badge without blocking first paint.
    const proxyTimer = window.setTimeout(() => {
      fetch("/api/proxies", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ProxyPoolSnapshot>) : null))
        .then((snap) => {
          if (snap?.stats) setProxyStats(snap.stats);
        })
        .catch(() => undefined);
    }, 50);
    // Ticks every 10 seconds so finished matches leave the lists on time, even between server responses.
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      window.clearTimeout(hydrateTimer);
      window.clearTimeout(proxyTimer);
      window.removeEventListener("scroll", onScroll);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!uiPrefsLoaded) return;
    applyUiPreferencesToRoot(uiPrefs);
    window.localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(uiPrefs));
  }, [uiPrefs, uiPrefsLoaded]);

  const updateUiPrefs = useCallback((patch: Partial<UiPreferences>) => {
    setUiPrefs((current) => ({ ...current, ...patch }));
  }, []);

  const resetUiPrefs = useCallback(() => {
    setUiPrefs({ ...DEFAULT_UI_PREFS });
  }, []);

  const changeLang = (next: Lang) => {
    setLang(next);
    window.localStorage.setItem(LANG_STORAGE_KEY, next);
  };

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  };

  const changeGrace = (value: number) => {
    setGrace(value);
    window.localStorage.setItem(GRACE_STORAGE_KEY, String(value));
  };

  const changeMarginLeft = (value: number) => {
    const next = clampMargin(value);
    setMarginLeft(next);
    window.localStorage.setItem(MARGIN_LEFT_KEY, String(next));
  };

  const changeMarginRight = (value: number) => {
    const next = clampMargin(value);
    setMarginRight(next);
    window.localStorage.setItem(MARGIN_RIGHT_KEY, String(next));
  };

  const resetMargins = () => {
    changeMarginLeft(DEFAULT_SIDE_MARGIN);
    changeMarginRight(DEFAULT_SIDE_MARGIN);
  };

  const changeHideProxyControls = (value: boolean) => {
    setHideProxyControls(value);
    window.localStorage.setItem(HIDE_PROXY_CONTROLS_KEY, value ? "1" : "0");
  };

  const changePartialColor = (value: string) => {
    const next = normalizeHex(value, DEFAULT_PARTIAL_COLOR);
    setPartialColor(next);
    window.localStorage.setItem(PARTIAL_COLOR_KEY, next);
  };

  const changeCheckedColor = (value: string) => {
    const next = normalizeHex(value, DEFAULT_CHECKED_COLOR);
    setCheckedColor(next);
    window.localStorage.setItem(CHECKED_COLOR_KEY, next);
  };

  const resetColors = () => {
    changePartialColor(DEFAULT_PARTIAL_COLOR);
    changeCheckedColor(DEFAULT_CHECKED_COLOR);
  };

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-MAX_CHECKED),
    );
  }, []);

  const clearChecked = () => setCheckedIds([]);

  // Bookmaker colour and icon. Values are validated on every change, so only valid colours and http(s) links are stored.
  const changeBookmakerStyle = useCallback((id: SourceId, patch: Partial<BookmakerStyle>) => {
    setBookmakerStyles((current) => ({
      ...current,
      [id]: {
        color: patch.color !== undefined ? normalizeHex(patch.color, current[id].color) : current[id].color,
        iconUrl: patch.iconUrl !== undefined ? normalizeIconUrl(patch.iconUrl) : current[id].iconUrl,
      },
    }));
  }, []);

  const resetBookmakerStyles = useCallback(() => setBookmakerStyles(defaultBookmakerStyles()), []);

  // Save bookmaker colours and icons whenever they change. Skipped until the saved values have been read.
  useEffect(() => {
    if (!stylesLoaded) return;
    window.localStorage.setItem(BOOKMAKER_STYLES_KEY, JSON.stringify(bookmakerStyles));
  }, [bookmakerStyles, stylesLoaded]);

  // Save checked matches whenever they change. Skipped until the saved list has been read.
  useEffect(() => {
    if (!checkedLoaded) return;
    window.localStorage.setItem(CHECKED_IDS_KEY, JSON.stringify(checkedIds));
  }, [checkedIds, checkedLoaded]);

  // Save permanently hidden championships whenever they change.
  useEffect(() => {
    if (!hiddenLeaguesLoaded) return;
    window.localStorage.setItem(HIDDEN_LEAGUES_KEY, JSON.stringify(hiddenLeagues));
  }, [hiddenLeagues, hiddenLeaguesLoaded]);

  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const styleValue = useMemo(
    () => ({ partialColor, checkedColor, checkedIds: checkedSet, toggleChecked, bookmakerStyles }),
    [partialColor, checkedColor, checkedSet, toggleChecked, bookmakerStyles],
  );

  const changeView = (next: View) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  const changeGroup = (next: GroupBy) => {
    setGroupBy(next);
    setVisibleCount(PAGE_SIZE);
    window.localStorage.setItem(GROUP_STORAGE_KEY, next);
  };

  const switchTab = (next: Tab) => {
    setVisibleCount(PAGE_SIZE);
    setTab(next);
  };

  const customError: string | null = (() => {
    if (tab !== "upcoming" || mode !== "custom") return null;
    if (!customFrom || !customTo) return t.customMissing;
    const from = new Date(customFrom).getTime();
    const to = new Date(customTo).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return t.customInvalid;
    if (to <= from) return t.customOrder;
    if (to - from > MAX_CUSTOM_DAYS * DAY_MS) return t.customTooLong;
    return null;
  })();

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (tab === "started") {
      params.set("grace", String(grace));
    } else if (quickDays !== null) {
      params.set("days", String(quickDays));
    } else if (mode === "preset") {
      params.set("hours", String(hours));
    } else if (customFrom && customTo) {
      params.set("from", new Date(customFrom).toISOString());
      params.set("to", new Date(customTo).toISOString());
    }
    if (sportKeys.length > 0) params.set("sports", sportKeys.join(","));
    if (hiddenLeagues.length > 0) params.set("hideLeagues", hiddenLeagues.map((h) => h.key).join(","));
    if (bookmakerIds.length > 0) params.set("bookmakers", bookmakerIds.join(","));
    return params.toString();
  }, [tab, grace, mode, quickDays, hours, customFrom, customTo, sportKeys, hiddenLeagues, bookmakerIds]);

  const load = useCallback(async () => {
    if (customError) return;
    try {
      // A timeout stops a request that never answers from leaving the page in a loading state.
      const response = await fetch(`/api/matches?${queryString}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json || !json.sync) throw new Error(json?.error ?? `Request failed (${response.status})`);
      setData(json as ApiResponse);
      setError(null);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setLoading(false);
    }
  }, [queryString, customError]);

  useEffect(() => {
    if (customError) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, customError]);

  const syncing = data?.sync?.running ?? false;

  // Poll faster while a sync runs so each bookmaker's state updates; the Started tab refreshes often too.
  useEffect(() => {
    const interval = syncing ? 2000 : tab === "started" ? 15000 : 30000;
    const id = window.setInterval(() => void load(), interval);
    return () => window.clearInterval(id);
  }, [load, syncing, tab]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const applyQuickRange = (days: number) => {
    const start = new Date();
    const end = new Date(start.getTime() + days * DAY_MS);
    setCustomFrom(toLocalInput(start));
    setCustomTo(toLocalInput(end));
    setVisibleCount(PAGE_SIZE);
  };

  const switchToCustom = () => {
    if (!customFrom || !customTo) applyQuickRange(1);
    setVisibleCount(PAGE_SIZE);
    setQuickDays(null);
    setMode("custom");
  };

  const switchToPreset = (value: number) => {
    setVisibleCount(PAGE_SIZE);
    setMode("preset");
    setHours(value);
    setQuickDays(null);
  };

  const switchToDays = (days: number) => {
    setVisibleCount(PAGE_SIZE);
    setMode("preset");
    setQuickDays(days);
  };

  const toggleSport = (key: string) => {
    setVisibleCount(PAGE_SIZE);
    setSportKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const toggleBookmaker = (id: string) => {
    setVisibleCount(PAGE_SIZE);
    setBookmakerIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const toggleLeague = useCallback((league: HiddenLeague) => {
    setVisibleCount(PAGE_SIZE);
    setHiddenLeagues((current) =>
      current.some((item) => item.key === league.key)
        ? current.filter((item) => item.key !== league.key)
        : [...current, league],
    );
  }, []);

  const hideLeaguePermanently = useCallback((league: HiddenLeague) => {
    setVisibleCount(PAGE_SIZE);
    setHiddenLeagues((current) => (current.some((item) => item.key === league.key) ? current : [...current, league]));
  }, []);

  const restoreLeague = useCallback((key: string) => {
    setVisibleCount(PAGE_SIZE);
    setHiddenLeagues((current) => current.filter((item) => item.key !== key));
  }, []);

  const showAllLeagues = useCallback(() => {
    setVisibleCount(PAGE_SIZE);
    setHiddenLeagues([]);
  }, []);

  const entries = useMemo<Entry[]>(() => data?.entries ?? [], [data]);

  // Browser-side time filter: Upcoming shows only matches that have not started, and Started shows only
  // matches that started within the grace period. This holds even when the last server response is a few seconds old.
  const timeFiltered = useMemo<Entry[]>(() => {
    if (!now) return entries;
    const graceMs = grace * 60_000;
    return entries.filter((entry) => {
      const start = Date.parse(entry.startsAt);
      return tab === "upcoming" ? start > now : start <= now && start >= now - graceMs;
    });
  }, [entries, now, tab, grace]);

  const availableFormats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of timeFiltered) {
      if (!entry.matchFormat?.code) continue;
      counts.set(entry.matchFormat.code, (counts.get(entry.matchFormat.code) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [timeFiltered]);

  const effectiveFormatFilter = useMemo(
    () => (formatFilter !== "all" && availableFormats.some((f) => f.code === formatFilter) ? formatFilter : "all"),
    [formatFilter, availableFormats],
  );

  const searched = useMemo<Entry[]>(() => {
    const normalizeQuery = (value: string) => value.toLowerCase().replace(/[×х]/g, "x");
    const term = normalizeQuery(search.trim());
    return timeFiltered.filter((entry) => {
      if (effectiveFormatFilter !== "all" && entry.matchFormat?.code !== effectiveFormatFilter) {
        return false;
      }
      if (!term) return true;
      return normalizeQuery(
        [
          entry.home.en,
          entry.home.ru,
          entry.away.en,
          entry.away.ru,
          entry.leagueName.en,
          entry.leagueName.ru,
          entry.sportName.en,
          entry.sportName.ru,
          entry.matchFormat?.code ?? "",
          entry.matchFormat?.label.en ?? "",
          entry.matchFormat?.label.ru ?? "",
          entry.tournamentStage?.label.en ?? "",
          entry.tournamentStage?.label.ru ?? "",
          entry.matchInfo?.country ?? "",
          entry.matchInfo?.city ?? "",
          entry.matchInfo?.stadium ?? "",
          entry.matchInfo?.venueRaw ?? "",
          entry.matchInfo?.surface?.en ?? "",
          entry.matchInfo?.surface?.ru ?? "",
        ].join(" "),
      ).includes(term);
    });
  }, [timeFiltered, search, effectiveFormatFilter]);

  const visible = useMemo(() => searched.slice(0, visibleCount), [searched, visibleCount]);
  const hasRows = visible.length > 0;

  // Time view: day -> time group (exact kickoff minute). Each time group is one bubble or table block.
  const todayKey = now ? dayKeyOf(new Date(now)) : "";
  const tomorrowKey = now ? dayKeyOf(new Date(now + DAY_MS)) : "";

  const days: Day[] = [];
  for (const entry of visible) {
    const date = new Date(entry.startsAt);
    const key = dayKeyOf(date);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const base = dayFormatter.format(date);
      const label = key === todayKey ? `${t.today} · ${base}` : key === tomorrowKey ? `${t.tomorrow} · ${base}` : base;
      day = { key, label, count: 0, slots: [] as Slot[] };
      days.push(day);
    }
    const minute = Math.floor(date.getTime() / 60_000);
    let slot = day.slots[day.slots.length - 1];
    if (!slot || slot.minute !== minute) {
      slot = { minute, startsAt: date.getTime(), time: timeFormatter.format(date), entries: [] };
      day.slots.push(slot);
    }
    slot.entries.push(entry);
    day.count += 1;
  }

  // Tournament view: one group per league, rows sorted by kickoff.
  const tournaments = useMemo<TournamentGroup[]>(() => {
    if (groupBy !== "tournament") return [];
    const groups = new Map<string, TournamentGroup>();
    for (const entry of visible) {
      const key = leagueKeyOf(entry.sportKey, entry.leagueName.en);
      const startsAt = Date.parse(entry.startsAt);
      const date = new Date(startsAt);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          sportKey: entry.sportKey,
          sportName: entry.sportName,
          leagueName: entry.leagueName,
          count: 0,
          startsAt,
          rows: [],
        };
        groups.set(key, group);
      }
      group.rows.push({ entry, startsAt, time: timeFormatter.format(date), date: shortDateFormatter.format(date) });
      group.count += 1;
      group.startsAt = Math.min(group.startsAt, startsAt);
    }
    for (const group of groups.values()) group.rows.sort((a, b) => a.startsAt - b.startsAt);
    return [...groups.values()].sort(
      (a, b) => a.startsAt - b.startsAt || pick(a.leagueName, lang).localeCompare(pick(b.leagueName, lang)),
    );
  }, [groupBy, visible, timeFormatter, shortDateFormatter, lang]);

  const exportCsv = () => {
    if (searched.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadTextFile(`matches-${tab}-${stamp}.csv`, buildMatchesCsv(searched, lang), "text/csv;charset=utf-8");
  };

  const sportFacets = data?.facets.sports ?? [];
  const visibleBookmakerFacets = useMemo(
    () => (data?.facets.bookmakers ?? []).filter((facet) => facet.count > 0 || bookmakerIds.includes(facet.id)),
    [data, bookmakerIds],
  );
  const leagueFacets = data?.facets.leagues ?? [];
  const selectedSportNames = sportFacets
    .filter((facet) => sportKeys.includes(facet.key))
    .map((facet) => pick(facet.name, lang))
    .join(", ");

  const periodText =
    tab === "started"
      ? t.startedRange(grace)
      : quickDays !== null
        ? t.nextDays(quickDays)
        : mode === "preset"
          ? t.nextHours(hours)
          : t.selectedPeriod;

  return (
    <MatchStyleContext.Provider value={styleValue}>
      <main
        className="main-layout py-8 lg:py-10"
        style={{ "--main-ml": `${marginLeft}px`, "--main-mr": `${marginRight}px` } as React.CSSProperties}
      >
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="ui-accent-text text-xs font-semibold uppercase tracking-[0.18em]">{t.eyebrow}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{t.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">{t.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              className="ui-control inline-flex items-center gap-1 bg-white p-1 shadow-sm ring-1 ring-slate-200"
              aria-label={t.languageLabel}
            >
              {(["en", "ru"] as Lang[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => changeLang(code)}
                  aria-pressed={lang === code}
                  className={`ui-control px-3 py-1 text-sm font-semibold transition ${
                    lang === code ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            {!hideProxyControls ? (
              <button
                type="button"
                onClick={() => setProxyOpen((open) => !open)}
                aria-pressed={proxyOpen}
                className={`ui-control inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold shadow-sm ring-1 transition ${
                  proxyOpen
                    ? "ui-accent-bg ring-transparent"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100 hover:text-slate-950"
                }`}
              >
                <Shield className="h-3.5 w-3.5" aria-hidden />
                <span>{t.proxyButton}</span>
                {proxyStats && proxyStats.total > 0 ? (
                  <span className="rounded-full bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                    {proxyStats.enabled}/{proxyStats.total}
                  </span>
                ) : null}
              </button>
            ) : null}
            <IconButton label={t.settings} pressed={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
              <Settings2 className="h-4 w-4" />
            </IconButton>
            <IconButton label={theme === "dark" ? t.lightTheme : t.darkTheme} onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4" />}
            </IconButton>
          </div>
        </header>

        <div className="mt-6 space-y-4">
          <AnimatePresence initial={false}>
            {proxyOpen ? (
              <motion.div
                key="proxy-manager-panel"
                initial={uiPrefs.motionEnabled ? { opacity: 0, y: -10 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={uiPrefs.motionEnabled ? { opacity: 0, y: -8 } : undefined}
                transition={{ duration: uiPrefs.motionEnabled ? 0.2 : 0 }}
              >
                <ProxyManager
                  t={t}
                  onClose={() => setProxyOpen(false)}
                  onResync={() => void refresh()}
                  onStatsChange={setProxyStats}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {settingsOpen ? (
              <motion.div
                key="settings-panel"
                initial={uiPrefs.motionEnabled ? { opacity: 0, y: -10 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={uiPrefs.motionEnabled ? { opacity: 0, y: -8 } : undefined}
                transition={{ duration: uiPrefs.motionEnabled ? 0.2 : 0 }}
              >
                <SettingsPanel
                  grace={grace}
                  t={t}
                  theme={theme}
                  uiPrefs={uiPrefs}
                  onUiPrefs={updateUiPrefs}
                  onResetUiPrefs={resetUiPrefs}
                  onChange={changeGrace}
                  marginLeft={marginLeft}
                  marginRight={marginRight}
                  onMarginLeft={changeMarginLeft}
                  onMarginRight={changeMarginRight}
                  onResetMargins={resetMargins}
                  hiddenLeagues={hiddenLeagues}
                  lang={lang}
                  onRestoreLeague={restoreLeague}
                  onRestoreAllLeagues={showAllLeagues}
                  partialColor={partialColor}
                  checkedColor={checkedColor}
                  checkedCount={checkedIds.length}
                  onPartialColor={changePartialColor}
                  onCheckedColor={changeCheckedColor}
                  onResetColors={resetColors}
                  onClearChecked={clearChecked}
                  bookmakerStyles={bookmakerStyles}
                  onBookmakerStyle={changeBookmakerStyle}
                  onResetBookmakers={resetBookmakerStyles}
                  hideProxyControls={hideProxyControls}
                  onHideProxyControls={changeHideProxyControls}
                  onOpenProxyManager={() => setProxyOpen((open) => !open)}
                  onClose={() => setSettingsOpen(false)}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <MatchChecker lang={lang} />

          {data?.sync ? (
            <SyncCard
              sync={data.sync}
              t={t}
              refreshing={refreshing}
              onRefresh={refresh}
              onOpenProxyManager={hideProxyControls ? undefined : () => setProxyOpen(true)}
            />
          ) : null}

          <div className="ui-control inline-flex bg-white p-1 shadow-sm ring-1 ring-slate-200" role="tablist">
            {(["upcoming", "started"] as Tab[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => switchTab(value)}
                className={`ui-control px-4 py-1.5 text-sm font-semibold transition ${
                  tab === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {value === "upcoming" ? t.tabUpcoming : t.tabStarted}
              </button>
            ))}
          </div>

          <section className="ui-card ui-card-pad bg-white shadow-sm ring-1 ring-slate-200/90">
            <div className="space-y-5">
              {tab === "upcoming" ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.timePeriod}</p>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_HOURS.map((value) => {
                      const active = mode === "preset" && quickDays === null && hours === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => switchToPreset(value)}
                          className={`ui-control px-3.5 py-1.5 text-sm font-medium transition ${
                            active ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {lang === "ru" ? `${value} ч` : `${value}h`}
                        </button>
                      );
                    })}
                    {[
                      { label: t.shortcut24h, days: 1 },
                      { label: t.shortcut3d, days: 3 },
                      { label: t.shortcut7d, days: 7 },
                    ].map((shortcut) => (
                      <button
                        key={shortcut.days}
                        type="button"
                        aria-pressed={quickDays === shortcut.days}
                        onClick={() => switchToDays(shortcut.days)}
                        className={`ui-control px-3.5 py-1.5 text-sm font-medium transition ${
                          quickDays === shortcut.days
                            ? "bg-slate-900 text-white shadow-sm"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {shortcut.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={switchToCustom}
                      className={`ui-control inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium transition ${
                        mode === "custom"
                          ? "ui-accent-bg shadow-sm"
                          : "ui-accent-soft ring-1 ring-inset ring-slate-200 hover:opacity-90"
                      }`}
                    >
                      <Calendar className="h-3.5 w-3.5" aria-hidden />
                      {t.customPeriod}
                    </button>
                  </div>

                  {mode === "custom" ? (
                    <div className="mt-4 grid gap-4 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 md:grid-cols-2 md:items-end">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-slate-700">{t.from}</span>
                        <input
                          type="datetime-local"
                          value={customFrom}
                          onChange={(event) => {
                            setCustomFrom(event.target.value);
                            setVisibleCount(PAGE_SIZE);
                          }}
                          className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-slate-700">{t.to}</span>
                        <input
                          type="datetime-local"
                          value={customTo}
                          onChange={(event) => {
                            setCustomTo(event.target.value);
                            setVisibleCount(PAGE_SIZE);
                          }}
                          className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </label>
                    </div>
                  ) : null}
                  {customError ? <p className="mt-2 text-sm text-rose-700">{customError}</p> : null}
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.tabStarted}</p>
                  <p className="text-sm text-slate-600">{t.startedRange(grace)}</p>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.bookmakers}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBookmakerIds([]);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    className={`ui-control px-3.5 py-1.5 text-sm font-medium transition ${
                      bookmakerIds.length === 0
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {t.allBookmakers}
                  </button>
                  {visibleBookmakerFacets.map((facet) => {
                    const active = bookmakerIds.includes(facet.id);
                    const status = statusOf(facet.lastStatus);
                    return (
                      <button
                        key={facet.id}
                        type="button"
                        onClick={() => toggleBookmaker(facet.id)}
                        aria-pressed={active}
                        title={facet.lastError ?? undefined}
                        className={`ui-control inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium transition ${
                          active
                            ? "bg-slate-900 text-white shadow-sm"
                            : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="text-base leading-none"
                          style={{ color: styleOf(bookmakerStyles, facet.id).color }}
                        >
                          ★
                        </span>
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
                        {facet.label}
                        <span className="tabular-nums opacity-70">({facet.count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.sports}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">{t.groupBy}</span>
                      <div className="ui-control inline-flex bg-slate-100 p-0.5">
                        {(["time", "tournament"] as GroupBy[]).map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={groupBy === value}
                            onClick={() => changeGroup(value)}
                            className={`ui-control inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold transition ${
                              groupBy === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                            }`}
                          >
                            {value === "time" ? (
                              <Clock className="h-3 w-3" aria-hidden />
                            ) : (
                              <Trophy className="h-3 w-3" aria-hidden />
                            )}
                            {value === "time" ? t.groupTime : t.groupTournament}
                          </button>
                        ))}
                      </div>
                    </div>
                    {sportKeys.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSportKeys([]);
                          setVisibleCount(PAGE_SIZE);
                        }}
                        className="ui-accent-text text-xs font-semibold hover:underline"
                      >
                        {t.clearSelection}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSportKeys([]);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    className={`ui-control px-3.5 py-1.5 text-sm font-medium transition ${
                      sportKeys.length === 0
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {t.allSports} <span className="tabular-nums opacity-70">({data?.total ?? 0})</span>
                  </button>
                  {sportFacets.map((facet) => {
                    const active = sportKeys.includes(facet.key);
                    return (
                      <button
                        key={facet.key}
                        type="button"
                        onClick={() => toggleSport(facet.key)}
                        aria-pressed={active}
                        className={`ui-control inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium transition ${
                          active ? "ui-accent-bg shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <span aria-hidden>{sportIcon(facet.key)}</span>
                        {pick(facet.name, lang)}
                        <span className="tabular-nums opacity-70">({facet.count})</span>
                      </button>
                    );
                  })}
                </div>

                {sportKeys.length > 0 ? (
                  <div className="mt-3">
                    <LeagueFilter
                      leagues={leagueFacets}
                      selectedSportKeys={sportKeys}
                      hiddenLeagues={hiddenLeagues}
                      lang={lang}
                      t={t}
                      onToggle={toggleLeague}
                      onRestoreAll={showAllLeagues}
                    />
                  </div>
                ) : null}
                <HiddenLeaguesBar
                  hiddenLeagues={hiddenLeagues}
                  lang={lang}
                  t={t}
                  onRestore={restoreLeague}
                  onRestoreAll={showAllLeagues}
                />
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative w-full sm:w-[340px]">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t.search}
                      className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400"
                    />
                    {search ? (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        aria-label={t.clearSelection}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {availableFormats.length > 0 ? (
                    <select
                      value={effectiveFormatFilter}
                      onChange={(event) => {
                        setFormatFilter(event.target.value);
                        setVisibleCount(PAGE_SIZE);
                      }}
                      aria-label={t.formatFilterLabel}
                      className="ui-accent-input rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                    >
                      <option value="all">{t.formatFilterAll}</option>
                      {availableFormats.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.code} ({item.count})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={showCountdown}
                      onChange={(event) => setShowCountdown(event.target.checked)}
                      className="ui-accent-slider h-4 w-4"
                    />
                    {tab === "started" ? t.showElapsed : t.showCountdown}
                  </label>
                </div>
                <p className="text-sm text-slate-600">
                  {selectedSportNames ? t.showingSports(selectedSportNames) : t.showingAll} · {periodText}
                </p>
              </div>
            </div>
          </section>

          {error ? (
            <div className="ui-card bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
              {t.loadError}: {error}
            </div>
          ) : null}

          <section className="ui-card bg-white shadow-sm ring-1 ring-slate-200/90">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-slate-900">
                  {!data ? (error ? t.loadError : t.loadingMatches) : t.count(searched.length)}
                </p>
                {data?.coverageUntil && tab === "upcoming" ? (
                  <p className="text-xs text-slate-500">
                    {t.latestMatch}: {stampFormatter.format(new Date(data.coverageUntil))}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="ui-control inline-flex bg-slate-100 p-1">
                  {(["bubbles", "table"] as View[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={view === value}
                      onClick={() => changeView(value)}
                      className={`ui-control inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold transition ${
                        view === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                      }`}
                    >
                      {value === "bubbles" ? (
                        <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <Table2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {value === "bubbles" ? t.viewBubbles : t.viewTable}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={searched.length === 0}
                  title={searched.length === 0 ? t.exportNothing : undefined}
                  className="ui-control ui-accent-bg inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {t.exportCsv}
                </button>
              </div>
            </div>

            {data?.truncated ? (
              <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                {t.truncated(data.entries.length)}
              </p>
            ) : null}

            {customError ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">{t.fixCustom}</p>
            ) : !hasRows ? (
              !data && error ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-sm font-medium text-rose-700">{t.serverUnreachable}</p>
                  <p className="mt-1 break-words text-xs text-slate-500">{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      void load();
                    }}
                    className="ui-control mt-4 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    {t.retry}
                  </button>
                </div>
              ) : (
                <p className="px-5 py-12 text-center text-sm text-slate-500">
                  {!data || loading
                    ? t.loadingMatches
                    : tab === "started"
                      ? t.startedEmpty
                      : syncing && entries.length === 0
                        ? t.syncFirstRun
                        : t.noMatches}
                </p>
              )
            ) : view === "table" ? (
              <div className="p-2 sm:p-3">
                <TableView
                  mode={groupBy}
                  days={days}
                  tournaments={tournaments}
                  lang={lang}
                  t={t}
                  tab={tab}
                  showCountdown={showCountdown}
                  onHideLeague={hideLeaguePermanently}
                />
              </div>
            ) : groupBy === "tournament" ? (
              <TournamentBubbleView
                groups={tournaments}
                lang={lang}
                t={t}
                tab={tab}
                showCountdown={showCountdown}
                onHideLeague={hideLeaguePermanently}
              />
            ) : (
              <BubbleView
                days={days}
                lang={lang}
                t={t}
                tab={tab}
                showCountdown={showCountdown}
                onHideLeague={hideLeaguePermanently}
              />
            )}

            {searched.length > visibleCount ? (
              <div className="border-t border-slate-200 px-5 py-4 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  className="ui-control bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                >
                  {t.showMore(searched.length - visibleCount)}
                </button>
              </div>
            ) : null}
          </section>

          <p className="text-center text-xs text-slate-500">{t.footer}</p>
        </div>

        <AnimatePresence>
          {showBackTop ? (
            <motion.button
              type="button"
              initial={uiPrefs.motionEnabled ? { opacity: 0, y: 12 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={uiPrefs.motionEnabled ? { opacity: 0, y: 12 } : undefined}
              transition={{ duration: uiPrefs.motionEnabled ? 0.16 : 0 }}
              onClick={() => window.scrollTo({ top: 0, behavior: uiPrefs.motionEnabled ? "smooth" : "auto" })}
              aria-label={t.backToTop}
              title={t.backToTop}
              className="ui-control ui-accent-bg fixed bottom-6 right-6 z-40 inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold shadow-lg transition hover:scale-105"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t.backToTop}</span>
            </motion.button>
          ) : null}
        </AnimatePresence>
      </main>
    </MatchStyleContext.Provider>
  );
}
