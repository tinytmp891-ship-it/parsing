import { SOURCE_IDS, type SourceId } from "@/lib/sources/model";
import {
  DEFAULT_PROXY_SETTINGS,
  type ProxyEntry,
  type ProxyProtocol,
  type ProxyPublicEntry,
  type ProxySettings,
  type ProxyType,
} from "./types";

const VALID_SOURCES = new Set<string>(SOURCE_IDS);
const VALID_PROTOCOLS = new Set<string>(["http", "https", "socks5", "socks5h"]);

export type ParsedProxyInput = {
  url: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
};

function normalizeProtocol(raw: string): ProxyProtocol | null {
  const lower = raw.toLowerCase();
  if (!VALID_PROTOCOLS.has(lower)) return null;
  return lower === "socks5h" ? "socks5" : (lower as ProxyProtocol);
}

function validPort(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

function buildNormalizedUrl(
  protocol: ProxyProtocol,
  host: string,
  port: number,
  username: string,
  password: string,
): string {
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : "";
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${protocol}://${auth}${formattedHost}:${port}`;
}

/**
 * Parses common proxy notation:
 * - http://user:pass@host:port
 * - https://host:port
 * - socks5://user:pass@host:port
 * - host:port:user:pass
 * - user:pass@host:port
 * - host:port
 */
export function parseProxyLine(rawLine: string, defaultProtocol: ProxyProtocol = "http"): ParsedProxyInput | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  // Scheme URL format: protocol://...
  if (/^[a-z0-9]+:\/\//i.test(line)) {
    let parsed: URL;
    try {
      parsed = new URL(line);
    } catch {
      return null;
    }
    const protocol = normalizeProtocol(parsed.protocol.replace(/:$/, ""));
    if (!protocol) return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, "").trim();
    const port = validPort(parsed.port);
    if (!host || !port) return null;
    const username = decodeURIComponent(parsed.username || "");
    const password = decodeURIComponent(parsed.password || "");
    return {
      url: buildNormalizedUrl(protocol, host, port, username, password),
      protocol,
      host,
      port,
      username,
      password,
    };
  }

  // user:pass@host:port without protocol
  if (line.includes("@")) {
    return parseProxyLine(`${defaultProtocol}://${line}`, defaultProtocol);
  }

  // host:port:user:pass (4 colon-separated parts) or host:port (2 parts)
  const parts = line.split(":");
  if (parts.length === 2) {
    const [hostRaw, portRaw] = parts;
    const host = hostRaw.trim();
    const port = validPort(portRaw.trim());
    if (!host || !port) return null;
    return {
      url: buildNormalizedUrl(defaultProtocol, host, port, "", ""),
      protocol: defaultProtocol,
      host,
      port,
      username: "",
      password: "",
    };
  }

  if (parts.length === 4) {
    const [hostRaw, portRaw, userRaw, passRaw] = parts;
    const host = hostRaw.trim();
    const port = validPort(portRaw.trim());
    if (!host || !port) return null;
    const username = userRaw.trim();
    const password = passRaw.trim();
    return {
      url: buildNormalizedUrl(defaultProtocol, host, port, username, password),
      protocol: defaultProtocol,
      host,
      port,
      username,
      password,
    };
  }

  return null;
}

export function parseProxyLines(
  rawText: string,
  defaultProtocol: ProxyProtocol = "http",
): { parsed: ParsedProxyInput[]; invalid: string[] } {
  const parsed: ParsedProxyInput[] = [];
  const invalid: string[] = [];
  const seenUrls = new Set<string>();

  for (const rawLine of rawText.split(/\r?\n|,/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const item = parseProxyLine(trimmed, defaultProtocol);
    if (!item) {
      invalid.push(trimmed);
      continue;
    }
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    parsed.push(item);
  }

  return { parsed, invalid };
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    const proto = u.protocol.replace(/:$/, "");
    const auth = u.username ? `${decodeURIComponent(u.username)}:••••@` : "";
    return `${proto}://${auth}${u.hostname}:${u.port}`;
  } catch {
    return url.replace(/:([^:@/]+)@/, ":••••@");
  }
}

export function toPublicProxy(entry: ProxyEntry): ProxyPublicEntry {
  return {
    id: entry.id,
    protocol: entry.protocol,
    host: entry.host,
    port: entry.port,
    username: entry.username,
    label: entry.label,
    proxyType: entry.proxyType,
    country: entry.country,
    sources: entry.sources,
    enabled: entry.enabled,
    lastStatus: entry.lastStatus,
    lastLatencyMs: entry.lastLatencyMs,
    lastExitIp: entry.lastExitIp,
    lastError: entry.lastError,
    lastCheckedAt: entry.lastCheckedAt,
    successCount: entry.successCount,
    failCount: entry.failCount,
    cooldownUntil: entry.cooldownUntil,
    maskedUrl: maskProxyUrl(entry.url),
    hasAuth: Boolean(entry.username || entry.password),
  };
}

