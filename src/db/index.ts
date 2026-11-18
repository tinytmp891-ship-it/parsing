import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

let pool: Pool | null = null;
let db: NodePgDatabase | null = null;

if (databaseUrl) {
  try {
    pool =
      globalForDb.__arenaNextJsPostgresqlPool ??
      new Pool({
        connectionString: databaseUrl,
      });
    db = globalForDb.__arenaNextJsPostgresqlDb ?? drizzle(pool);

    if (process.env.NODE_ENV !== "production") {
      globalForDb.__arenaNextJsPostgresqlPool = pool;
      globalForDb.__arenaNextJsPostgresqlDb = db;
    }
  } catch (error) {
    console.warn("[AI Studio] Database not connected — using in-memory store", error);
    pool = null;
    db = null;
  }
} else {
  console.warn("[AI Studio] DATABASE_URL is not set — using in-memory store");
}

export { pool, db };
