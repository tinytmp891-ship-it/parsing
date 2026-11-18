import { db } from "@/db";
import { syncRuns, upcomingEvents } from "@/db/schema";
import { getFeedHealth } from "@/lib/onexbet/feed";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { bet365Adapter } from "./bet365";
import { bwinAdapter } from "./bwin";
import { pinnacleAdapter } from "./pinnacle";
import { stakeAdapter } from "./stake";
import { fonbetAdapter } from "./fonbet";
import { marathonAdapter } from "./marathon";
import { onexbetAdapter } from "./onexbet";
import { vbetAdapter } from "./vbet";
import {
  describeError,
  mapWithConcurrency,
  SOURCE_IDS,
  SOURCE_LABELS,
  type NormalizedEvent,
  type SourceAdapter,
  type SourceId,
} from "./model";

/** Re-sync a bookmaker at most this often (triggered lazily by incoming requests). */
const FRESH_MS = 5 * 60_000;
/** Keep events that started up to this long ago, then drop them. */
const PAST_RETENTION_MS = 2 * 3600_000;
const INSERT_CHUNK = 500;
/** A bookmaker that cannot be read is not probed again by automatic syncs for this long. */
const UNAVAILABLE_TTL_MS = 30 * 60_000;
/** Hard limit per bookmaker. Work still running after this is stopped and reported as timed out. */
const SOURCE_BUDGET_MS = 180_000;

const ADAPTERS: SourceAdapter[] = [
  onexbetAdapter,
  fonbetAdapter,
  vbetAdapter,
  bet365Adapter,
  marathonAdapter,
  bwinAdapter,
  stakeAdapter,
  pinnacleAdapter,
];

export type SourceState = "idle" | "loading" | "fetching" | "finishing" | "done" | "failed" | "unavailable";

export type SourceProgress = {
  state: SourceState;
  startedAt: number | null;
  tasksTotal: number;
  tasksDone: number;
  tasksFailed: number;
  eventsSaved: number;
  error: string | null;
};

type SyncGlobal = {
  running: Promise<void> | null;
  startedAt: number | null;
  progress: Record<SourceId, SourceProgress>;
  unavailable: Partial<Record<SourceId, { reason: string; until: number }>>;
};

type RunContext = { runId: number | null; aborted: boolean };

const globalForSync = globalThis as typeof globalThis & { __bookmakerSyncV2?: SyncGlobal };

function emptyProgress(): SourceProgress {
  return { state: "idle", startedAt: null, tasksTotal: 0, tasksDone: 0, tasksFailed: 0, eventsSaved: 0, error: null };
}

function createSyncState(): SyncGlobal {
  const progress = {} as Record<SourceId, SourceProgress>;
  for (const id of SOURCE_IDS) progress[id] = emptyProgress();
  return { running: null, startedAt: null, progress, unavailable: {} };
}

const syncState: SyncGlobal = globalForSync.__bookmakerSyncV2 ?? createSyncState();
globalForSync.__bookmakerSyncV2 = syncState;

type UpcomingRow = typeof upcomingEvents.$inferInsert;

function toRow(event: NormalizedEvent, seenAt: Date): UpcomingRow {
  return {
    source: event.source,
    externalId: event.externalId,
    sportKey: event.sportKey,
    sportNameEn: event.sportName.en,
    sportNameRu: event.sportName.ru,
    leagueNameEn: event.leagueName.en,
    leagueNameRu: event.leagueName.ru,
    homeEn: event.home.en,
    awayEn: event.away.en,
    homeRu: event.home.ru || event.home.en,
    awayRu: event.away.ru || event.away.en,
    startsAt: event.startsAt,
    sourceHost: event.sourceHost,
    lastSeenAt: seenAt,
  };
}

