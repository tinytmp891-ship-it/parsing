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
 * Stake (stake.com), sports section.
 *
 * Uses `resilientFetch` (Proxy Manager residential/mobile pool -> HTTP/2 curl -> Chromium CDP).
 * When reachable via a non-Cloudflare-blocked residential proxy, queries Stake's GraphQL
 * `SlugSportFixtureList` endpoint for upcoming prematch fixtures.
 */

const STAKE_GRAPHQL = "https://stake.com/_api/graphql";
const STAKE_PAGE = "https://stake.com/sports/home";
const STAKE_SPORTS = ["soccer", "basketball", "tennis", "ice-hockey", "esports", "baseball", "mma"];

const FIXTURE_LIST_QUERY = `
query SlugSportFixtureList($sport: String!, $type: SportSearchEnum!, $limit: Int!, $offset: Int!) {
  slugSport(sport: $sport) {
    id
    name
    fixtureCount(type: $type)
    fixtureList(type: $type, limit: $limit, offset: $offset) {
      id
      name
      status
      data {
        __typename
        ... on SportFixtureDataMatch {
          startTime
          competitors {
            name
          }
        }
      }
      tournament {
        name
        category {
          name
        }
      }
    }
  }
}`;

type StakeFixtureNode = {
  id?: string;
  name?: string;
  status?: string;
  data?: {
    __typename?: string;
    startTime?: string;
    competitors?: { name?: string }[];
  };
  tournament?: {
    name?: string;
    category?: { name?: string };
  };
};

export function mapStakeFixtures(
  fixtures: StakeFixtureNode[],
  sportFallback: string,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const fx of fixtures) {
    if (!fx.id || fx.data?.__typename !== "SportFixtureDataMatch") continue;
    const comps = fx.data.competitors ?? [];
    if (comps.length !== 2 || !fx.data.startTime) continue;

    const home = comps[0]?.name?.trim() ?? "";
    const away = comps[1]?.name?.trim() ?? "";
    if (!home || !away) continue;

    const startsAt = new Date(fx.data.startTime);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const sport = resolveSport(sportFallback);
    const league =
      [fx.tournament?.category?.name?.trim(), fx.tournament?.name?.trim()].filter(Boolean).join(". ") ||
      sport.name.en;
    events.push({
      source: "stake",
      externalId: fx.id,
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: league, ru: league },
      home: { en: home, ru: home },
      away: { en: away, ru: away },
      startsAt,
      sourceHost: "stake.com",
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

async function fetchStakeSport(sportSlug: string): Promise<NormalizedEvent[]> {
  const res = await resilientFetch({
    url: STAKE_GRAPHQL,
    sourceId: "stake",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://stake.com",
      Referer: STAKE_PAGE,
    },
    body: JSON.stringify({
      query: FIXTURE_LIST_QUERY,
      variables: { sport: sportSlug, type: "upcoming", limit: 50, offset: 0 },
    }),
    originUrl: STAKE_PAGE,
    allowChromiumFallback: true,
    preferHttp2: true,
    timeoutMs: 20_000,
  });

  if (
    res.status === 403 ||
    res.headers["cf-mitigated"] === "challenge" ||
    /just a moment|performing security verification/i.test(res.text)
  ) {
    const hint = hasActiveProxyFor("stake")
      ? "assigned proxy was also challenged"
      : "add a residential proxy in Proxy Manager";
    throw new SourceUnavailableError(`stake.com Cloudflare challenge (HTTP ${res.status}; ${hint})`);
  }
  if (!res.ok) {
    throw new Error(`stake.com GraphQL HTTP ${res.status}`);
  }

  let json: { data?: { slugSport?: { name?: string; fixtureList?: StakeFixtureNode[] } } };
  try {
    json = JSON.parse(res.text) as typeof json;
  } catch {
    throw new SourceUnavailableError("stake.com returned non-JSON response");
  }
  const slugSport = json.data?.slugSport;
  return mapStakeFixtures(slugSport?.fixtureList ?? [], slugSport?.name ?? sportSlug);
}

async function createTasks(): Promise<SourceTask[]> {
  try {
    const first = await fetchStakeSport(STAKE_SPORTS[0]);
    return [
      { label: "Stake · soccer", run: async () => first },
      ...STAKE_SPORTS.slice(1).map((sport) => ({
        label: `Stake · ${sport}`,
        run: () => fetchStakeSport(sport),
      })),
    ];
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    throw new Error(`stake.com unreachable: ${describeError(error)}`);
  }
}

export const stakeAdapter: SourceAdapter = {
  id: "stake",
  concurrency: 2,
  createTasks,
};
