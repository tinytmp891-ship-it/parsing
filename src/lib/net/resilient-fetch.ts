import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getCookieHeader,
  getProxyById,
  getProxySettings,
  hasActiveProxyFor,
  pickProxy,
  recordProxyOutcome,
  storeSetCookies,
} from "@/lib/proxy/manager";
import type { ProxyEntry, ProxyTestResult } from "@/lib/proxy/types";
import type { SourceId } from "@/lib/sources/model";
import { chromiumFetch } from "./chromium-fetch";

const execFileAsync = promisify(execFile);

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
];

let uaCursor = 0;

function pickUserAgent(rotate: boolean): string {
  if (!rotate) return USER_AGENTS[0];
  const ua = USER_AGENTS[uaCursor % USER_AGENTS.length];
  uaCursor += 1;
  return ua;
}

const lastHostRequestAt = new Map<string, number>();

async function applyHumanJitter(hostname: string, jitterMs: number): Promise<void> {
  if (jitterMs <= 0) return;
  const now = Date.now();
  const prev = lastHostRequestAt.get(hostname) ?? 0;
  const minGap = Math.round(jitterMs * (0.55 + Math.random() * 0.7));
  const wait = prev + minGap - now;
  lastHostRequestAt.set(hostname, Math.max(now, prev + minGap));
  if (wait > 0 && wait <= 3000) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

export type ParsedCurlResponse = {
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
};

/**
 * Splits `curl -i` output containing 1+ HTTP response header sections (e.g. `HTTP/1.1 200 Connection established`
 * from HTTPS proxies or 3xx redirects) into final status, lower-cased headers, Set-Cookie list, and body.
 */
export function parseCurlHttpOutput(raw: Buffer | string): ParsedCurlResponse {
  const buf = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
  let offset = 0;
  let status = 0;
  let headers: Record<string, string> = {};
  let setCookies: string[] = [];

  while (offset < buf.length) {
    const probe = buf.subarray(offset, Math.min(buf.length, offset + 12)).toString("latin1");
    if (!/^HTTP\/\d(?:\.\d)?\s+\d{3}/.test(probe)) break;

    let sepIdx = buf.indexOf("\r\n\r\n", offset);
    let sepLen = 4;
    const lfIdx = buf.indexOf("\n\n", offset);
    if (lfIdx !== -1 && (sepIdx === -1 || lfIdx < sepIdx)) {
      sepIdx = lfIdx;
      sepLen = 2;
    }
    if (sepIdx === -1) break;

    const headerBlock = buf.subarray(offset, sepIdx).toString("latin1");
    const lines = headerBlock.split(/\r?\n/);
    const statusMatch = lines[0]?.match(/^HTTP\/\S+\s+(\d{3})/);
    if (statusMatch) status = Number.parseInt(statusMatch[1], 10);

    const blockHeaders: Record<string, string> = {};
    const blockCookies: string[] = [];
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const val = line.slice(colon + 1).trim();
      blockHeaders[key] = val;
      if (key === "set-cookie") blockCookies.push(val);
    }

    headers = blockHeaders;
    setCookies = [...setCookies, ...blockCookies];
    offset = sepIdx + sepLen;
  }

  return {
    status,
    headers,
    setCookies,
    body: buf.subarray(offset).toString("utf8"),
  };
}

export async function curlExec(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  proxyUrl?: string | null;
  timeoutMs?: number;
}): Promise<ParsedCurlResponse> {
  const timeoutSec = Math.max(5, Math.ceil((options.timeoutMs ?? 20_000) / 1000));
  const args: string[] = [
    "--http2",
    "-sS",
    "-i",
    "-L",
    "--compressed",
    "--max-time",
    String(timeoutSec),
    "--connect-timeout",
    String(Math.min(12, timeoutSec)),
  ];

  if (options.method && options.method !== "GET") {
    args.push("-X", options.method);
  }
  if (options.proxyUrl) {
    // Use socks5h:// when given socks5:// so DNS resolution happens on the proxy exit node (avoids geo/DNS leaks).
    const effectiveProxy = options.proxyUrl.startsWith("socks5://")
      ? options.proxyUrl.replace(/^socks5:\/\//, "socks5h://")
      : options.proxyUrl;
    args.push("-x", effectiveProxy);
  }
  for (const [k, v] of Object.entries(options.headers ?? {})) {
    if (v) args.push("-H", `${k}: ${v}`);
  }
  if (options.body !== undefined) {
    args.push("--data-raw", options.body);
  }
  args.push(options.url);

  let stdout: Buffer;
  try {
    const out = await execFileAsync("curl", args, {
      encoding: "buffer",
      maxBuffer: 25 * 1024 * 1024,
      timeout: (options.timeoutMs ?? 20_000) + 3000,
    });
    stdout = out.stdout;
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderrText =
      typeof e.stderr === "string"
        ? e.stderr.trim()
        : Buffer.isBuffer(e.stderr)
          ? e.stderr.toString("utf8").trim()
          : "";
    const detail = stderrText || e.message?.split("\n")[0] || "curl transport failed";
    throw new Error(detail.replace(/Command failed: curl[\s\S]*?(?=curl:|$)/i, "").trim() || "curl transport failed");
  }

  const parsed = parseCurlHttpOutput(stdout);
  if (parsed.status === 0) {
    throw new Error("No HTTP response status from curl");
  }
  return parsed;
}

function isBlockedStatus(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 451) return true;
  if (/just a moment|attention required|you have been blocked|cf-mitigated|restrictedregion/i.test(body.slice(0, 2000))) {
    return true;
  }
  return false;
}

