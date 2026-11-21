import { extractMatchFormat, pickBestMatchFormat, type MatchFormat } from "./format";
import {
  extractTournamentStage,
  mergeMatchVenueInfo,
  pickBestTournamentStage,
  type MatchVenueInfo,
  type TournamentStage,
} from "./match-details";
import {
  eventAgeGroup,
  INDIVIDUAL_SPORTS,
  normalizeName,
  teamSimilarity,
  type LocalizedText,
  type NormalizedEvent,
  type SourceId,
} from "./model";

/**
 * Merges the same match listed by several bookmakers into one entry.
 *
 * Two events are the same match when they have the same sport, start within TIME_TOLERANCE_MS,
 * and both team names match (in English or Russian). When only one team matches, the pair is a
 * "partial" match: the teams are shown with a warning so the user can check them.
 */

const TIME_TOLERANCE_MS = 10 * 60_000;
const SIDE_THRESHOLD = 0.8;
/** Prefer the earliest primary feed for display: 1xBet first, then Fonbet, Betcity, Marathonbet. */
const SOURCE_PRIORITY: Record<SourceId, number> = {
  "1xbet": 0,
  fonbet: 1,
  betcity: 2,
  marathon: 3,
  vbet: 4,
  unibet: 5,
  netbet: 6,
  bcgame: 7,
  parimatch: 8,
  oddsportal: 9,
  oddspedia: 10,
  bet365: 11,
  bwin: 12,
  totogaming: 13,
  stake: 14,
  pinnacle: 15,
};

export type MatchRelation = "primary" | "full" | "partial";

export type MergedSource = {
  source: SourceId;
  externalId: string;
  home: LocalizedText;
  away: LocalizedText;
  league: LocalizedText;
  relation: MatchRelation;
  sourceHost: string | null;
};

export type MergedEntry = {
  id: string;
  startsAt: Date;
  sportKey: string;
  sportName: LocalizedText;
  leagueName: LocalizedText;
  home: LocalizedText;
  away: LocalizedText;
  matchFormat: MatchFormat | null;
  tournamentStage: TournamentStage | null;
  matchInfo: MatchVenueInfo | null;
  matchType: "single" | "full" | "partial";
  sources: MergedSource[];
};

type Names = { en: string; ru: string };
type Prepared = {
  event: NormalizedEvent;
  homeNorm: Names;
  awayNorm: Names;
  timeMs: number;
  ageGroup: string | null;
};
type Member = { prepared: Prepared; relation: MatchRelation; swapped: boolean };
type Group = { primary: Prepared; members: Member[]; partial: boolean };

function prepare(event: NormalizedEvent): Prepared {
  const norm = (text: LocalizedText): Names => ({
    en: normalizeName(text.en),
    ru: normalizeName(text.ru || text.en),
  });
  return {
    event,
    homeNorm: norm(event.home),
    awayNorm: norm(event.away),
    timeMs: event.startsAt.getTime(),
    ageGroup: eventAgeGroup(event),
  };
}

function sideScore(a: Names, b: Names, individual: boolean): number {
  return Math.max(
    teamSimilarity(a.en, b.en, { individual }),
    teamSimilarity(a.ru, b.ru, { individual }),
  );
}

function relate(primary: Prepared, candidate: Prepared): { relation: "full" | "partial"; swapped: boolean } | null {
  // Different age groups (U18 vs U20) are different competitions, even when the team names match.
  if (primary.ageGroup && candidate.ageGroup && primary.ageGroup !== candidate.ageGroup) return null;
  const individual = INDIVIDUAL_SPORTS.has(primary.event.sportKey);
  const straight = [
    sideScore(primary.homeNorm, candidate.homeNorm, individual),
    sideScore(primary.awayNorm, candidate.awayNorm, individual),
  ];
  // Some feeds list home and away the other way round.
  const crossed = [
    sideScore(primary.homeNorm, candidate.awayNorm, individual),
    sideScore(primary.awayNorm, candidate.homeNorm, individual),
  ];
  const swapped = crossed[0] + crossed[1] > straight[0] + straight[1];
  const [home, away] = swapped ? crossed : straight;

  const homeOk = home >= SIDE_THRESHOLD;
  const awayOk = away >= SIDE_THRESHOLD;
  if (homeOk && awayOk) return { relation: "full", swapped };
  if (homeOk !== awayOk) return { relation: "partial", swapped };
  return null;
}

