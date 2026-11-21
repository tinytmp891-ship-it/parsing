import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { SourceId } from "@/lib/sources/model";
import {
  normalizeProxySettings,
  normalizeProxyType,
  normalizeSourcesList,
  parseProxyLines,
  selectProxyForSource,
  toPublicProxy,
  type RotationState,
} from "./parse";
import {
  DEFAULT_PROXY_SETTINGS,
  type ProxyEntry,
  type ProxyPoolSnapshot,
  type ProxyProtocol,
  type ProxySettings,
  type ProxyType,
} from "./types";

const CONFIG_PATH = "/tmp/matches-proxy-config.json";

type StoredConfig = {
  settings: ProxySettings;
  proxies: ProxyEntry[];
};

type ProxyGlobalState = {
  loaded: boolean;
  settings: ProxySettings;
  proxies: ProxyEntry[];
  rotation: RotationState;
  cookies: Map<string, Map<string, string>>;
};

const globalForProxy = globalThis as typeof globalThis & { __matchesProxyManager?: ProxyGlobalState };

function getState(): ProxyGlobalState {
  if (!globalForProxy.__matchesProxyManager) {
    globalForProxy.__matchesProxyManager = {
      loaded: false,
      settings: { ...DEFAULT_PROXY_SETTINGS },
      proxies: [],
      rotation: { cursors: new Map(), sticky: new Map() },
      cookies: new Map(),
    };
  }
  const state = globalForProxy.__matchesProxyManager;
  if (!state.loaded) {
    state.loaded = true;
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<StoredConfig>;
        if (raw && typeof raw === "object") {
          state.settings = normalizeProxySettings(raw.settings);
          if (Array.isArray(raw.proxies)) {
            state.proxies = raw.proxies.filter(
              (p): p is ProxyEntry =>
                typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.url === "string",
            );
          }
        }
      }
    } catch {
      // Ignore corrupt config file on boot and start clean.
    }
  }
  return state;
}

function persist(state: ProxyGlobalState): void {
  try {
    const payload: StoredConfig = { settings: state.settings, proxies: state.proxies };
    writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // Non-fatal in read-only filesystems; in-memory state still works.
  }
}

export function getProxyPoolSnapshot(): ProxyPoolSnapshot {
  const state = getState();
  const now = Date.now();
  const enabled = state.proxies.filter((p) => p.enabled).length;
  const healthy = state.proxies.filter((p) => p.enabled && p.lastStatus === "ok").length;
  const coolingDown = state.proxies.filter((p) => p.cooldownUntil !== null && p.cooldownUntil > now).length;
  return {
    settings: { ...state.settings },
    proxies: state.proxies.map(toPublicProxy),
    stats: { total: state.proxies.length, enabled, healthy, coolingDown },
  };
}

export function getProxySettings(): ProxySettings {
  return { ...getState().settings };
}

export function updateProxySettings(patch: Partial<ProxySettings>): ProxyPoolSnapshot {
  const state = getState();
  state.settings = normalizeProxySettings({ ...state.settings, ...patch });
  persist(state);
  return getProxyPoolSnapshot();
}

export function addProxiesFromInput(input: {
  rawText: string;
  defaultProtocol?: ProxyProtocol;
  proxyType?: ProxyType;
  country?: string;
  sources?: SourceId[];
  label?: string;
}): { snapshot: ProxyPoolSnapshot; added: number; invalid: string[] } {
  const state = getState();
  const { parsed, invalid } = parseProxyLines(input.rawText, input.defaultProtocol ?? "http");
  const proxyType = normalizeProxyType(input.proxyType);
  const country = (input.country ?? "GLOBAL").trim().toUpperCase().slice(0, 12) || "GLOBAL";
  const sources = normalizeSourcesList(input.sources ?? []);
  const existingUrls = new Set(state.proxies.map((p) => p.url));

  let added = 0;
  for (const item of parsed) {
    if (existingUrls.has(item.url)) continue;
    existingUrls.add(item.url);
    state.proxies.push({
      id: randomUUID(),
      url: item.url,
      protocol: item.protocol,
      host: item.host,
      port: item.port,
      username: item.username,
      password: item.password,
      label: input.label?.trim() || `${item.host}:${item.port}`,
      proxyType,
      country,
      sources,
      enabled: true,
      lastStatus: "untested",
      lastLatencyMs: null,
      lastExitIp: null,
      lastError: null,
      lastCheckedAt: null,
      successCount: 0,
      failCount: 0,
      cooldownUntil: null,
    });
    added += 1;
  }

  persist(state);
  return { snapshot: getProxyPoolSnapshot(), added, invalid };
}

