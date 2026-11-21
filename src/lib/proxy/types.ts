import type { SourceId } from "@/lib/sources/model";

export type ProxyProtocol = "http" | "https" | "socks5";
export type ProxyType = "residential" | "mobile" | "datacenter";
export type RotationStrategy = "sticky" | "round-robin" | "fastest";
export type TransportStrategy = "auto" | "http2-curl" | "chromium-cdp" | "direct";
export type ProxyStatus = "untested" | "ok" | "blocked" | "error";

export type ProxyEntry = {
  id: string;
  /** Full normalized URL including optional credentials (kept server-side only). */
  url: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  label: string;
  proxyType: ProxyType;
  country: string;
  /** Empty array = Global pool (available to all bookmakers). Non-empty = isolated to those sources. */
  sources: SourceId[];
  enabled: boolean;
  lastStatus: ProxyStatus;
  lastLatencyMs: number | null;
  lastExitIp: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  successCount: number;
  failCount: number;
  cooldownUntil: number | null;
};

/** Safe projection returned to client UI without raw password strings. */
export type ProxyPublicEntry = Omit<ProxyEntry, "url" | "password"> & {
  maskedUrl: string;
  hasAuth: boolean;
};

export type ProxySettings = {
  enabled: boolean;
  rotation: RotationStrategy;
  stickyTtlSec: number;
  transportMode: TransportStrategy;
  rotateUserAgent: boolean;
  persistCookies: boolean;
  humanJitterMs: number;
  retryOnBlock: boolean;
  cooldownSec: number;
};

export type ProxyPoolSnapshot = {
  settings: ProxySettings;
  proxies: ProxyPublicEntry[];
  stats: {
    total: number;
    enabled: number;
    healthy: number;
    coolingDown: number;
  };
};

export type ProxyTestResult = {
  id: string;
  target: string;
  ok: boolean;
  status: ProxyStatus;
  httpStatus: number | null;
  latencyMs: number;
  exitIp: string | null;
  country: string | null;
  error: string | null;
};

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  enabled: true,
  rotation: "sticky",
  stickyTtlSec: 180,
  transportMode: "auto",
  rotateUserAgent: true,
  persistCookies: true,
  humanJitterMs: 300,
  retryOnBlock: true,
  cooldownSec: 120,
};
