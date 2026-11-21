import { sourceFetch } from "@/lib/net/resilient-fetch";
import { extractMatchFormat } from "./format";
import { describeError, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * NetBet Sports (`sport.netbet.com` WAF blocks this server with HTTP 403;
 * `sport.netbet.ro` uses `api.sportify.bet` which responds cleanly with all prematch events).
 */

const SPORTIFY_BASE = "https://api.sportify.bet/api/content";
const BOOKMAKER = "netbetro";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type NetbetSport = {
  name?: string;
  slug?: string;
  category?: string;
  event_count?: number;
  soft_delete?: unknown;
};

type NetbetSportsResponse = {
  data?: NetbetSport[];
};

type NetbetCompetitor = {
  name?: string;
  is_home?: boolean;
};

type NetbetEvent = {
  id?: string | number;
  starts_at?: string;
  is_live?: boolean;
  sport_name?: string;
  region_name?: string;
  competition_name?: string;
  competitors?: NetbetCompetitor[];
};

type NetbetCompetition = {
  name?: string;
  events?: NetbetEvent[];
};

type NetbetTreeNode = {
  name?: string;
  region?: { name?: string };
  competition?: { name?: string };
  competitions?: NetbetCompetition[];
};

type NetbetEventsResponse = {
  tree?: NetbetTreeNode[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await sourceFetch("netbet", url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: "https://sport.netbet.ro",
      Referer: "https://sport.netbet.ro/",
    },
    timeoutMs: 25_000,
  });
  if (!response.ok) {
    throw new Error(`NetBet Sportify HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function mapNetbetTree(
  payload: NetbetEventsResponse,
  sportFallback: string,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];

  for (const node of payload.tree ?? []) {
    const nodeRegion = node.region?.name?.trim();
    const nodeSport = node.name?.trim() || sportFallback;

    for (const comp of node.competitions ?? []) {
      const compName = comp.name?.trim() || node.competition?.name?.trim();
      for (const ev of comp.events ?? []) {
        if (!ev || ev.id == null || ev.is_live) continue;
        const competitors = ev.competitors ?? [];
        if (competitors.length !== 2) continue;

        const homeObj = competitors.find((c) => c.is_home) ?? competitors[0];
        const awayObj = competitors.find((c) => c !== homeObj) ?? competitors[1];
        const home = homeObj?.name?.trim() ?? "";
        const away = awayObj?.name?.trim() ?? "";
        if (!home || !away || !ev.starts_at) continue;

        const startsAt = new Date(ev.starts_at);
        if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

        const sport = resolveSport(ev.sport_name?.trim() || nodeSport);
        const region = ev.region_name?.trim() || nodeRegion;
        const leaguePart = ev.competition_name?.trim() || compName;
        const league = [region, leaguePart].filter(Boolean).join(". ") || sport.name.en;

        events.push({
          source: "netbet",
          externalId: String(ev.id),
          sportKey: sport.key,
          sportName: sport.name,
          leagueName: { en: league, ru: league },
          home: { en: home, ru: home },
          away: { en: away, ru: away },
          startsAt,
          sourceHost: "sport.netbet.ro",
          matchFormat: extractMatchFormat({
            sportKey: sport.key,
            leagueEn: league,
            homeEn: home,
            awayEn: away,
          }),
        });
      }
    }
  }

  return events;
}

async function createTasks(): Promise<SourceTask[]> {
  let sportsRes: NetbetSportsResponse;
  try {
    sportsRes = await fetchJson<NetbetSportsResponse>(
      `${SPORTIFY_BASE}/inventory-sports?lang=en&bookmaker=${BOOKMAKER}`,
    );
  } catch (error) {
    throw new Error(`NetBet feed unreachable: ${describeError(error)}`);
  }

  const sports = (sportsRes.data ?? []).filter(
    (s): s is Required<Pick<NetbetSport, "slug">> & NetbetSport =>
      Boolean(s.slug) && s.category === "sport" && !s.soft_delete && (s.event_count ?? 0) > 0,
  );

  return sports.map((s) => {
    const labelName = s.name?.trim() || s.slug;
    return {
      label: `NetBet · ${labelName}`,
      run: async () => {
        const payload = await fetchJson<NetbetEventsResponse>(
          `${SPORTIFY_BASE}/inventory-events?lang=en&bookmaker=${BOOKMAKER}&sport=${encodeURIComponent(s.slug)}`,
        );
        return mapNetbetTree(payload, labelName);
      },
    };
  });
}

export const netbetAdapter: SourceAdapter = {
  id: "netbet",
  concurrency: 3,
  createTasks,
};
