import { describeError, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * Fonbet prematch line. The listing endpoint returns every line event in one JSON document,
 * with tournaments ("segments") and sports linked by parentId. Run once per language.
 */

const HOSTS = ["line-lb51.bk6bba-resources.com", "line-lb52.bk6bba-resources.com"];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type FonbetNode = { id: number; kind: string; name: string; parentId?: number };
type FonbetEvent = {
  id: number;
  sportId: number;
  kind: number;
  level: number;
  place: string;
  startTime: number;
  team1?: string;
  team2?: string;
};
type FonbetListing = { sports: FonbetNode[]; events: FonbetEvent[] };

async function fetchListing(lang: "en" | "ru"): Promise<{ listing: FonbetListing; host: string }> {
  let lastError: unknown = null;
  for (const host of HOSTS) {
    try {
      const response = await fetch(`https://${host}/events/listBase?scopeMarket=1600&lang=${lang}`, {
        cache: "no-store",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(40_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const listing = (await response.json()) as FonbetListing;
      if (!Array.isArray(listing.events) || !Array.isArray(listing.sports)) {
        throw new Error("unexpected payload");
      }
      return { listing, host };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Fonbet listing unavailable (${lang}): ${describeError(lastError)}`);
}

/** Walk up the tournament -> ... -> sport chain. */
function findSportNode(sportId: number, nodes: Map<number, FonbetNode>): FonbetNode | undefined {
  let node = nodes.get(sportId);
  let guard = 0;
  while (node && node.kind !== "sport" && node.parentId && guard < 10) {
    node = nodes.get(node.parentId);
    guard += 1;
  }
  return node && node.kind === "sport" ? node : undefined;
}

async function fetchEvents(): Promise<NormalizedEvent[]> {
  const [en, ru] = await Promise.all([fetchListing("en"), fetchListing("ru")]);

  const sportsEn = new Map(en.listing.sports.map((node) => [node.id, node] as const));
  const sportsRu = new Map(ru.listing.sports.map((node) => [node.id, node] as const));
  const eventsRu = new Map(ru.listing.events.map((event) => [event.id, event] as const));
  const nowMs = Date.now();
  const events: NormalizedEvent[] = [];

  for (const event of en.listing.events) {
    // kind 1 / level 1 = a match (team vs team); place "line" = prematch.
    if (event.kind !== 1 || event.level !== 1 || event.place !== "line") continue;
    if (!event.team1 || !event.team2) continue;

    const startsAt = new Date(event.startTime * 1000);
    if (startsAt.getTime() <= nowMs) continue;

    const sportEn = findSportNode(event.sportId, sportsEn);
    if (!sportEn) continue;
    const sportRu = findSportNode(event.sportId, sportsRu);
    const sport = resolveSport(sportEn.name, sportRu?.name);

    const tournamentEn = sportsEn.get(event.sportId)?.name ?? sportEn.name;
    const tournamentRu = sportsRu.get(event.sportId)?.name ?? tournamentEn;
    const ruEvent = eventsRu.get(event.id);

    events.push({
      source: "fonbet",
      externalId: String(event.id),
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: tournamentEn, ru: tournamentRu },
      home: { en: event.team1, ru: ruEvent?.team1 || event.team1 },
      away: { en: event.team2, ru: ruEvent?.team2 || event.team2 },
      startsAt,
      sourceHost: en.host,
    });
  }

  return events;
}

export const fonbetAdapter: SourceAdapter = {
  id: "fonbet",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => [{ label: "Fonbet prematch line", run: fetchEvents }],
};