function toEntry(group: Group): MergedEntry {
  const primary = group.primary.event;
  const sources: MergedSource[] = group.members.map((member) => {
    const event = member.prepared.event;
    return {
      source: event.source,
      externalId: event.externalId,
      home: member.swapped ? event.away : event.home,
      away: member.swapped ? event.home : event.away,
      league: event.leagueName,
      relation: member.relation,
      sourceHost: event.sourceHost,
    };
  });

  const matchType = sources.length === 1 ? "single" : group.partial ? "partial" : "full";

  let matchFormat: MatchFormat | null = null;
  let tournamentStage: TournamentStage | null = null;
  let matchInfo: MatchVenueInfo | null = null;
  for (const member of group.members) {
    const ev = member.prepared.event;
    const candidate =
      ev.matchFormat ??
      extractMatchFormat({
        sportKey: ev.sportKey,
        leagueEn: ev.leagueName.en,
        leagueRu: ev.leagueName.ru,
        homeEn: ev.home.en,
        awayEn: ev.away.en,
      });
    matchFormat = pickBestMatchFormat(matchFormat, candidate);

    const stageCandidate =
      ev.tournamentStage ??
      extractTournamentStage({
        leagueEn: ev.leagueName.en,
        leagueRu: ev.leagueName.ru,
      });
    tournamentStage = pickBestTournamentStage(tournamentStage, stageCandidate);

    matchInfo = mergeMatchVenueInfo(matchInfo, ev.matchInfo);
  }

  return {
    id: `${primary.source}-${primary.externalId}`,
    startsAt: primary.startsAt,
    sportKey: primary.sportKey,
    sportName: primary.sportName,
    leagueName: primary.leagueName,
    home: primary.home,
    away: primary.away,
    matchFormat,
    tournamentStage,
    matchInfo,
    matchType,
    sources,
  };
}

export function mergeEvents(events: NormalizedEvent[]): MergedEntry[] {
  const prepared = events
    .map(prepare)
    .sort(
      (a, b) =>
        a.timeMs - b.timeMs || SOURCE_PRIORITY[a.event.source] - SOURCE_PRIORITY[b.event.source],
    );

  const groupsBySport = new Map<string, Group[]>();

  for (const item of prepared) {
    const groups = groupsBySport.get(item.event.sportKey) ?? [];
    groupsBySport.set(item.event.sportKey, groups);

    let target: { group: Group; relation: MatchRelation; swapped: boolean } | null = null;

    // Groups are ordered by start time, so scan from the newest and stop once they are too old.
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      if (item.timeMs - group.primary.timeMs > TIME_TOLERANCE_MS) break;
      // A bookmaker lists a match once, so never merge two events from the same bookmaker.
      if (group.members.some((member) => member.prepared.event.source === item.event.source)) continue;

      const match = relate(group.primary, item);
      if (!match) continue;

      if (!target || (match.relation === "full" && target.relation === "partial")) {
        target = { group, relation: match.relation, swapped: match.swapped };
        if (match.relation === "full") break;
      }
    }

    if (target) {
      target.group.members.push({ prepared: item, relation: target.relation, swapped: target.swapped });
      if (target.relation === "partial") target.group.partial = true;
    } else {
      groups.push({
        primary: item,
        members: [{ prepared: item, relation: "primary", swapped: false }],
        partial: false,
      });
    }
  }

  const entries: MergedEntry[] = [];
  for (const groups of groupsBySport.values()) {
    for (const group of groups) entries.push(toEntry(group));
  }
  entries.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.sportKey.localeCompare(b.sportKey));
  return entries;
}