export type ResilientFetchResult = {
  ok: boolean;
  status: number;
  text: string;
  headers: Record<string, string>;
  via: "direct" | "http2-curl" | "proxy-curl" | "chromium-cdp";
  proxyId: string | null;
  latencyMs: number;
};

function mergeBrowserHeaders(
  sourceId: SourceId,
  url: string,
  rotateUa: boolean,
  explicit?: Record<string, string>,
): Record<string, string> {
  const lowerKeys = new Map<string, string>();
  const setDefault = (k: string, v: string) => {
    lowerKeys.set(k.toLowerCase(), k);
    out[k] = v;
  };
  const out: Record<string, string> = {};

  const ua = pickUserAgent(rotateUa);
  setDefault("User-Agent", ua);
  setDefault("Accept", "application/json, text/plain, text/html, */*");
  setDefault("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8");

  try {
    const parsedUrl = new URL(url);
    const cookie = getCookieHeader(sourceId, parsedUrl.hostname);
    if (cookie) setDefault("Cookie", cookie);
  } catch {
    // Ignore invalid URL.
  }

  for (const [k, v] of Object.entries(explicit ?? {})) {
    const existingKey = lowerKeys.get(k.toLowerCase());
    if (existingKey && existingKey !== k) delete out[existingKey];
    out[k] = v;
  }
  return out;
}

/**
 * Resilient HTTP fetch combining:
 * 1. Rotating Chrome/Firefox User-Agent + persistent Cookie Jar + randomized human jitter
 * 2. Proxy Pool selection (Sticky / Round-Robin / Fastest, task-isolated per source)
 * 3. Automatic IP rotation + retry on HTTP 403/429/451 or proxy errors
 * 4. Optional HTTP/2 curl TLS impersonation or Headless Chromium CDP fallback
 */
