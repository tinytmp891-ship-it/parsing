"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Globe,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { Dict } from "@/lib/i18n";
import type {
  ProxyPoolSnapshot,
  ProxyProtocol,
  ProxyPublicEntry,
  ProxySettings,
  ProxyType,
  RotationStrategy,
  TransportStrategy,
} from "@/lib/proxy/types";
import { SOURCE_IDS, SOURCE_LABELS, type SourceId } from "@/lib/sources/model";

const COUNTRY_OPTIONS = ["GLOBAL", "GB", "DE", "AM", "RO", "AU", "US", "NL", "MT"];

const TEST_TARGETS: { id: string; label: string }[] = [
  { id: "ip-check", label: "Exit IP & Geo" },
  { id: "bet365", label: "bet365.com" },
  { id: "stake", label: "stake.com" },
  { id: "totogaming", label: "totogaming.am" },
  { id: "parimatch", label: "parimatch.com" },
  { id: "oddspedia", label: "oddspedia.com" },
  { id: "bwin", label: "bwin.com" },
  { id: "pinnacle", label: "pinnacle.com" },
  { id: "1xbet", label: "1xbet.com" },
];

function StatusBadge({ proxy, t }: { proxy: ProxyPublicEntry; t: Dict }) {
  if (proxy.lastStatus === "ok") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {t.proxyStatusOk}
      </span>
    );
  }
  if (proxy.lastStatus === "blocked") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
        <Shield className="h-3 w-3" aria-hidden />
        {t.proxyStatusBlocked}
      </span>
    );
  }
  if (proxy.lastStatus === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
        <XCircle className="h-3 w-3" aria-hidden />
        {t.proxyStatusError}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
      {t.proxyStatusUntested}
    </span>
  );
}

