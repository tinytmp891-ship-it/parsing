import { sourceFetch } from "@/lib/net/resilient-fetch";
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
 * Pinnacle (www.pinnacle.com), all active sports via Pinnacle's public guest Arcadia API.
 * Uses `sourceFetch` so Proxy Manager routing, cookie jar, and HTTP/2 options apply automatically.
 */

const API_BASE = "https://guest.api.arcadia.pinnacle.com";
const PAGE_URL = "https://www.pinnacle.com/en/sports/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

type PinnacleSport = {
  id: number;
  name?: string;
  matchupCount?: number;
};

type PinnacleParticipant = { alignment?: string; name?: string };
type PinnacleLeague = { name?: string; isHidden?: boolean };
type PinnaclePeriod = { period?: number; status?: string };
export type PinnacleMatchup = {
  id: number;
  type?: string;
  parent?: unknown;
  startTime?: string;
  isLive?: boolean;
  status?: string;
  participants?: PinnacleParticipant[];
  league?: PinnacleLeague;
  periods?: PinnaclePeriod[];
};

function pinnacleHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Origin: "https://www.pinnacle.com",
    Referer: PAGE_URL,
  };
}

function teamName(participants: PinnacleParticipant[] | undefined, alignment: "home" | "away"): string {
  return participants?.find((item) => item.alignment === alignment)?.name?.trim() ?? "";
}

export function mapPinnacleMatchups(
  matchups: PinnacleMatchup[],
  sportLabel: string,
  sportId?: number,
  nowMs = Date.now(),
): NormalizedEvent[] {
  // Pinnacle labels Soccer as "Soccer" (id=29) and Gridiron/NFL as "Football" (id=15).
  const canonicalSourceSport =
    sportId === 15 || sportLabel.toLowerCase() === "football"
      ? "American Football"
      : sportId === 29
        ? "Football"
        : sportLabel;

  const sport = resolveSport(canonicalSourceSport);
  const events: NormalizedEvent[] = [];

  for (const matchup of matchups) {
    if (matchup.type !== "matchup" || matchup.parent || matchup.isLive) continue;
    if (matchup.status && matchup.status !== "pending") continue;
    if (matchup.league?.isHidden) continue;

    const home = teamName(matchup.participants, "home");
    const away = teamName(matchup.participants, "away");
    if (!home || !away || !matchup.startTime) continue;

    const startsAt = new Date(matchup.startTime);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const league = matchup.league?.name?.trim() || sport.name.en;
    const positivePeriods = (matchup.periods ?? [])
      .map((p) => p.period ?? 0)
      .filter((n) => Number.isInteger(n) && n >= 1);
    const maxPeriod = positivePeriods.length > 0 ? Math.max(...positivePeriods) : 0;
    const feedBestOf = sport.key === "esports" && maxPeriod >= 2 ? maxPeriod : null;

    events.push({
      source: "pinnacle",
      externalId: String(matchup.id),
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: league, ru: league },
      home: { en: home, ru: home },
      away: { en: away, ru: away },
      startsAt,
      sourceHost: "www.pinnacle.com",
      matchFormat: extractMatchFormat({
        sportKey: sport.key,
        leagueEn: league,
        homeEn: home,
        awayEn: away,
        feedBestOf,
      }),
    });
  }

  return events;
}

async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await sourceFetch("pinnacle", `${API_BASE}${path}`, {
      headers: pinnacleHeaders(),
      timeoutMs: 25_000,
    });
  } catch (error) {
    throw new Error(`pinnacle.com is unreachable: ${describeError(error)}`);
  }

  if (response.status === 403 || response.status === 451) {
    await response.text().catch(() => "");
    throw new SourceUnavailableError(`pinnacle.com blocks this IP (HTTP ${response.status})`);
  }
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new Error(`Pinnacle API returned HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

async function createTasks(): Promise<SourceTask[]> {
  const sports = await fetchJson<PinnacleSport[]>("/0.1/sports");
  const active = sports.filter(
    (s) =>
      (s.matchupCount ?? 0) > 0 &&
      s.name &&
      !/^(entertainment|politics|crossfit|mixed)$/i.test(s.name.trim()),
  );

  return active.map((s) => {
    const labelName = s.name?.trim() || `Sport ${s.id}`;
    return {
      label: `Pinnacle · ${labelName}`,
      run: async () => {
        try {
          const matchups = await fetchJson<PinnacleMatchup[]>(`/0.1/sports/${s.id}/matchups`);
          return Array.isArray(matchups) ? mapPinnacleMatchups(matchups, labelName, s.id) : [];
        } catch (err) {
          const msg = describeError(err);
          if (/HTTP (?:401|404)/.test(msg)) return [];
          throw err;
        }
      },
    };
  });
}

export const pinnacleAdapter: SourceAdapter = {
  id: "pinnacle",
  concurrency: 3,
  createTasks,
};