async function saveEvents(events: NormalizedEvent[], seenAt: Date): Promise<number> {
  if (events.length === 0) return 0;
  // Postgres rejects duplicate keys inside one upsert, so de-duplicate first.
  const unique = new Map<string, UpcomingRow>();
  for (const event of events) unique.set(`${event.source}:${event.externalId}`, toRow(event, seenAt));
  const rows = [...unique.values()];

  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    await db
      .insert(upcomingEvents)
      .values(rows.slice(index, index + INSERT_CHUNK))
      .onConflictDoUpdate({
        target: [upcomingEvents.source, upcomingEvents.externalId],
        set: {
          sportKey: sql`excluded.sport_key`,
          sportNameEn: sql`excluded.sport_name_en`,
          sportNameRu: sql`excluded.sport_name_ru`,
          leagueNameEn: sql`excluded.league_name_en`,
          leagueNameRu: sql`excluded.league_name_ru`,
          homeEn: sql`excluded.home_en`,
          awayEn: sql`excluded.away_en`,
          homeRu: sql`excluded.home_ru`,
          awayRu: sql`excluded.away_ru`,
          startsAt: sql`excluded.starts_at`,
          sourceHost: sql`excluded.source_host`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }
  return rows.length;
}

function isUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.name === "SourceUnavailableError";
}

async function runSource(adapter: SourceAdapter, ctx: RunContext, startedAt: Date): Promise<void> {
  const progress = syncState.progress[adapter.id];
  const [run] = await db
    .insert(syncRuns)
    .values({ source: adapter.id, status: "running", startedAt })
    .returning({ id: syncRuns.id });
  ctx.runId = run.id;

  let host: string | null = null;
  let firstError: string | null = null;

  try {
    const tasks = await adapter.createTasks();
    if (ctx.aborted) return;

    progress.state = "fetching";
    progress.tasksTotal = tasks.length;

    await mapWithConcurrency(tasks, adapter.concurrency, async (task) => {
      if (ctx.aborted) return;
      try {
        const events = await task.run();
        if (ctx.aborted) return;
        progress.eventsSaved += await saveEvents(events, startedAt);
        if (events[0]?.sourceHost) host = events[0].sourceHost;
      } catch (error) {
        progress.tasksFailed += 1;
        firstError ??= describeError(error);
      } finally {
        progress.tasksDone += 1;
      }
    });
    if (ctx.aborted) return;

    // Housekeeping: drop finished events, and drop events this bookmaker no longer lists
    // (only when every request succeeded, so a partial outage never wipes good data).
    progress.state = "finishing";
    const now = new Date();
    await db
      .delete(upcomingEvents)
      .where(
        and(
          eq(upcomingEvents.source, adapter.id),
          lt(upcomingEvents.startsAt, new Date(now.getTime() - PAST_RETENTION_MS)),
        ),
      );
    if (progress.tasksFailed === 0) {
      await db
        .delete(upcomingEvents)
        .where(
          and(
            eq(upcomingEvents.source, adapter.id),
            lt(upcomingEvents.lastSeenAt, startedAt),
            gt(upcomingEvents.startsAt, now),
          ),
        );
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(upcomingEvents)
      .where(and(eq(upcomingEvents.source, adapter.id), gt(upcomingEvents.startsAt, now)));

    const status = progress.tasksFailed === 0 ? "success" : total > 0 ? "partial" : "failed";
    const sourceDomain = host ?? (adapter.id === "1xbet" ? getFeedHealth().lastGoodDomain : null);

    await db
      .update(syncRuns)
      .set({
        status,
        finishedAt: new Date(),
        sourceDomain,
        tasksTotal: progress.tasksTotal,
        tasksFailed: progress.tasksFailed,
        matchesCount: total,
        error: firstError,
      })
      .where(eq(syncRuns.id, run.id));

    progress.state = status === "failed" ? "failed" : "done";
    progress.error = status === "failed" ? firstError : null;
  } catch (error) {
    if (ctx.aborted) return;
    const message = describeError(error);
    if (isUnavailableError(error)) {
      syncState.unavailable[adapter.id] = { reason: message, until: Date.now() + UNAVAILABLE_TTL_MS };
      progress.state = "unavailable";
    } else {
      progress.state = "failed";
    }
    progress.error = message;
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(syncRuns.id, run.id));
  }
}

/** Runs one bookmaker with a hard time limit, so a slow or hung source can never block the others. */
async function runWithBudget(adapter: SourceAdapter): Promise<void> {
  const progress = syncState.progress[adapter.id];
  const ctx: RunContext = { runId: null, aborted: false };
  const startedAt = new Date();
  Object.assign(progress, {
    state: "loading",
    startedAt: startedAt.getTime(),
    tasksTotal: 0,
    tasksDone: 0,
    tasksFailed: 0,
    eventsSaved: 0,
    error: null,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SOURCE_BUDGET_MS);
  });
  const work = runSource(adapter, ctx, startedAt).then(
    () => "finished" as const,
    (error: unknown) => {
      if (!ctx.aborted) {
        progress.state = "failed";
        progress.error = describeError(error);
      }
      return "finished" as const;
    },
  );

  const outcome = await Promise.race([work, budget]);
  clearTimeout(timer);

  if (outcome === "timeout") {
    ctx.aborted = true;
    progress.state = "failed";
    progress.error = `timed out after ${SOURCE_BUDGET_MS / 1000} s`;
    if (ctx.runId !== null) {
      await db
        .update(syncRuns)
        .set({ status: "failed", finishedAt: new Date(), error: progress.error })
        .where(and(eq(syncRuns.id, ctx.runId), eq(syncRuns.status, "running")));
    }
  }

  if (progress.state === "loading" || progress.state === "fetching" || progress.state === "finishing") {
    progress.state = "failed";
    progress.error ??= "stopped before finishing";
  }
}