export async function resilientFetch(options: {
  url: string;
  sourceId: SourceId;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  allowChromiumFallback?: boolean;
  originUrl?: string;
  preferHttp2?: boolean;
  skipJitter?: boolean;
}): Promise<ResilientFetchResult> {
  const settings = getProxySettings();
  const timeoutMs = options.timeoutMs ?? 20_000;
  let hostname = "";
  try {
    hostname = new URL(options.url).hostname;
  } catch {
    hostname = options.sourceId;
  }

  if (!options.skipJitter && settings.humanJitterMs > 0) {
    await applyHumanJitter(hostname, settings.humanJitterMs);
  }

  const reqHeaders = mergeBrowserHeaders(options.sourceId, options.url, settings.rotateUserAgent, options.headers);

  if (settings.transportMode === "chromium-cdp") {
    const proxy = pickProxy(options.sourceId);
    const started = Date.now();
    const res = await chromiumFetch({
      url: options.url,
      originUrl: options.originUrl,
      proxyUrl: proxy?.url,
      headers: reqHeaders,
      method: options.method,
      body: options.body,
      timeoutMs,
    });
    const latencyMs = Date.now() - started;
    if (proxy) {
      recordProxyOutcome(
        proxy.id,
        { ok: res.status >= 200 && res.status < 400, blocked: isBlockedStatus(res.status, res.text), latencyMs },
        options.sourceId,
      );
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: res.text,
      headers: {},
      via: "chromium-cdp",
      proxyId: proxy?.id ?? null,
      latencyMs,
    };
  }

  // Try configured proxies first when enabled & not forced direct.
  const triedProxyIds = new Set<string>();
  const maxProxyAttempts = settings.retryOnBlock ? 3 : 1;

  for (let attempt = 0; attempt < maxProxyAttempts; attempt += 1) {
    const proxy: ProxyEntry | null = pickProxy(options.sourceId, triedProxyIds);
    if (!proxy) break;
    triedProxyIds.add(proxy.id);

    const started = Date.now();
    try {
      const parsed = await curlExec({
        url: options.url,
        method: options.method,
        headers: reqHeaders,
        body: options.body,
        proxyUrl: proxy.url,
        timeoutMs,
      });
      const latencyMs = Date.now() - started;
      storeSetCookies(options.sourceId, hostname, parsed.setCookies);

      const blocked = isBlockedStatus(parsed.status, parsed.body);
      if (blocked) {
        recordProxyOutcome(
          proxy.id,
          { ok: false, blocked: true, latencyMs, error: `HTTP ${parsed.status}` },
          options.sourceId,
        );
        if (settings.retryOnBlock && attempt + 1 < maxProxyAttempts) continue;
        return {
          ok: false,
          status: parsed.status,
          text: parsed.body,
          headers: parsed.headers,
          via: "proxy-curl",
          proxyId: proxy.id,
          latencyMs,
        };
      }

      recordProxyOutcome(proxy.id, { ok: true, latencyMs }, options.sourceId);
      return {
        ok: parsed.status >= 200 && parsed.status < 300,
        status: parsed.status,
        text: parsed.body,
        headers: parsed.headers,
        via: "proxy-curl",
        proxyId: proxy.id,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      recordProxyOutcome(
        proxy.id,
        { ok: false, blocked: false, latencyMs, error: err instanceof Error ? err.message : String(err) },
        options.sourceId,
      );
      if (settings.retryOnBlock && attempt + 1 < maxProxyAttempts) continue;
    }
  }

  // Fallback without proxy (HTTP/2 curl or native fetch).
  if (settings.transportMode === "http2-curl" || options.preferHttp2) {
    const started = Date.now();
    const parsed = await curlExec({
      url: options.url,
      method: options.method,
      headers: reqHeaders,
      body: options.body,
      timeoutMs,
    });
    const latencyMs = Date.now() - started;
    storeSetCookies(options.sourceId, hostname, parsed.setCookies);

    if (
      options.allowChromiumFallback &&
      settings.transportMode === "auto" &&
      isBlockedStatus(parsed.status, parsed.body)
    ) {
      try {
        const cdp = await chromiumFetch({
          url: options.url,
          originUrl: options.originUrl,
          headers: reqHeaders,
          method: options.method,
          body: options.body,
          timeoutMs,
        });
        return {
          ok: cdp.status >= 200 && cdp.status < 300,
          status: cdp.status,
          text: cdp.text,
          headers: {},
          via: "chromium-cdp",
          proxyId: null,
          latencyMs: Date.now() - started,
        };
      } catch {
        // Return original HTTP/2 result if Chromium fallback also fails.
      }
    }

    return {
      ok: parsed.status >= 200 && parsed.status < 300,
      status: parsed.status,
      text: parsed.body,
      headers: parsed.headers,
      via: "http2-curl",
      proxyId: null,
      latencyMs,
    };
  }

  const started = Date.now();
  const response = await fetch(options.url, {
    method: options.method ?? "GET",
    headers: reqHeaders,
    body: options.body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text().catch(() => "");
  const latencyMs = Date.now() - started;
  const setCookieGetter = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof setCookieGetter === "function") {
    storeSetCookies(options.sourceId, hostname, setCookieGetter.call(response.headers));
  }

  const headersObj: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    headersObj[k.toLowerCase()] = v;
  });

  if (
    options.allowChromiumFallback &&
    settings.transportMode === "auto" &&
    isBlockedStatus(response.status, text)
  ) {
    try {
      const cdp = await chromiumFetch({
        url: options.url,
        originUrl: options.originUrl,
        headers: reqHeaders,
        method: options.method,
        body: options.body,
        timeoutMs,
      });
      return {
        ok: cdp.status >= 200 && cdp.status < 300,
        status: cdp.status,
        text: cdp.text,
        headers: {},
        via: "chromium-cdp",
        proxyId: null,
        latencyMs: Date.now() - started,
      };
    } catch {
      // Preserve direct response when Chromium cannot bypass an IP-level block.
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    headers: headersObj,
    via: "direct",
    proxyId: null,
    latencyMs,
  };
}

/**
 * Drop-in `fetch` replacement for bookmaker adapters: fast native `fetch` when no proxy or custom
 * transport is active for that source, and automatically upgrades to `resilientFetch` otherwise.
 */
export async function sourceFetch(
  sourceId: SourceId,
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    preferHttp2?: boolean;
  },
): Promise<Response> {
  const settings = getProxySettings();
  const needsResilient =
    hasActiveProxyFor(sourceId) ||
    settings.transportMode !== "auto" ||
    settings.persistCookies ||
    init?.preferHttp2;

  if (!needsResilient) {
    return fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? 25_000),
    });
  }

  const res = await resilientFetch({
    url,
    sourceId,
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    timeoutMs: init?.timeoutMs ?? 25_000,
    preferHttp2: init?.preferHttp2,
    skipJitter: true,
  });

  // Node `Response` rejects null-body status codes like 204/304 if body string is passed.
  const noBody = res.status === 204 || res.status === 304;
  return new Response(noBody ? null : res.text, {
    status: res.status >= 200 && res.status <= 599 ? res.status : 502,
    headers: res.headers,
  });
}

