import {
  describeError,
  resolveSport,
  SourceUnavailableError,
  type NormalizedEvent,
  type SourceAdapter,
  type SourceTask,
} from "./model";

/**
 * Pinnacle (www.pinnacle.com), hockey matchups.
 *
 * The matchups page loads its data from Pinnacle's public guest API, the same endpoint the web app calls.
 * This adapter reads the hockey matchup list from that endpoint. Only standard prematch matches are kept:
 * live games, special markets (props) and hidden leagues are skipped, so each match is listed once.
 */

const API_BASE = "https://guest.api.arcadia.pinnacle.com";
const HOCKEY_SPORT_ID = 19;
const PAGE_URL = "https://www.pinnacle.com/en/hockey/matchups/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type PinnacleParticipant = { alignment?: string; name?: string };
type PinnacleLeague = { name?: string; isHidden?: boolean };
type PinnacleMatchup = {
  id: number;
  type?: string;
  parent?: unknown;
  startTime?: string;
  isLive?: boolean;
  status?: string;
  participants?: PinnacleParticipant[];
  league?: PinnacleLeague;
};

async function fetchMatchups(): Promise<PinnacleMatchup[]> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/0.1/sports/${HOCKEY_SPORT_ID}/matchups`, {
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Origin: "https://www.pinnacle.com",
        Referer: PAGE_URL,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`pinnacle.com is unreachable: ${describeError(error)}`);
  }

  if (response.status === 403 || response.status === 451) {
    await response.text().catch(() => "");
    throw new SourceUnavailableError(`pinnacle.com blocks this server (HTTP ${response.status})`);
  }
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new Error(`Pinnacle hockey matchups returned HTTP ${response.status}`);
  }

  const json: unknown = await response.json().catch(() => null);
  if (!Array.isArray(json)) throw new Error("Pinnacle hockey matchups: unexpected response");
  return json as PinnacleMatchup[];
}

function teamName(participants: PinnacleParticipant[] | undefined, alignment: "home" | "away"): string {
  return participants?.find((item) => item.alignment === alignment)?.name?.trim() ?? "";
}

function toEvents(matchups: PinnacleMatchup[]): NormalizedEvent[] {
  const sport = resolveSport("Hockey");
  const nowMs = Date.now();
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

    const league = matchup.league?.name?.trim() || "Hockey";
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
    });
  }

  return events;
}

export const pinnacleAdapter: SourceAdapter = {
  id: "pinnacle",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => [
    { label: "Pinnacle hockey matchups", run: async () => toEvents(await fetchMatchups()) },
  ],
};