export function normalizeSourcesList(raw: unknown): SourceId[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<SourceId>();
  for (const item of raw) {
    if (typeof item === "string" && VALID_SOURCES.has(item)) unique.add(item as SourceId);
  }
  return [...unique];
}

export function normalizeProxyType(raw: unknown): ProxyType {
  if (raw === "residential" || raw === "mobile" || raw === "datacenter") return raw;
  return "residential";
}

export function normalizeProxySettings(raw: unknown): ProxySettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_PROXY_SETTINGS };
  const obj = raw as Record<string, unknown>;
  const clamp = (val: unknown, fallback: number, min: number, max: number) =>
    typeof val === "number" && Number.isFinite(val) ? Math.min(max, Math.max(min, Math.round(val))) : fallback;

  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_PROXY_SETTINGS.enabled,
    rotation:
      obj.rotation === "sticky" || obj.rotation === "round-robin" || obj.rotation === "fastest"
        ? obj.rotation
        : DEFAULT_PROXY_SETTINGS.rotation,
    stickyTtlSec: clamp(obj.stickyTtlSec, DEFAULT_PROXY_SETTINGS.stickyTtlSec, 15, 3600),
    transportMode:
      obj.transportMode === "auto" ||
      obj.transportMode === "http2-curl" ||
      obj.transportMode === "chromium-cdp" ||
      obj.transportMode === "direct"
        ? obj.transportMode
        : DEFAULT_PROXY_SETTINGS.transportMode,
    rotateUserAgent:
      typeof obj.rotateUserAgent === "boolean" ? obj.rotateUserAgent : DEFAULT_PROXY_SETTINGS.rotateUserAgent,
    persistCookies:
      typeof obj.persistCookies === "boolean" ? obj.persistCookies : DEFAULT_PROXY_SETTINGS.persistCookies,
    humanJitterMs: clamp(obj.humanJitterMs, DEFAULT_PROXY_SETTINGS.humanJitterMs, 0, 5000),
    retryOnBlock: typeof obj.retryOnBlock === "boolean" ? obj.retryOnBlock : DEFAULT_PROXY_SETTINGS.retryOnBlock,
    cooldownSec: clamp(obj.cooldownSec, DEFAULT_PROXY_SETTINGS.cooldownSec, 10, 3600),
  };
}

export type RotationState = {
  cursors: Map<string, number>;
  sticky: Map<string, { proxyId: string; expiresAt: number }>;
};

/**
 * Selects the best eligible proxy for a bookmaker source.
 * Prefers source-dedicated proxies first (isolated task pools) before falling back to global proxies.
 */
export function selectProxyForSource(
  proxies: ProxyEntry[],
  settings: ProxySettings,
  sourceId: SourceId,
  state: RotationState,
  excludeIds?: Set<string>,
  nowMs = Date.now(),
): ProxyEntry | null {
  if (!settings.enabled || settings.transportMode === "direct") return null;

  const eligible = proxies.filter(
    (p) =>
      p.enabled &&
      !excludeIds?.has(p.id) &&
      (p.cooldownUntil === null || p.cooldownUntil <= nowMs) &&
      (p.sources.length === 0 || p.sources.includes(sourceId)),
  );
  if (eligible.length === 0) return null;

  // Prefer isolated proxies explicitly assigned to this bookmaker before global pool proxies.
  const dedicated = eligible.filter((p) => p.sources.includes(sourceId));
  const pool = dedicated.length > 0 ? dedicated : eligible;

  if (settings.rotation === "sticky") {
    const pinned = state.sticky.get(sourceId);
    if (pinned && pinned.expiresAt > nowMs) {
      const match = pool.find((p) => p.id === pinned.proxyId);
      if (match) return match;
    }
    const cursor = state.cursors.get(sourceId) ?? 0;
    const picked = pool[cursor % pool.length];
    state.cursors.set(sourceId, (cursor + 1) % pool.length);
    state.sticky.set(sourceId, {
      proxyId: picked.id,
      expiresAt: nowMs + settings.stickyTtlSec * 1000,
    });
    return picked;
  }

  if (settings.rotation === "fastest") {
    const sorted = [...pool].sort((a, b) => {
      const la = a.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
      const lb = b.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
      return a.failCount - b.failCount;
    });
    return sorted[0];
  }

  // Round-robin
  const cursor = state.cursors.get(sourceId) ?? 0;
  const picked = pool[cursor % pool.length];
  state.cursors.set(sourceId, (cursor + 1) % pool.length);
  return picked;
}