export const PROXY_TEST_TARGETS: Record<string, { label: string; url: string }> = {
  "ip-check": { label: "Exit IP & Geo", url: "http://ip-api.com/json/?fields=status,countryCode,isp,query" },
  bwin: {
    label: "bwin API",
    url: "https://www.bwin.com/cds-api/bettingoffer/counts?x-bwin-accessid=NTZiMjk3OGMtNjU5Mi00NjA5LWI2MWItZmU4MDRhN2QxZmEz&lang=en&country=GB&userCountry=GB&state=Latest&tagTypes=Sport",
  },
  bet365: { label: "bet365.com", url: "https://www.bet365.com/" },
  stake: { label: "stake.com", url: "https://stake.com/sports/home" },
  totogaming: { label: "totogaming.am", url: "https://sport.totogaming.am/SportsBook/Home" },
  parimatch: { label: "parimatch.com", url: "https://parimatch.com/" },
  oddspedia: {
    label: "oddspedia API",
    url: "https://oddspedia.com/api/v1/getMatchList?sport=football&status=all&perPageDefault=10&page=1&language=en",
  },
  pinnacle: { label: "pinnacle.com", url: "https://guest.api.arcadia.pinnacle.com/0.1/sports" },
  "1xbet": { label: "1xBet feed", url: "https://1xbet.com/" },
};

export async function testProxyConnection(proxyId: string, target = "ip-check"): Promise<ProxyTestResult> {
  const proxy = getProxyById(proxyId);
  if (!proxy) {
    return {
      id: proxyId,
      target,
      ok: false,
      status: "error",
      httpStatus: null,
      latencyMs: 0,
      exitIp: null,
      country: null,
      error: "Proxy not found",
    };
  }

  const targetCfg = PROXY_TEST_TARGETS[target] ?? PROXY_TEST_TARGETS["ip-check"];
  const started = Date.now();

  try {
    const parsed = await curlExec({
      url: targetCfg.url,
      headers: {
        "User-Agent": USER_AGENTS[0],
        Accept: "application/json, text/html, */*",
      },
      proxyUrl: proxy.url,
      timeoutMs: 12_000,
    });
    const latencyMs = Date.now() - started;

    let exitIp: string | null = null;
    let country: string | null = null;
    if (target === "ip-check" && parsed.status >= 200 && parsed.status < 300) {
      try {
        const info = JSON.parse(parsed.body) as { query?: string; countryCode?: string };
        exitIp = info.query ?? null;
        country = info.countryCode ?? null;
      } catch {
        // Non-JSON response.
      }
    }

    const blocked = isBlockedStatus(parsed.status, parsed.body);
    const ok = parsed.status >= 200 && parsed.status < 400 && !blocked;
    const status = ok ? "ok" : blocked ? "blocked" : "error";
    const errMsg = ok ? null : `HTTP ${parsed.status}${blocked ? " (WAF/Geo blocked)" : ""}`;

    recordProxyOutcome(proxy.id, { ok, blocked, latencyMs, error: errMsg, exitIp });
    return {
      id: proxy.id,
      target,
      ok,
      status,
      httpStatus: parsed.status,
      latencyMs,
      exitIp,
      country,
      error: errMsg,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    recordProxyOutcome(proxy.id, { ok: false, blocked: false, latencyMs, error: msg });
    return {
      id: proxy.id,
      target,
      ok: false,
      status: "error",
      httpStatus: null,
      latencyMs,
      exitIp: null,
      country: null,
      error: msg,
    };
  }
}
