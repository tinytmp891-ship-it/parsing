import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Upcoming (prematch) events collected from every bookmaker feed.
 * Rows are unique per bookmaker + bookmaker event id, so re-syncing updates rows instead of duplicating them.
 * Names are stored in English and Russian so the UI can switch language without refetching.
 */
export const upcomingEvents = pgTable(
  "upcoming_events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(), // 1xbet | fonbet | bet365
    externalId: text("external_id").notNull(),
    sportKey: text("sport_key").notNull(),
    sportNameEn: text("sport_name_en").notNull(),
    sportNameRu: text("sport_name_ru").notNull(),
    leagueNameEn: text("league_name_en").notNull(),
    leagueNameRu: text("league_name_ru").notNull(),
    homeEn: text("home_en").notNull(),
    awayEn: text("away_en").notNull(),
    homeRu: text("home_ru").notNull(),
    awayRu: text("away_ru").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    sourceHost: text("source_host"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("upcoming_events_source_external_idx").on(table.source, table.externalId),
    index("upcoming_events_starts_at_idx").on(table.startsAt),
    index("upcoming_events_sport_key_idx").on(table.sportKey),
  ],
);

/**
 * One row per bookmaker sync attempt (status, timing, and the host that served the data).
 */
export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("1xbet"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(), // running | success | partial | failed
  sourceDomain: text("source_domain"),
  sportsCount: integer("sports_count").notNull().default(0),
  tasksTotal: integer("tasks_total").notNull().default(0),
  tasksFailed: integer("tasks_failed").notNull().default(0),
  matchesCount: integer("matches_count").notNull().default(0),
  error: text("error"),
});
