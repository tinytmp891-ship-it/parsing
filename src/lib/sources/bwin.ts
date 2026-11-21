import { resilientFetch } from "@/lib/net/resilient-fetch";
import { extractMatchFormat } from "./format";
import { extractMatchVenueInfo, extractTournamentStage } from "./match-details";
import {
  describeError,
  resolveSport,
  SourceUnavailableError,
  type NormalizedEvent,
  type SourceAdapter,
  type SourceTask,
} from "./model";

/**
 * bwin (www.bwin.com) live prematch feed via Entain's CDS API.
 *
 * Uses the discovered `x-bwin-accessid` + browser-grade headers + `resilientFetch`
 * (Proxy Pool / HTTP/2 TLS / Headless Chromium fallback) for both EN and RU locales.
 */

const BWIN_ACCESS_ID = "NTZiMjk3OGMtNjU5Mi00NjA5LWI2MWItZmU4MDRhN2QxZmEz";
const CDS_BASE = "https://www.bwin.com/cds-api/bettingoffer";
const REFERER_URL = "https://www.bwin.com/en/sports";
const PAGE_SIZE = 50;
const MAX_PAGES_PER_SPORT = 10;

type BwinCountItem = {
  tag?: {
    type?: string;
    id?: number;
    name?: { value?: string };
  };
  preMatch?: number;
};

type BwinParticipant = {
  name?: { value?: string };
  properties?: { type?: string };
};

export type BwinFixture = {
  id?: string | number;
  stage?: string;
  fixtureType?: string;
  isVirtual?: boolean;
  startDate?: string;
  sport?: { id?: number; name?: { value?: string } };
  region?: { name?: { value?: string } };
  competition?: { name?: { value?: string } };
  participants?: BwinParticipant[];
};

type BwinFixturesResponse = {
  totalCount?: number;
  fixtures?: BwinFixture[];
};

function bwinHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    Referer: REFERER_URL,
    "x-bwin-browser-url": REFERER_URL,
  };
}

function extractSides(participants: BwinParticipant[] | undefined): [string, string] | null {
  if (!Array.isArray(participants)) return null;
  const sides = participants.filter((p) => p.properties?.type !== "Player");
  const home =
    sides.find((p) => p.properties?.type === "HomeTeam")?.name?.value?.trim() ??
    (sides.length === 2 ? sides[0]?.name?.value?.trim() : undefined) ??
    "";
  const away =
    sides.find((p) => p.properties?.type === "AwayTeam")?.name?.value?.trim() ??
    (sides.length === 2 ? sides[1]?.name?.value?.trim() : undefined) ??
    "";
  if (!home || !away) return null;
  return [home, away];
}

export function mapBwinFixtures(
  enFixtures: BwinFixture[],
  ruFixtures: BwinFixture[],
  sportFallbackEn: string,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const ruById = new Map<string, BwinFixture>();
  for (const f of ruFixtures) {
    if (f.id != null) ruById.set(String(f.id), f);
  }

  const events: NormalizedEvent[] = [];
  for (const f of enFixtures) {
    if (!f || f.id == null || f.isVirtual) continue;
    if (f.stage && f.stage !== "PreMatch") continue;
    if (!f.startDate) continue;

    const startsAt = new Date(f.startDate);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const enSides = extractSides(f.participants);
    if (!enSides) continue;
    const [homeEn, awayEn] = enSides;

    const idStr = String(f.id);
    const ru = ruById.get(idStr);
    const ruSides = extractSides(ru?.participants);

    const sportEn = f.sport?.name?.value?.trim() || sportFallbackEn;
    const sportRu = ru?.sport?.name?.value?.trim();
    const sport = resolveSport(sportEn, sportRu);

    const leagueEn =
      [f.region?.name?.value?.trim(), f.competition?.name?.value?.trim()].filter(Boolean).join(". ") || sport.name.en;
    const leagueRu =
      [ru?.region?.name?.value?.trim(), ru?.competition?.name?.value?.trim()].filter(Boolean).join(". ") || leagueEn;

    events.push({
      source: "bwin",
      externalId: idStr,
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: leagueEn, ru: leagueRu },
      home: { en: homeEn, ru: ruSides?.[0] || homeEn },
      away: { en: awayEn, ru: ruSides?.[1] || awayEn },
      startsAt,
      sourceHost: "www.bwin.com",
      matchFormat: extractMatchFormat({
        sportKey: sport.key,
        leagueEn,
        leagueRu,
        homeEn,
        awayEn,
      }),
      tournamentStage: extractTournamentStage({ leagueEn, leagueRu }),
      matchInfo: extractMatchVenueInfo({ country: f.region?.name?.value }),
    });
  }

  return events;
}