export function updateProxyEntry(
  id: string,
  patch: {
    enabled?: boolean;
    label?: string;
    proxyType?: ProxyType;
    country?: string;
    sources?: SourceId[];
  },
): ProxyPoolSnapshot | null {
  const state = getState();
  const target = state.proxies.find((p) => p.id === id);
  if (!target) return null;

  if (typeof patch.enabled === "boolean") {
    target.enabled = patch.enabled;
    if (patch.enabled) target.cooldownUntil = null;
  }
  if (typeof patch.label === "string") target.label = patch.label.trim() || `${target.host}:${target.port}`;
  if (patch.proxyType !== undefined) target.proxyType = normalizeProxyType(patch.proxyType);
  if (typeof patch.country === "string") {
    target.country = patch.country.trim().toUpperCase().slice(0, 12) || "GLOBAL";
  }
  if (patch.sources !== undefined) target.sources = normalizeSourcesList(patch.sources);

  persist(state);
  return getProxyPoolSnapshot();
}

export function deleteProxyEntry(id: string): ProxyPoolSnapshot {
  const state = getState();
  state.proxies = state.proxies.filter((p) => p.id !== id);
  persist(state);
  return getProxyPoolSnapshot();
}

export function clearAllProxies(): ProxyPoolSnapshot {
  const state = getState();
  state.proxies = [];
  state.rotation.cursors.clear();
  state.rotation.sticky.clear();
  persist(state);
  return getProxyPoolSnapshot();
}

export function getProxyById(id: string): ProxyEntry | null {
  return getState().proxies.find((p) => p.id === id) ?? null;
}

export function hasActiveProxyFor(sourceId: SourceId): boolean {
  const state = getState();
  if (!state.settings.enabled || state.settings.transportMode === "direct") return false;
  const now = Date.now();
  return state.proxies.some(
    (p) =>
      p.enabled &&
      (p.cooldownUntil === null || p.cooldownUntil <= now) &&
      (p.sources.length === 0 || p.sources.includes(sourceId)),
  );
}

export function pickProxy(sourceId: SourceId, excludeIds?: Set<string>): ProxyEntry | null {
  const state = getState();
  return selectProxyForSource(state.proxies, state.settings, sourceId, state.rotation, excludeIds);
}

export function recordProxyOutcome(
  proxyId: string,
  outcome: { ok: boolean; blocked?: boolean; latencyMs?: number; error?: string | null; exitIp?: string | null },
  sourceId?: SourceId,
): void {
  const state = getState();
  const proxy = state.proxies.find((p) => p.id === proxyId);
  if (!proxy) return;

  const now = Date.now();
  proxy.lastCheckedAt = new Date(now).toISOString();
  if (typeof outcome.latencyMs === "number") proxy.lastLatencyMs = Math.round(outcome.latencyMs);
  if (outcome.exitIp) proxy.lastExitIp = outcome.exitIp;

  if (outcome.ok) {
    proxy.lastStatus = "ok";
    proxy.lastError = null;
    proxy.cooldownUntil = null;
    proxy.successCount += 1;
  } else {
    proxy.lastStatus = outcome.blocked ? "blocked" : "error";
    proxy.lastError = outcome.error ?? (outcome.blocked ? "Blocked by target WAF/geo" : "Request failed");
    proxy.failCount += 1;
    proxy.cooldownUntil = now + state.settings.cooldownSec * 1000;
    if (sourceId && state.rotation.sticky.get(sourceId)?.proxyId === proxyId) {
      state.rotation.sticky.delete(sourceId);
    }
  }
  persist(state);
}

export function getCookieHeader(sourceId: SourceId, hostname: string): string | null {
  const state = getState();
  if (!state.settings.persistCookies) return null;
  const jar = state.cookies.get(`${sourceId}:${hostname}`);
  if (!jar || jar.size === 0) return null;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function storeSetCookies(sourceId: SourceId, hostname: string, setCookieValues: string[]): void {
  const state = getState();
  if (!state.settings.persistCookies || setCookieValues.length === 0) return;
  const key = `${sourceId}:${hostname}`;
  let jar = state.cookies.get(key);
  if (!jar) {
    jar = new Map();
    state.cookies.set(key, jar);
  }
  for (const raw of setCookieValues) {
    const firstPart = raw.split(";")[0]?.trim();
    if (!firstPart) continue;
    const eq = firstPart.indexOf("=");
    if (eq <= 0) continue;
    const name = firstPart.slice(0, eq).trim();
    const val = firstPart.slice(eq + 1).trim();
    if (name) jar.set(name, val);
  }
  // Keep cookie jar bounded per host.
  if (jar.size > 40) {
    const oldest = [...jar.keys()].slice(0, jar.size - 40);
    for (const k of oldest) jar.delete(k);
  }
}
