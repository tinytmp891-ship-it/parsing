/**
 * Server-side client for the public 1xBet line feed.
 *
 * Domains are tried in order: 1xbet.com first, then 1xbet.ci. A domain that is
 * blocked (Cloudflare challenge, network error, 403/429/5xx) is put on a short
 * cooldown so subsequent requests go straight to the fallback domain.
 */

export const ONEXBET_DOMAINS = ["1xbet.com", "1xbet.ci"] as const;

const API_BASE_PATH = "/service-api/LineFeed";
const REQUEST_TIMEOUT_MS = 20_000;
const BLOCK_COOLDOWN_MS = 5 * 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type FeedParams = Record<string, string | number | boolean>;

export type DomainHealth = {
  domain: string;
  /** null = not checked yet in this server process */
  ok: boolean | null;
  checkedAt: string | null;
  error: string | null;
};

export type FeedHealth = {
  lastGoodDomain: string | null;
  domains: DomainHealth[];
};

type DomainState = { ok: boolean; checkedAt: string; error: string | null };

type FeedState = {
  lastGoodDomain: string | null;
  cooldownUntil: Record<string, number>;
  health: Record<string, DomainState>;
};

const globalForFeed = globalThis as typeof globalThis & {
  __onexbetFeedState?: FeedState;
};

const state: FeedState =
  globalForFeed.__onexbetFeedState ?? { lastGoodDomain: null, cooldownUntil: {}, health: {} };
globalForFeed.__onexbetFeedState = state;

class FeedRequestError extends Error {
  /** true when the domain itself looks unavailable (blocked, down, network) */
  readonly blocking: boolean;

  constructor(message: string, blocking: boolean) {
    super(message);
    this.name = "FeedRequestError";
    this.blocking = blocking;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function orderedDomains(): string[] {
  const now = Date.now();
  return [...ONEXBET_DOMAINS].sort((a, b) => {
    const coolA = (state.cooldownUntil[a] ?? 0) > now ? 1 : 0;
    const coolB = (state.cooldownUntil[b] ?? 0) > now ? 1 : 0;
    if (coolA !== coolB) return coolA - coolB;
    if (a === state.lastGoodDomain) return -1;
    if (b === state.lastGoodDomain) return 1;
    return 0;
  });
}

async function requestJson(url: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new FeedRequestError(`network error (${describeError(error)})`, true);
  }

  const body = await response.text();
  const trimmed = body.trimStart();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const isChallenge = /just a moment|challenge-platform|cf-chl/i.test(body);
    throw new FeedRequestError(
      isChallenge ? "blocked by Cloudflare challenge page" : `HTTP ${response.status} with non-JSON body`,
      true,
    );
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new FeedRequestError("invalid JSON response", true);
  }

  if (!response.ok) {
    const detail = String(json.detail ?? json.title ?? "");
    const blocking = response.status === 403 || response.status === 429 || response.status >= 500;
    throw new FeedRequestError(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`, blocking);
  }

  if (json.Success === false) {
    throw new FeedRequestError(`API error ${String(json.ErrorCode ?? "")}: ${String(json.Error ?? "unknown")}`, false);
  }

  return json;
}

function markHealthy(domain: string) {
  state.lastGoodDomain = domain;
  delete state.cooldownUntil[domain];
  state.health[domain] = { ok: true, checkedAt: new Date().toISOString(), error: null };
}

function markBlocked(domain: string, message: string) {
  state.cooldownUntil[domain] = Date.now() + BLOCK_COOLDOWN_MS;
  state.health[domain] = { ok: false, checkedAt: new Date().toISOString(), error: message };
}

/**
 * GET a feed endpoint and return its `Value` payload.
 * Tries each domain in preference order and reports which one served the response.
 */
export async function feedGet<T>(endpoint: string, params: FeedParams): Promise<{ value: T; domain: string }> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const failures: string[] = [];

  for (const domain of orderedDomains()) {
    const url = `https://${domain}${API_BASE_PATH}/${endpoint}?${query}`;
    try {
      const json = await requestJson(url);
      if (json.Value === undefined) {
        throw new FeedRequestError("response has no Value", false);
      }
      markHealthy(domain);
      return { value: json.Value as T, domain };
    } catch (error) {
      const message = describeError(error);
      failures.push(`${domain}: ${message}`);
      if (error instanceof FeedRequestError && error.blocking) {
        markBlocked(domain, message);
      }
    }
  }

  throw new Error(`All 1xBet domains failed for ${endpoint}: ${failures.join("; ")}`);
}

/**
 * Try several parameter sets for the same endpoint (the feed rejects some combinations with 406).
 */
export async function feedGetWithVariants<T>(
  endpoint: string,
  variants: FeedParams[],
): Promise<{ value: T; domain: string }> {
  let lastError: unknown = null;
  for (const params of variants) {
    try {
      return await feedGet<T>(endpoint, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Feed request failed: ${endpoint}`);
}

export function getFeedHealth(): FeedHealth {
  return {
    lastGoodDomain: state.lastGoodDomain,
    domains: ONEXBET_DOMAINS.map((domain) => {
      const entry = state.health[domain];
      return {
        domain,
        ok: entry ? entry.ok : null,
        checkedAt: entry?.checkedAt ?? null,
        error: entry?.error ?? null,
      };
    }),
  };
}