async function getLastFinishedRun(source: SourceId) {
  const [row] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.source, source), ne(syncRuns.status, "running")))
    .orderBy(desc(syncRuns.id))
    .limit(1);
  return row ?? null;
}

async function syncOne(adapter: SourceAdapter, force: boolean): Promise<void> {
  const progress = syncState.progress[adapter.id];
  if (force) {
    // A manual refresh re-checks bookmakers that were unavailable.
    delete syncState.unavailable[adapter.id];
  } else {
    const cached = syncState.unavailable[adapter.id];
    if (cached && cached.until > Date.now()) {
      progress.state = "unavailable";
      progress.error = cached.reason;
      return;
    }
    const last = await getLastFinishedRun(adapter.id);
    if (last?.finishedAt && Date.now() - last.finishedAt.getTime() < FRESH_MS) {
      progress.state = "idle";
      return;
    }
  }
  await runWithBudget(adapter);
}

/**
 * Start a background sync over all bookmakers when none is running. All bookmakers run in parallel,
 * each with its own time limit. Bookmakers synced within FRESH_MS are skipped unless `force` is set.
 * Returns immediately; use getSyncStatus() for progress.
 */
export function ensureFreshSync(options: { force?: boolean } = {}): void {
  if (syncState.running) return;

  const force = options.force ?? false;
  syncState.startedAt = Date.now();
  syncState.running = Promise.all(
    ADAPTERS.map((adapter) =>
      syncOne(adapter, force).catch((error: unknown) => {
        const progress = syncState.progress[adapter.id];
        progress.state = "failed";
        progress.error = describeError(error);
      }),
    ),
  )
    .then(() => undefined)
    .finally(() => {
      syncState.running = null;
      syncState.startedAt = null;
    });
}

export async function getSyncStatus() {
  const now = Date.now();
  const sources = await Promise.all(
    SOURCE_IDS.map(async (id) => {
      const lastRun = await getLastFinishedRun(id);
      const progress = syncState.progress[id];
      const cached = syncState.unavailable[id];
      const activeUntil = cached && cached.until > now ? cached.until : null;
      return {
        id,
        label: SOURCE_LABELS[id],
        state: progress.state,
        startedAt: progress.startedAt ? new Date(progress.startedAt).toISOString() : null,
        tasksTotal: progress.tasksTotal,
        tasksDone: progress.tasksDone,
        tasksFailed: progress.tasksFailed,
        eventsSaved: progress.eventsSaved,
        error: progress.state === "unavailable" || progress.state === "failed" ? progress.error : null,
        unavailableUntil: activeUntil ? new Date(activeUntil).toISOString() : null,
        lastRun,
      };
    }),
  );

  return {
    running: syncState.running !== null,
    startedAt: syncState.startedAt ? new Date(syncState.startedAt).toISOString() : null,
    sources,
    feedHealth: getFeedHealth(),
  };
}
