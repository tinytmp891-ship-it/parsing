import { syncRuns, upcomingEvents } from "./schema";

type UpcomingRow = typeof upcomingEvents.$inferSelect;
type UpcomingInsert = typeof upcomingEvents.$inferInsert;
type SyncRunRow = typeof syncRuns.$inferSelect;

type MemoryStore = {
  events: Map<string, UpcomingRow>;
  syncRuns: SyncRunRow[];
  nextEventId: number;
  nextRunId: number;
};

const globalForMemory = globalThis as typeof globalThis & {
  __arenaMemoryDb?: MemoryStore;
};

function getStore(): MemoryStore {
  if (!globalForMemory.__arenaMemoryDb) {
    globalForMemory.__arenaMemoryDb = {
      events: new Map(),
      syncRuns: [],
      nextEventId: 1,
      nextRunId: 1,
    };
  }
  return globalForMemory.__arenaMemoryDb;
}

export function memLoadEvents(from: Date, to: Date): UpcomingRow[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const rows: UpcomingRow[] = [];
  for (const row of getStore().events.values()) {
    const t = row.startsAt.getTime();
    if (t >= fromMs && t <= toMs) rows.push(row);
  }
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function memLoadUpcomingEvents(now: Date = new Date()): UpcomingRow[] {
  const nowMs = now.getTime();
  const rows: UpcomingRow[] = [];
  for (const row of getStore().events.values()) {
    if (row.startsAt.getTime() > nowMs) rows.push(row);
  }
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function memGetCoverageUntil(now: Date = new Date()): string | null {
  const nowMs = now.getTime();
  let latestMs: number | null = null;
  for (const row of getStore().events.values()) {
    const t = row.startsAt.getTime();
    if (t > nowMs && (latestMs === null || t > latestMs)) {
      latestMs = t;
    }
  }
  return latestMs !== null ? new Date(latestMs).toISOString() : null;
}

export function memUpsertEvents(rows: UpcomingInsert[]): void {
  const store = getStore();
  for (const row of rows) {
    const key = `${row.source}:${row.externalId}`;
    const existing = store.events.get(key);
    store.events.set(key, {
      id: existing?.id ?? store.nextEventId++,
      source: row.source,
      externalId: row.externalId,
      sportKey: row.sportKey,
      sportNameEn: row.sportNameEn,
      sportNameRu: row.sportNameRu,
      leagueNameEn: row.leagueNameEn,
      leagueNameRu: row.leagueNameRu,
      homeEn: row.homeEn,
      awayEn: row.awayEn,
      homeRu: row.homeRu,
      awayRu: row.awayRu,
      startsAt: row.startsAt,
      sourceHost: row.sourceHost ?? null,
      lastSeenAt: row.lastSeenAt ?? new Date(),
    });
  }
}

export function memCreateSyncRun(source: string, startedAt: Date): { id: number } {
  const store = getStore();
  const id = store.nextRunId++;
  store.syncRuns.push({
    id,
    source,
    startedAt,
    finishedAt: null,
    status: "running",
    sourceDomain: null,
    sportsCount: 0,
    tasksTotal: 0,
    tasksFailed: 0,
    matchesCount: 0,
    error: null,
  });
  return { id };
}

export function memDeletePastEvents(source: string, cutoff: Date): void {
  const cutoffMs = cutoff.getTime();
  const events = getStore().events;
  for (const [key, row] of events) {
    if (row.source === source && row.startsAt.getTime() < cutoffMs) {
      events.delete(key);
    }
  }
}

export function memDeleteStaleUpcomingEvents(source: string, startedAt: Date, now: Date): void {
  const startedMs = startedAt.getTime();
  const nowMs = now.getTime();
  const events = getStore().events;
  for (const [key, row] of events) {
    if (row.source === source && row.lastSeenAt.getTime() < startedMs && row.startsAt.getTime() > nowMs) {
      events.delete(key);
    }
  }
}

export function memCountUpcomingEvents(source: string, now: Date): number {
  const nowMs = now.getTime();
  let count = 0;
  for (const row of getStore().events.values()) {
    if (row.source === source && row.startsAt.getTime() > nowMs) {
      count += 1;
    }
  }
  return count;
}

export function memUpdateSyncRun(id: number, patch: Partial<SyncRunRow>, onlyIfRunning = false): void {
  const run = getStore().syncRuns.find((item) => item.id === id);
  if (!run) return;
  if (onlyIfRunning && run.status !== "running") return;
  Object.assign(run, patch);
}

export function memGetLastFinishedRun(source: string): SyncRunRow | null {
  const runs = getStore().syncRuns;
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run.source === source && run.status !== "running") {
      return run;
    }
  }
  return null;
}
