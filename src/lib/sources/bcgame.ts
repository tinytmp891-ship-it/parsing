import { sourceFetch } from "@/lib/net/resilient-fetch";
import { extractMatchFormat } from "./format";
import { extractMatchVenueInfo, extractTournamentStage } from "./match-details";
import { describeError, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * BC.Game Sportsbook (`playglobal16.com`) prematch feed via its sptpub v4 REST API.
 * Reads the version index for EN and RU, then fetches each version chunk and joins events 1:1.
 */

const BRAND_ID = "2103509236163162112";
const API_BASE = `https://api-k-c7818b61-623.sptpub.com/api/v4/prematch/brand/${BRAND_ID}`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type BcIndexResponse = {
  top_events_versions?: (string | number)[];
  rest_events_versions?: (string | number)[];
};

type BcCompetitor = {
  name?: string;
};

type BcEventDesc = {
  scheduled?: number;
  type?: string;
  virtual?: boolean;
  sport?: string;
  category?: string;
  tournament?: string;
  competitors?: BcCompetitor[];
};

type BcChunkResponse = {
  sports?: Record<string, { name?: string }>;
  categories?: Record<string, { name?: string }>;
  tournaments?: Record<string, { name?: string }>;
  events?: Record<string, { desc?: BcEventDesc }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await sourceFetch("bcgame", url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: "https://playglobal16.com",
      Referer: "https://playglobal16.com/",
    },
    timeoutMs: 25_000,
  });
  if (!response.ok) {
    throw new Error(`BC.Game feed HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function mapBcGameChunk(
  enChunk: BcChunkResponse,
  ruChunk: BcChunkResponse | null,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const sportsEn = enChunk.sports ?? {};
  const sportsRu = ruChunk?.sports ?? {};
  const catsEn = enChunk.categories ?? {};
  const catsRu = ruChunk?.categories ?? {};
  const toursEn = enChunk.tournaments ?? {};
  const toursRu = ruChunk?.tournaments ?? {};
  const eventsRu = ruChunk?.events ?? {};

  for (const [id, item] of Object.entries(enChunk.events ?? {})) {
    const desc = item?.desc;
    if (!desc || desc.virtual || desc.type !== "match") continue;
    const comps = desc.competitors ?? [];
    if (comps.length !== 2) continue;

    const homeEn = comps[0]?.name?.trim() ?? "";
    const awayEn = comps[1]?.name?.trim() ?? "";
    if (!homeEn || !awayEn || !desc.scheduled) continue;

    const startsAt = new Date(desc.scheduled * 1000);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const sportEn = (desc.sport ? sportsEn[desc.sport]?.name : undefined)?.trim() || "Other";
    const sportRu = (desc.sport ? sportsRu[desc.sport]?.name : undefined)?.trim();
    const sport = resolveSport(sportEn, sportRu);

    const catEn = (desc.category ? catsEn[desc.category]?.name : undefined)?.trim();
    const tourEn = (desc.tournament ? toursEn[desc.tournament]?.name : undefined)?.trim();
    const leagueEn = [catEn, tourEn].filter(Boolean).join(". ") || sport.name.en;

    const catRu = (desc.category ? catsRu[desc.category]?.name : undefined)?.trim();
    const tourRu = (desc.tournament ? toursRu[desc.tournament]?.name : undefined)?.trim();
    const leagueRu = [catRu, tourRu].filter(Boolean).join(". ") || leagueEn;

    const ruComps = eventsRu[id]?.desc?.competitors;
    const homeRu = ruComps?.[0]?.name?.trim() || homeEn;
    const awayRu = ruComps?.[1]?.name?.trim() || awayEn;

    events.push({
      source: "bcgame",
      externalId: id,
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: leagueEn, ru: leagueRu },
      home: { en: homeEn, ru: homeRu },
      away: { en: awayEn, ru: awayRu },
      startsAt,
      sourceHost: "playglobal16.com",
      matchFormat: extractMatchFormat({
        sportKey: sport.key,
        leagueEn,
        leagueRu,
        homeEn,
        awayEn,
      }),
      tournamentStage: extractTournamentStage({ leagueEn, leagueRu }),
      matchInfo: extractMatchVenueInfo({ country: catEn }),
    });
  }

  return events;
}

async function createTasks(): Promise<SourceTask[]> {
  let indexEn: BcIndexResponse;
  try {
    indexEn = await fetchJson<BcIndexResponse>(`${API_BASE}/en/0`);
  } catch (error) {
    throw new Error(`BC.Game feed unreachable: ${describeError(error)}`);
  }

  const versions = [
    ...new Set([
      ...(indexEn.top_events_versions ?? []).map(String),
      ...(indexEn.rest_events_versions ?? []).map(String),
    ]),
  ].filter(Boolean);

  return versions.map((version, idx) => ({
    label: `BC.Game chunk ${idx + 1}/${versions.length}`,
    run: async () => {
      const [enChunk, ruChunk] = await Promise.all([
        fetchJson<BcChunkResponse>(`${API_BASE}/en/${version}`),
        fetchJson<BcChunkResponse>(`${API_BASE}/ru/${version}`).catch(() => null),
      ]);
      return mapBcGameChunk(enChunk, ruChunk);
    },
  }));
}

export const bcgameAdapter: SourceAdapter = {
  id: "bcgame",
  concurrency: 3,
  createTasks,
};
