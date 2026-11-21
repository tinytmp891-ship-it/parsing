import { extractMatchFormat } from "./format";
import { extractTournamentStage } from "./match-details";
import { describeError, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * Betcity prematch line (`ad.betcity.ru/d/off/events`, with `d.betcity.by/api/v1/bets/line` fallback).
 * `lng=1` returns English sport/league/team names; omitting `lng` returns Russian names.
 * Both feeds share the exact same numeric `id_sp`, `id_ch`, and `id_ev` keys so EN and RU can be joined 1:1.
 */

const ENDPOINTS = [
  { host: "ad.betcity.ru", path: "/d/off/events?rev=8&ver=470&csn=lsmif5" },
  { host: "d.betcity.by", path: "/api/v1/bets/line?rev=8&ver=470&csn=lsmif5" },
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type BetcityEvent = {
  id_ev?: number;
  date_ev?: number;
  name_ht?: string;
  name_at?: string;
  is_online?: number;
  del_ev?: number;
  fut?: number;
  comment_ev?: string;
};

type BetcityChamp = {
  id_ch?: number;
  name_ch?: string;
  evts?: Record<string, BetcityEvent>;
};

type BetcitySport = {
  id_sp?: number;
  name_sp?: string;
  is_virtual?: number;
  chmps?: Record<string, BetcityChamp>;
};

type BetcityResponse = {
  reply?: {
    sports?: Record<string, BetcitySport>;
  };
};

async function fetchBetcityJson(langParam: string): Promise<{ data: BetcityResponse; host: string }> {
  let lastError: unknown = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const url = `https://${endpoint.host}${endpoint.path}${langParam}`;
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(40_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as BetcityResponse;
      if (!json?.reply?.sports || typeof json.reply.sports !== "object") {
        throw new Error("unexpected payload");
      }
      return { data: json, host: endpoint.host };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Betcity line unavailable: ${describeError(lastError)}`);
}

async function fetchEvents(): Promise<NormalizedEvent[]> {
  const [enRes, ruRes] = await Promise.all([
    fetchBetcityJson("&lng=1"),
    fetchBetcityJson("").catch(() => null),
  ]);

  const sportsEn = enRes.data.reply?.sports ?? {};
  const sportsRu = ruRes?.data.reply?.sports ?? {};
  const nowMs = Date.now();
  const events: NormalizedEvent[] = [];

  for (const [spKey, sportEn] of Object.entries(sportsEn)) {
    if (!sportEn || sportEn.is_virtual === 1 || !sportEn.name_sp || !sportEn.chmps) continue;

    const sportRu = sportsRu[spKey];
    const sport = resolveSport(sportEn.name_sp, sportRu?.name_sp);

    for (const [chKey, champEn] of Object.entries(sportEn.chmps)) {
      if (!champEn || !champEn.name_ch || !champEn.evts) continue;
      const champRu = sportRu?.chmps?.[chKey];

      const leagueEn = champEn.name_ch.trim();
      const leagueRu = champRu?.name_ch?.trim() || leagueEn;

      for (const [evKey, evt] of Object.entries(champEn.evts)) {
        if (!evt || evt.is_online !== 0 || evt.del_ev || evt.fut) continue;
        const homeEn = evt.name_ht?.trim() ?? "";
        const awayEn = evt.name_at?.trim() ?? "";
        if (!homeEn || !awayEn || !evt.date_ev) continue;

        const startsAt = new Date(evt.date_ev * 1000);
        if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

        const evtRu = champRu?.evts?.[evKey];
        const homeRu = evtRu?.name_ht?.trim() || homeEn;
        const awayRu = evtRu?.name_at?.trim() || awayEn;

        events.push({
          source: "betcity",
          externalId: String(evt.id_ev ?? evKey),
          sportKey: sport.key,
          sportName: sport.name,
          leagueName: { en: leagueEn, ru: leagueRu },
          home: { en: homeEn, ru: homeRu },
          away: { en: awayEn, ru: awayRu },
          startsAt,
          sourceHost: enRes.host,
          matchFormat: extractMatchFormat({
            sportKey: sport.key,
            leagueEn,
            leagueRu,
            homeEn,
            awayEn,
            feedHints: [evt.comment_ev],
          }),
          tournamentStage: extractTournamentStage({
            leagueEn,
            leagueRu,
            feedHints: [evt.comment_ev],
          }),
        });
      }
    }
  }

  return events;
}

export const betcityAdapter: SourceAdapter = {
  id: "betcity",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => [{ label: "Betcity prematch line", run: fetchEvents }],
};