export function ProxyManager({
  t,
  onClose,
  onResync,
  onStatsChange,
}: {
  t: Dict;
  onClose: () => void;
  onResync: () => void;
  onStatsChange?: (stats: ProxyPoolSnapshot["stats"]) => void;
}) {
  const [snapshot, setSnapshot] = useState<ProxyPoolSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [protocol, setProtocol] = useState<ProxyProtocol>("http");
  const [proxyType, setProxyType] = useState<ProxyType>("residential");
  const [country, setCountry] = useState("GLOBAL");
  const [selectedSources, setSelectedSources] = useState<SourceId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const [testTarget, setTestTarget] = useState("ip-check");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);

  const applySnapshot = useCallback(
    (next: ProxyPoolSnapshot) => {
      setSnapshot(next);
      onStatsChange?.(next.stats);
    },
    [onStatsChange],
  );

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/proxies", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ProxyPoolSnapshot;
      applySnapshot(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proxy pool");
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSnapshot();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSnapshot]);

  const updateSettings = async (patch: Partial<ProxySettings>) => {
    setError(null);
    try {
      const res = await fetch("/api/proxies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: patch }),
      });
      const json = (await res.json()) as { snapshot?: ProxyPoolSnapshot; error?: string };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    }
  };

  const handleAddProxies = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rawText.trim()) return;
    setSubmitting(true);
    setAddFeedback(null);
    setError(null);
    try {
      const res = await fetch("/api/proxies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText,
          defaultProtocol: protocol,
          proxyType,
          country,
          sources: selectedSources,
        }),
      });
      const json = (await res.json()) as {
        added?: number;
        invalid?: string[];
        snapshot?: ProxyPoolSnapshot;
        error?: string;
      };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
      setRawText("");
      setAddFeedback(t.proxyAddedResult(typeof json.added === "number" ? json.added : 0, json.invalid?.length ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add proxies");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleProxyEnabled = async (proxy: ProxyPublicEntry) => {
    try {
      const res = await fetch("/api/proxies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: proxy.id, enabled: !proxy.enabled }),
      });
      const json = (await res.json()) as { snapshot?: ProxyPoolSnapshot; error?: string };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle proxy");
    }
  };

  const removeProxy = async (id: string) => {
    try {
      const res = await fetch(`/api/proxies?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as { snapshot?: ProxyPoolSnapshot; error?: string };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove proxy");
    }
  };

  const clearAll = async () => {
    try {
      const res = await fetch("/api/proxies?all=1", { method: "DELETE" });
      const json = (await res.json()) as { snapshot?: ProxyPoolSnapshot; error?: string };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear proxies");
    }
  };

  const testSingle = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch("/api/proxies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, target: testTarget }),
      });
      const json = (await res.json()) as { snapshot?: ProxyPoolSnapshot; error?: string };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proxy test failed");
    } finally {
      setTestingId(null);
    }
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      const res = await fetch("/api/proxies/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, target: testTarget }),
      });
      const json = (await res.json()) as { snapshot?: ProxyPoolSnapshot; error?: string };
      if (!res.ok || !json.snapshot) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySnapshot(json.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch proxy test failed");
    } finally {
      setTestingAll(false);
    }
  };

  const toggleAssignSource = (id: SourceId) => {
    setSelectedSources((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const settings = snapshot?.settings;
  const proxies = snapshot?.proxies ?? [];
  const stats = snapshot?.stats ?? { total: 0, enabled: 0, healthy: 0, coolingDown: 0 };

  return (
    <section className="ui-card ui-card-pad bg-white shadow-sm ring-1 ring-slate-200/90" aria-label={t.proxyTitle}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 ui-accent-text" aria-hidden />
            <h2 className="text-base font-semibold text-slate-950">{t.proxyTitle}</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t.proxySubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onResync}
            className="ui-control ui-accent-bg inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold shadow-sm transition"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t.proxyResyncBtn}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ui-control inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t.close}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      ) : null}

      {loading || !settings ? (
        <p className="mt-4 text-xs text-slate-500">{t.loadingMatches}</p>
      ) : (
        <div className="mt-5 space-y-5">
          {/* Anti-Block Strategy Controls */}
          <div className="rounded-xl bg-slate-50/90 p-4 ring-1 ring-inset ring-slate-200/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => void updateSettings({ enabled: e.target.checked })}
                  className="ui-accent-slider h-4 w-4"
                />
                {t.proxyEnabledLabel}
              </label>
              <span className="text-xs font-medium text-slate-600 tabular-nums">
                {t.proxyStatsLine(stats.total, stats.enabled, stats.healthy, stats.coolingDown)}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.15fr_0.75fr_0.8fr_0.85fr]">
              <label className="block text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">
                  {t.proxyTransportLabel}
                </span>
                <select
                  value={settings.transportMode}
                  onChange={(e) => void updateSettings({ transportMode: e.target.value as TransportStrategy })}
                  className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-900"
                >
                  <option value="auto">{t.proxyTransportAuto}</option>
                  <option value="http2-curl">{t.proxyTransportHttp2}</option>
                  <option value="chromium-cdp">{t.proxyTransportChromium}</option>
                  <option value="direct">{t.proxyTransportDirect}</option>
                </select>
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">
                  {t.proxyRotationLabel}
                </span>
                <select
                  value={settings.rotation}
                  onChange={(e) => void updateSettings({ rotation: e.target.value as RotationStrategy })}
                  className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-900"
                >
                  <option value="sticky">{t.proxyRotationSticky}</option>
                  <option value="round-robin">{t.proxyRotationRoundRobin}</option>
                  <option value="fastest">{t.proxyRotationFastest}</option>
                </select>
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">
                  {t.proxyStickyTtlLabel}
                </span>
                <input
                  type="number"
                  min={15}
                  max={3600}
                  value={settings.stickyTtlSec}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) void updateSettings({ stickyTtlSec: v });
                  }}
                  className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900"
                />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">
                  {t.proxyCooldownLabel}
                </span>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={settings.cooldownSec}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) void updateSettings({ cooldownSec: v });
                  }}
                  className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900"
                />
              </label>

              <label className="block text-xs">
                <span className="mb-1 block font-semibold uppercase tracking-wide text-slate-500">
                  {t.proxyJitterLabel}
                </span>
                <input
                  type="number"
                  min={0}
                  max={5000}
                  step={50}
                  value={settings.humanJitterMs}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) void updateSettings({ humanJitterMs: v });
                  }}
                  className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200/80 pt-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.rotateUserAgent}
                  onChange={(e) => void updateSettings({ rotateUserAgent: e.target.checked })}
                  className="ui-accent-slider h-4 w-4"
                />
                {t.proxyRotateUaLabel}
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.persistCookies}
                  onChange={(e) => void updateSettings({ persistCookies: e.target.checked })}
                  className="ui-accent-slider h-4 w-4"
                />
                {t.proxyPersistCookiesLabel}
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.retryOnBlock}
                  onChange={(e) => void updateSettings({ retryOnBlock: e.target.checked })}
                  className="ui-accent-slider h-4 w-4"
                />
                {t.proxyRetryBlockLabel}
              </label>
            </div>
          </div>

          {/* Add / Bulk Import Form */}
          <form onSubmit={(e) => void handleAddProxies(e)} className="space-y-3">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <label className="block text-xs">
                <span className="mb-1.5 block font-semibold uppercase tracking-wide text-slate-500">
                  {t.proxyImportTitle}
                </span>
                <textarea
                  rows={4}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={t.proxyImportPlaceholder}
                  className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400"
                />
              </label>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs">
                    <span className="mb-1 block font-semibold text-slate-600">{t.proxyProtocolLabel}</span>
                    <select
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value as ProxyProtocol)}
                      className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
                    >
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block font-semibold text-slate-600">{t.proxyTypeLabel}</span>
                    <select
                      value={proxyType}
                      onChange={(e) => setProxyType(e.target.value as ProxyType)}
                      className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
                    >
                      <option value="residential">{t.proxyTypeResidential}</option>
                      <option value="mobile">{t.proxyTypeMobile}</option>
                      <option value="datacenter">{t.proxyTypeDatacenter}</option>
                    </select>
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block font-semibold text-slate-600">{t.proxyCountryLabel}</span>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="ui-accent-input w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
                    >
                      {COUNTRY_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.proxyAssignLabel}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedSources([])}
                      aria-pressed={selectedSources.length === 0}
                      className={`ui-control px-2.5 py-1 text-[11px] font-semibold transition ${
                        selectedSources.length === 0
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {t.proxyAllPool}
                    </button>
                    {SOURCE_IDS.map((id) => {
                      const active = selectedSources.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleAssignSource(id)}
                          aria-pressed={active}
                          className={`ui-control px-2.5 py-1 text-[11px] font-semibold transition ${
                            active
                              ? "ui-accent-bg shadow-sm"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {SOURCE_LABELS[id]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !rawText.trim()}
                className="ui-control ui-accent-bg inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t.proxyAddBtn}
              </button>
              {addFeedback ? <span className="text-xs font-medium text-emerald-700">{addFeedback}</span> : null}
            </div>
          </form>

          {/* Pool Toolbar & Proxy List */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.proxyPoolTitle} ({proxies.length})
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <span>{t.proxyTestTargetLabel}:</span>
                  <select
                    value={testTarget}
                    onChange={(e) => setTestTarget(e.target.value)}
                    className="ui-accent-input rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-900"
                  >
                    {TEST_TARGETS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void testAll()}
                  disabled={proxies.length === 0 || testingAll}
                  className="ui-control inline-flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Activity className="h-3.5 w-3.5" aria-hidden />
                  {testingAll ? t.proxyTesting : t.proxyTestAllBtn}
                </button>
                <button
                  type="button"
                  onClick={() => void clearAll()}
                  disabled={proxies.length === 0}
                  className="ui-control inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t.proxyClearAllBtn}
                </button>
              </div>
            </div>

            {proxies.length === 0 ? (
              <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-200/80">
                {t.proxyEmpty}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {proxies.map((proxy) => (
                  <div
                    key={proxy.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 ring-1 ring-inset transition ${
                      proxy.enabled
                        ? "bg-slate-50/90 ring-slate-200/90"
                        : "bg-slate-100/60 opacity-70 ring-slate-200/60"
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="truncate font-mono text-xs font-semibold text-slate-900">
                          {proxy.maskedUrl}
                        </code>
                        <StatusBadge proxy={proxy} t={t} />
                        <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                          {proxy.proxyType}
                        </span>
                        <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                          {proxy.country}
                        </span>
                        {proxy.lastLatencyMs !== null ? (
                          <span className="font-mono text-[11px] font-medium text-slate-600">
                            {proxy.lastLatencyMs} ms
                          </span>
                        ) : null}
                        {proxy.lastExitIp ? (
                          <span className="font-mono text-[11px] text-slate-500">IP: {proxy.lastExitIp}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span>
                          {proxy.sources.length === 0
                            ? t.proxyAllPool
                            : proxy.sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ")}
                        </span>
                        <span>·</span>
                        <span className="font-mono">
                          ✓ {proxy.successCount} / ✗ {proxy.failCount}
                        </span>
                        {proxy.lastError ? (
                          <>
                            <span>·</span>
                            <span className="truncate text-rose-700" title={proxy.lastError}>
                              {proxy.lastError}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void testSingle(proxy.id)}
                        disabled={testingId === proxy.id || testingAll}
                        aria-label={`${t.proxyTestBtn} ${proxy.maskedUrl}`}
                        className="ui-control inline-flex items-center gap-1 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
                      >
                        <Activity className="h-3 w-3" aria-hidden />
                        {testingId === proxy.id ? t.proxyTesting : t.proxyTestBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleProxyEnabled(proxy)}
                        aria-label={`${proxy.enabled ? t.proxyDisableBtn : t.proxyEnableBtn} ${proxy.maskedUrl}`}
                        className="ui-control inline-flex items-center gap-1 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                      >
                        {proxy.enabled ? (
                          <>
                            <Pause className="h-3 w-3" aria-hidden />
                            {t.proxyDisableBtn}
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3" aria-hidden />
                            {t.proxyEnableBtn}
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeProxy(proxy.id)}
                        aria-label={`${t.proxyDeleteBtn} ${proxy.maskedUrl}`}
                        className="ui-control inline-flex items-center gap-1 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
