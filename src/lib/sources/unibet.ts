import { sourceFetch } from "@/lib/net/resilient-fetch";
import { extractMatchFormat } from "./format";
import { extractMatchVenueInfo, extractTournamentStage } from "./match-details";
import { describeError, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * Unibet Australia (www.unibet.com.au) via its live Kambi Asia-Pacific offering API
 * (`ap.offering-api.kambicdn.com/offering/v2018/ubau`).
 * Reads all active sports from `group.json` and fetches prematch fixtures from `listView`.
 */

const KAMBI_BASE = "https://ap.offering-api.kambicdn.com/offering/v2018/ubau";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type KambiGroup = {
  name?: string;
  englishName?: string;
  termKey?: string;
  eventCount?: number;
};

type KambiGroupResponse = {
  group?: {
    groups?: KambiGroup[];
  };
};

type KambiPathItem = {
  name?: string;
  englishName?: string;
};

type KambiEvent = {
  id?: number;
  name?: string;
  homeName?: string;
  awayName?: string;
  start?: string;
  group?: string;
  state?: string;
  path?: KambiPathItem[];
};

type KambiListResponse = {
  events?: { event?: KambiEvent }[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await sourceFetch("unibet", url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: "https://www.unibet.com.au",
      Referer: "https://www.unibet.com.au/",
    },
    timeoutMs: 25_000,
  });
  if (!response.ok) {
    throw new Error(`Unibet Kambi HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function mapUnibetEvents(
  enData: KambiListResponse,
  ruData: KambiListResponse | null,
  sportFallbackEn: string,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const ruById = new Map<number, KambiEvent>();
  for (const item of ruData?.events ?? []) {
    if (item.event?.id) ruById.set(item.event.id, item.event);
  }

  const events: NormalizedEvent[] = [];
  for (const item of enData.events ?? []) {
    const ev = item.event;
    if (!ev || !ev.id) continue;
    if (ev.state === "STARTED") continue;

    const homeEn = ev.homeName?.trim() ?? "";
    const awayEn = ev.awayName?.trim() ?? "";
    if (!homeEn || !awayEn || !ev.start) continue;

    const startsAt = new Date(ev.start);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const ruEv = ruById.get(ev.id);
    const sportEn = ev.path?.[0]?.englishName?.trim() || ev.path?.[0]?.name?.trim() || sportFallbackEn;
    const sportRu = ruEv?.path?.[0]?.name?.trim();
    const sport = resolveSport(sportEn, sportRu);

    const leaguePartsEn = (ev.path ?? [])
      .slice(1)
      .map((p) => (p.englishName || p.name || "").trim())
      .filter(Boolean);
    const leagueEn = leaguePartsEn.join(". ") || ev.group?.trim() || sport.name.en;

    const leaguePartsRu = (ruEv?.path ?? [])
      .slice(1)
      .map((p) => (p.name || p.englishName || "").trim())
      .filter(Boolean);
    const leagueRu = leaguePartsRu.join(". ") || ruEv?.group?.trim() || leagueEn;

    const homeRu = ruEv?.homeName?.trim() || homeEn;
    const awayRu = ruEv?.awayName?.trim() || awayEn;

    const countryRaw = ev.path?.[1]?.englishName?.trim() || ev.path?.[1]?.name?.trim();

    events.push({
      source: "unibet",
      externalId: String(ev.id),
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: leagueEn, ru: leagueRu },
      home: { en: homeEn, ru: homeRu },
      away: { en: awayEn, ru: awayRu },
      startsAt,
      sourceHost: "www.unibet.com.au",
      matchFormat: extractMatchFormat({
        sportKey: sport.key,
        leagueEn,
        leagueRu,
        homeEn,
        awayEn,
        feedHints: [ev.name],
      }),
      tournamentStage: extractTournamentStage({
        leagueEn,
        leagueRu,
        feedHints: [ev.group],
      }),
      matchInfo: extractMatchVenueInfo({ country: countryRaw }),
    });
  }

  return events;
}

async function createTasks(): Promise<SourceTask[]> {
  let root: KambiGroupResponse;
  try {
    root = await fetchJson<KambiGroupResponse>(`${KAMBI_BASE}/group.json?lang=en_AU&market=AU`);
  } catch (error) {
    throw new Error(`Unibet AU feed unreachable: ${describeError(error)}`);
  }

  const groups = (root.group?.groups ?? []).filter(
    (g): g is Required<Pick<KambiGroup, "termKey">> & KambiGroup =>
      Boolean(g.termKey) && (g.eventCount ?? 0) > 0,
  );

  return groups.map((group) => {
    const sportLabel = group.englishName?.trim() || group.name?.trim() || group.termKey;
    return {
      label: `Unibet · ${sportLabel}`,
      run: async () => {
        const query = "market=AU&client_id=2&channel_id=1&useCombined=true";
        const [enData, ruData] = await Promise.all([
          fetchJson<KambiListResponse>(
            `${KAMBI_BASE}/listView/${encodeURIComponent(group.termKey)}/all/all/all/matches.json?lang=en_AU&${query}`,
          ),
          fetchJson<KambiListResponse>(
            `${KAMBI_BASE}/listView/${encodeURIComponent(group.termKey)}/all/all/all/matches.json?lang=ru_RU&${query}`,
          ).catch(() => null),
        ]);
        return mapUnibetEvents(enData, ruData, sportLabel);
      },
    };
  });
}

export const unibetAdapter: SourceAdapter = {
  id: "unibet",
  concurrency: 4,
  createTasks,
};
