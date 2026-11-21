import { db } from "@/db";
import { memGetCoverageUntil, memLoadEvents, memLoadUpcomingEvents } from "@/db/memory";
import { upcomingEvents } from "@/db/schema";
import { and, asc, gt, gte, lte, max } from "drizzle-orm";
import { extractMatchFormat, parseStoredMatchFormat } from "./format";
import {
  extractTournamentStage,
  parseStoredMatchVenueInfo,
  parseStoredTournamentStage,
} from "./match-details";
import { type NormalizedEvent, type SourceId } from "./model";

type UpcomingRow = typeof upcomingEvents.$inferSelect;

function toEvent(row: UpcomingRow): NormalizedEvent {
  const matchFormat =
    parseStoredMatchFormat(row.matchFormat) ??
    extractMatchFormat({
      sportKey: row.sportKey,
      leagueEn: row.leagueNameEn,
      leagueRu: row.leagueNameRu,
      homeEn: row.homeEn,
      awayEn: row.awayEn,
    });
  const tournamentStage =
    parseStoredTournamentStage(row.tournamentStage) ??
    extractTournamentStage({
      leagueEn: row.leagueNameEn,
      leagueRu: row.leagueNameRu,
    });
  const matchInfo = parseStoredMatchVenueInfo(row.matchInfo);
  return {
    source: row.source as SourceId,
    externalId: row.externalId,
    sportKey: row.sportKey,
    sportName: { en: row.sportNameEn, ru: row.sportNameRu },
    leagueName: { en: row.leagueNameEn, ru: row.leagueNameRu },
    home: { en: row.homeEn, ru: row.homeRu },
    away: { en: row.awayEn, ru: row.awayRu },
    startsAt: row.startsAt,
    sourceHost: row.sourceHost,
    matchFormat,
    tournamentStage,
    matchInfo,
  };
}

/** All stored upcoming events that start inside the range, across every bookmaker. */
export async function loadEvents(from: Date, to: Date): Promise<NormalizedEvent[]> {
  if (!db) {
    return memLoadEvents(from, to).map(toEvent);
  }
  const rows = await db
    .select()
    .from(upcomingEvents)
    .where(and(gte(upcomingEvents.startsAt, from), lte(upcomingEvents.startsAt, to)))
    .orderBy(asc(upcomingEvents.startsAt));
  return rows.map(toEvent);
}

/** Every stored event that has not started yet (used by the match checker). */
export async function loadUpcomingEvents(): Promise<NormalizedEvent[]> {
  if (!db) {
    return memLoadUpcomingEvents().map(toEvent);
  }
  const rows = await db
    .select()
    .from(upcomingEvents)
    .where(gt(upcomingEvents.startsAt, new Date()))
    .orderBy(asc(upcomingEvents.startsAt));
  return rows.map(toEvent);
}

/** Latest upcoming start time currently stored (how far the schedule goes). */
export async function getCoverageUntil(): Promise<string | null> {
  if (!db) {
    return memGetCoverageUntil();
  }
  const [row] = await db
    .select({ latest: max(upcomingEvents.startsAt) })
    .from(upcomingEvents)
    .where(gt(upcomingEvents.startsAt, new Date()));
  return row?.latest ? row.latest.toISOString() : null;
}