async function fetchCdsJson<T>(pathAndQuery: string): Promise<T> {
  const url = `${CDS_BASE}/${pathAndQuery}`;
  const res = await resilientFetch({
    url,
    sourceId: "bwin",
    headers: bwinHeaders(),
    allowChromiumFallback: true,
    originUrl: REFERER_URL,
    preferHttp2: true,
    skipJitter: true,
  });
  if (res.status === 403 || res.status === 451) {
    throw new SourceUnavailableError(`bwin.com blocks this server (HTTP ${res.status}, Cloudflare)`);
  }
  if (!res.ok) {
    throw new Error(`bwin CDS HTTP ${res.status}`);
  }
  return JSON.parse(res.text) as T;
}

async function fetchSportFixtures(sportId: number, sportName: string): Promise<NormalizedEvent[]> {
  const baseParams =
    `x-bwin-accessid=${BWIN_ACCESS_ID}&country=GB&userCountry=GB` +
    `&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable` +
    `&fixtureCategories=Gridable,NonGridable,Other&sportIds=${sportId}&isPriceBoost=false` +
    `&statisticsModes=None&sortBy=Tags`;

  const enAll: BwinFixture[] = [];
  const ruAll: BwinFixture[] = [];

  for (let page = 0; page < MAX_PAGES_PER_SPORT; page += 1) {
    const skip = page * PAGE_SIZE;
    const [enRes, ruRes] = await Promise.all([
      fetchCdsJson<BwinFixturesResponse>(`fixtures?${baseParams}&lang=en&skip=${skip}&take=${PAGE_SIZE}`),
      fetchCdsJson<BwinFixturesResponse>(`fixtures?${baseParams}&lang=ru&skip=${skip}&take=${PAGE_SIZE}`).catch(
        () => ({ fixtures: [] }),
      ),
    ]);

    const batchEn = enRes.fixtures ?? [];
    if (batchEn.length === 0) break;
    enAll.push(...batchEn);
    if (ruRes.fixtures?.length) ruAll.push(...ruRes.fixtures);

    const total = enRes.totalCount ?? 0;
    if (enAll.length >= total || batchEn.length < PAGE_SIZE) break;
  }

  return mapBwinFixtures(enAll, ruAll, sportName);
}

async function createTasks(): Promise<SourceTask[]> {
  let counts: BwinCountItem[];
  try {
    counts = await fetchCdsJson<BwinCountItem[]>(
      `counts?x-bwin-accessid=${BWIN_ACCESS_ID}&lang=en&country=GB&userCountry=GB&state=Latest&tagTypes=Sport&sortBy=Tags`,
    );
  } catch (error) {
    if (error instanceof SourceUnavailableError) throw error;
    throw new Error(`bwin.com unreachable: ${describeError(error)}`);
  }

  const sports = counts.filter(
    (c): c is BwinCountItem & { tag: { id: number; name?: { value?: string } } } =>
      Boolean(c.tag?.id) && (c.preMatch ?? 0) > 0,
  );

  return sports.map((item) => {
    const name = item.tag.name?.value?.trim() || `Sport ${item.tag.id}`;
    return {
      label: `bwin · ${name}`,
      run: () => fetchSportFixtures(item.tag.id, name),
    };
  });
}

export const bwinAdapter: SourceAdapter = {
  id: "bwin",
  concurrency: 2,
  createTasks,
};
