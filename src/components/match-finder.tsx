"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dictionaries, type Dict, type Lang } from "@/lib/i18n";
import { leagueKeyOf, sportKeyOfLeague } from "@/lib/league-key";
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
import { LeagueFilter } from "./matches/league-filter";
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
const MAX_CHECKED = 2000;

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
      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-base shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100"
    >
      <span aria-hidden>{children}</span>
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
          className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-200"
          style={{ backgroundColor: tintOf(value) }}
        >
          {previewText}
        </span>
      </div>
    </label>
  );
}

function SettingsPanel({
  grace,
  t,
  onChange,
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
  onClose,
}: {
  grace: number;
  t: Dict;
  onChange: (value: number) => void;
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
  onClose: () => void;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{t.settingsTitle}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          {t.close}
        </button>
      </div>

      <label className="mt-4 block text-sm">
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
            className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <span className="text-sm text-slate-600">{t.graceUnit}</span>
        </div>
      </label>
      <p className="mt-2 text-xs text-slate-500">{t.graceHint}</p>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <p className="text-sm font-semibold text-slate-950">{t.colorsTitle}</p>
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
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            {t.colorReset}
          </button>
          <button
            type="button"
            onClick={onClearChecked}
            disabled={checkedCount === 0}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
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
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  // Quick periods ("next 24 h", "next 3 days", "next 7 days") are relative, so the server recomputes them on each request.
  const [quickDays, setQuickDays] = useState<number | null>(null);
  const [hours, setHours] = useState(2);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sportKeys, setSportKeys] = useState<string[]>([]);
  const [hiddenLeagues, setHiddenLeagues] = useState<string[]>([]);
  const [bookmakerIds, setBookmakerIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
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
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setNow(Date.now());
    // Ticks every 10 seconds so finished matches leave the lists on time, even between server responses.
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // Hidden tournaments only apply to the sports that are still selected.
  useEffect(() => {
    setHiddenLeagues((current) => {
      const next = current.filter((key) => sportKeys.includes(sportKeyOfLeague(key)));
      return next.length === current.length ? current : next;
    });
  }, [sportKeys]);

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
    if (hiddenLeagues.length > 0) params.set("hideLeagues", hiddenLeagues.join(","));
    if (bookmakerIds.length > 0) params.set("bookmakers", bookmakerIds.join(","));
    return params.toString();
  }, [tab, grace, mode, quickDays, hours, customFrom, customTo, sportKeys, hiddenLeagues, bookmakerIds]);

  const load = useCallback(async () => {
    if (customError) {
      setLoading(false);
      return;
    }
    try {
      // A timeout stops a request that never answers from leaving the page in a loading state.
      const response = await fetch(`/api/matches?${queryString}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
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
    void load();
  }, [load]);

  const syncing = data?.sync.running ?? false;

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

  const toggleLeague = (key: string) => {
    setVisibleCount(PAGE_SIZE);
    setHiddenLeagues((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const showAllLeagues = () => {
    setVisibleCount(PAGE_SIZE);
    setHiddenLeagues([]);
  };

  const entries = useMemo<Entry[]>(() => data?.entries ?? [], [data]);

  // Browser-side time filter: Upcoming shows only matches that have not started, and Started shows only
  // matches that started within the grace period. This holds even when the last server response is a few seconds old.
  const timeFiltered = useMemo<Entry[]>(() => {
    const reference = now || Date.now();
    const graceMs = grace * 60_000;
    return entries.filter((entry) => {
      const start = Date.parse(entry.startsAt);
      return tab === "upcoming" ? start > reference : start <= reference && start >= reference - graceMs;
    });
  }, [entries, now, tab, grace]);

  const searched = useMemo<Entry[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) return timeFiltered;
    return timeFiltered.filter((entry) =>
      [
        entry.home.en,
        entry.home.ru,
        entry.away.en,
        entry.away.ru,
        entry.leagueName.en,
        entry.leagueName.ru,
        entry.sportName.en,
        entry.sportName.ru,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [timeFiltered, search]);

  const visible = useMemo(() => searched.slice(0, visibleCount), [searched, visibleCount]);
  const hasRows = visible.length > 0;

  // Time view: day -> time group (exact kickoff minute). Each time group is one bubble or table block.
  const referenceNow = now || Date.now();
  const todayKey = dayKeyOf(new Date(referenceNow));
  const tomorrowKey = dayKeyOf(new Date(referenceNow + DAY_MS));

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
  const bookmakerFacets = data?.facets.bookmakers ?? [];
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
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">{t.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950 sm:text-4xl">{t.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            className="inline-flex items-center gap-1 rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200"
            aria-label={t.languageLabel}
          >
            {(["en", "ru"] as Lang[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => changeLang(code)}
                aria-pressed={lang === code}
                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                  lang === code ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <IconButton label={t.settings} pressed={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
            ⚙️
          </IconButton>
          <IconButton label={theme === "dark" ? t.lightTheme : t.darkTheme} onClick={toggleTheme}>
            {theme === "dark" ? "☀️" : "🌙"}
          </IconButton>
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {settingsOpen ? (
          <SettingsPanel
            grace={grace}
            t={t}
            onChange={changeGrace}
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
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}

        <MatchChecker lang={lang} />

        {data ? <SyncCard sync={data.sync} t={t} refreshing={refreshing} onRefresh={refresh} /> : null}

        <div className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200" role="tablist">
          {(["upcoming", "started"] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => switchTab(value)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                tab === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {value === "upcoming" ? t.tabUpcoming : t.tabStarted}
            </button>
          ))}
        </div>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
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
                        className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
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
                      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
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
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                      mode === "custom"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
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
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
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
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
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
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    bookmakerIds.length === 0
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {t.allBookmakers}
                </button>
                {bookmakerFacets.map((facet) => {
                  const active = bookmakerIds.includes(facet.id);
                  const status = statusOf(facet.lastStatus);
                  return (
                    <button
                      key={facet.id}
                      type="button"
                      onClick={() => toggleBookmaker(facet.id)}
                      aria-pressed={active}
                      title={facet.lastError ?? undefined}
                      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                        active
                          ? "bg-slate-900 text-white shadow-sm"
                          : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      <span aria-hidden className="text-base leading-none" style={{ color: styleOf(bookmakerStyles, facet.id).color }}>
                        ★
                      </span>
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
                      {facet.label}
                      <span className="opacity-70">({facet.count})</span>
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
                    <div className="inline-flex rounded-full bg-slate-100 p-0.5">
                      {(["time", "tournament"] as GroupBy[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={groupBy === value}
                          onClick={() => changeGroup(value)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                            groupBy === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                          }`}
                        >
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
                      className="text-xs font-medium text-emerald-700 hover:underline"
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
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    sportKeys.length === 0
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {t.allSports} <span className="opacity-70">({data?.total ?? 0})</span>
                </button>
                {sportFacets.map((facet) => {
                  const active = sportKeys.includes(facet.key);
                  return (
                    <button
                      key={facet.key}
                      type="button"
                      onClick={() => toggleSport(facet.key)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                        active ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <span aria-hidden>{sportIcon(facet.key)}</span>
                      {pick(facet.name, lang)}
                      <span className="opacity-70">({facet.count})</span>
                    </button>
                  );
                })}
              </div>

              {sportKeys.length > 0 ? (
                <div className="mt-3">
                  <LeagueFilter
                    leagues={leagueFacets}
                    hidden={hiddenLeagues}
                    lang={lang}
                    t={t}
                    onToggle={toggleLeague}
                    onShowAll={showAllLeagues}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.search}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 sm:w-72"
                />
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showCountdown}
                    onChange={(event) => setShowCountdown(event.target.checked)}
                    className="h-4 w-4 accent-emerald-600"
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
          <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
            {t.loadError}: {error}
          </div>
        ) : null}

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
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
              <div className="inline-flex rounded-full bg-slate-100 p-1">
                {(["bubbles", "table"] as View[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    onClick={() => changeView(value)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      view === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                    }`}
                  >
                    {value === "bubbles" ? t.viewBubbles : t.viewTable}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={exportCsv}
                disabled={searched.length === 0}
                title={searched.length === 0 ? t.exportNothing : undefined}
                className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                ⬇ {t.exportCsv}
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
                  className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
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
              />
            </div>
          ) : groupBy === "tournament" ? (
            <TournamentBubbleView groups={tournaments} lang={lang} t={t} tab={tab} showCountdown={showCountdown} />
          ) : (
            <BubbleView days={days} lang={lang} t={t} tab={tab} showCountdown={showCountdown} />
          )}

          {searched.length > visibleCount ? (
            <div className="border-t border-slate-200 px-5 py-4 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                {t.showMore(searched.length - visibleCount)}
              </button>
            </div>
          ) : null}
        </section>

        <p className="text-center text-xs text-slate-500">{t.footer}</p>
      </div>
    </main>
    </MatchStyleContext.Provider>
  );
}
