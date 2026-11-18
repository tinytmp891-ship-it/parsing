import { feedGet, feedGetWithVariants } from "@/lib/onexbet/feed";
import {
  isPresent,
  mapWithConcurrency,
  resolveSport,
  type NormalizedEvent,
  type SourceAdapter,
  type SourceTask,
} from "./model";

/** 1xBet line feed: sport list -> leagues -> games per league (plus a sport-wide fallback). */

const SPORTS_PARAMS = { lng: "en", tf: 1000000, tz: 3, country: 1 };
/** "Long-term bets" are outright markets, not single matches. */
const LONG_TERM_SPORT_ID = 2999;
const LEAGUE_LOOKUP_CONCURRENCY = 6;

type RawSport = { I: number; N: string; R?: string };
type RawLeague = { LI: number; L: string; LR?: string; GC?: number };
type RawGame = {
  I: number;
  S: number;
  O1: string;
  O2: string;
  O1R?: string;
  O2R?: string;
  L?: string;
  LR?: string;
};
type RawChamp = { LI: number; L: string; LR?: string; G?: RawGame[] };

type Context = {
  sport: { key: string; name: { en: string; ru: string } };
  leagueId: number;
  league: { en: string; ru: string };
};

function toEvent(game: RawGame, ctx: Context, host: string, nowMs: number): NormalizedEvent | null {
  if (!game || typeof game.I !== "number" || typeof game.S !== "number" || !game.O1 || !game.O2) {
    return null;
  }
  const startsAt = new Date(game.S * 1000);
  // Only upcoming games belong in the schedule.
  if (startsAt.getTime() <= nowMs) return null;

  const leagueEn = game.L || ctx.league.en;
  return {
    source: "1xbet",
    externalId: String(game.I),
    sportKey: ctx.sport.key,
    sportName: ctx.sport.name,
    leagueName: { en: leagueEn, ru: game.LR || ctx.league.ru || leagueEn },
    home: { en: game.O1.trim(), ru: (game.O1R || game.O1).trim() },
    away: { en: game.O2.trim(), ru: (game.O2R || game.O2).trim() },
    startsAt,
    sourceHost: host,
  };
}

async function fetchLeague(sportId: number, ctx: Context): Promise<NormalizedEvent[]> {
  const { value, domain } = await feedGetWithVariants<RawChamp>("GetChampZip", [
    { champ: ctx.leagueId, sport: sportId, lng: "en", tf: 3000000, afterDays: 0, tz: 0, country: 1 },
    { champ: ctx.leagueId, sport: sportId, lng: "en" },
  ]);
  const nowMs = Date.now();
  return (value.G ?? []).map((game) => toEvent(game, ctx, domain, nowMs)).filter(isPresent);
}

async function fetchSportFeed(sportId: number, ctx: Context): Promise<NormalizedEvent[]> {
  const { value, domain } = await feedGet<RawGame[]>("Get1x2_VZip", {
    sports: sportId,
    count: 50,
    lng: "en",
    mode: 4,
    getEmpty: true,
  });
  const nowMs = Date.now();
  return value
    .map((game) => toEvent({ ...game, L: game.L, LR: game.LR }, ctx, domain, nowMs))
    .filter(isPresent);
}

async function createTasks(): Promise<SourceTask[]> {
  const sportsFeed = await feedGet<RawSport[]>("GetSportsShortZip", SPORTS_PARAMS);
  const sports = sportsFeed.value.filter((sport) => sport.I !== LONG_TERM_SPORT_ID && sport.N);
  const tasks: SourceTask[] = [];

  await mapWithConcurrency(sports, LEAGUE_LOOKUP_CONCURRENCY, async (sport) => {
    const sportInfo = resolveSport(sport.N, sport.R);
    try {
      const { value } = await feedGetWithVariants<RawLeague[]>("GetChampsZip", [
        { sport: sport.I, lng: "en", tf: 1000000, tz: 3, country: 1 },
        { sport: sport.I, lng: "en" },
      ]);
      for (const league of value) {
        if ((league.GC ?? 0) <= 0) continue;
        const ctx: Context = {
          sport: sportInfo,
          leagueId: league.LI,
          league: { en: league.L, ru: league.LR || league.L },
        };
        tasks.push({
          label: `${sport.N} · ${league.L}`,
          run: () => fetchLeague(sport.I, ctx),
        });
      }
    } catch {
      // League list unavailable for this sport: fall back to the sport-wide feed.
      const ctx: Context = {
        sport: sportInfo,
        leagueId: 0,
        league: { en: "Other", ru: "Другое" },
      };
      tasks.push({
        label: `${sport.N} (sport feed)`,
        run: () => fetchSportFeed(sport.I, ctx),
      });
    }
  });

  return tasks;
}

export const onexbetAdapter: SourceAdapter = {
  id: "1xbet",
  concurrency: 10,
  createTasks,
};
