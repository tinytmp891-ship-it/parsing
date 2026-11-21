import { resilientFetch } from "@/lib/net/resilient-fetch";
import { hasActiveProxyFor } from "@/lib/proxy/manager";
import { extractMatchFormat } from "./format";
import {
  describeError,
  resolveSport,
  SourceUnavailableError,
  type NormalizedEvent,
  type SourceAdapter,
  type SourceTask,
} from "./model";

/**
 * Oddspedia (`oddspedia.com`).
 *
 * Uses `resilientFetch` (Proxy Manager residential/mobile pool -> HTTP/2 curl TLS -> Headless Chromium).
 * When reachable (e.g. via a clean residential proxy in Proxy Manager), fetches upcoming matches
 * from `/api/v1/getMatchList` across top sports; otherwise reports the Cloudflare Turnstile block.
 */

const SPORTS = ["football", "tennis", "basketball", "ice-hockey", "volleyball", "handball", "baseball", "esports"];

export type OddspediaMatchItem = {
  id?: string | number;
  ht?: string;
  at?: string;
  md?: string;
  starttime?: string;
  start_time?: string;
  status?: number | string;
  is_live?: boolean;
  league_name?: string;
  category_name?: string;
  sport_name?: string;
};

type OddspediaListResponse = {
  data?: {
    matchList?: OddspediaMatchItem[];
  };
  matchList?: OddspediaMatchItem[];
};

export function mapOddspediaMatches(
  items: OddspediaMatchItem[],
  sportFallback: string,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const m of items) {
    if (!m || m.id == null || m.is_live) continue;
    const home = m.ht?.trim() ?? "";
    const away = m.at?.trim() ?? "";
    const rawTime = m.md ?? m.starttime ?? m.start_time;
    if (!home || !away || !rawTime) continue;

    const startsAt = new Date(rawTime);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const sport = resolveSport(m.sport_name?.trim() || sportFallback);
    const league = [m.category_name?.trim(), m.league_name?.trim()].filter(Boolean).join(". ") || sport.name.en;
    events.push({
      source: "oddspedia",
      externalId: String(m.id),
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: league, ru: league },
      home: { en: home, ru: home },
      away: { en: away, ru: away },
      startsAt,
      sourceHost: "oddspedia.com",
      matchFormat: extractMatchFormat({
        sportKey: sport.key,
        leagueEn: league,
        homeEn: home,
        awayEn: away,
      }),
    });
  }
  return events;
}

function buildUrl(sport: string, page = 1): string {
  const dateFrom = new Date().toISOString().slice(0, 10);
  return (
    `https://oddspedia.com/api/v1/getMatchList?sport=${encodeURIComponent(sport)}` +
    `&status=upcoming&sortBy=default&perPageDefault=50&page=${page}&language=en&startDate=${dateFrom}`
  );
}

async function fetchOddspediaSport(sport: string): Promise<NormalizedEvent[]> {
  const res = await resilientFetch({
    url: buildUrl(sport, 1),
    sourceId: "oddspedia",
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: `https://oddspedia.com/${sport}`,
    },
    originUrl: "https://oddspedia.com/",
    allowChromiumFallback: true,
    preferHttp2: true,
    timeoutMs: 20_000,
  });

  const isTurnstile =
    res.status === 403 ||
    res.headers["cf-mitigated"] === "challenge" ||
    /just a moment|performing security verification/i.test(res.text);

  if (isTurnstile) {
    const hint = hasActiveProxyFor("oddspedia")
      ? "assigned proxy was also challenged"
      : "add a clean residential proxy in Proxy Manager";
    throw new SourceUnavailableError(
      `oddspedia.com protected by Cloudflare Turnstile (HTTP ${res.status}; ${hint})`,
    );
  }
  if (!res.ok) {
    throw new Error(`oddspedia.com returned HTTP ${res.status}`);
  }

  let json: OddspediaListResponse;
  try {
    json = JSON.parse(res.text) as OddspediaListResponse;
  } catch {
    throw new SourceUnavailableError("oddspedia.com returned non-JSON challenge page");
  }
  const list = json.data?.matchList ?? json.matchList ?? [];
  return mapOddspediaMatches(list, sport);
}

async function createTasks(): Promise<SourceTask[]> {
  try {
    // Probe football first so blocked direct IPs fail fast once without spamming 8 Turnstile hits.
    const first = await fetchOddspediaSport(SPORTS[0]);
    return [
      { label: "Oddspedia · football", run: async () => first },
      ...SPORTS.slice(1).map((sport) => ({
        label: `Oddspedia · ${sport}`,
        run: () => fetchOddspediaSport(sport),
      })),
    ];
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    throw new Error(`oddspedia.com unreachable: ${describeError(error)}`);
  }
}

export const oddspediaAdapter: SourceAdapter = {
  id: "oddspedia",
  concurrency: 2,
  createTasks,
};
