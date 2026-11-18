import { ensureFreshSync, getSyncStatus } from "@/lib/sources/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getSyncStatus(), { headers: { "Cache-Control": "no-store" } });
}

/** Manually trigger a re-sync of every bookmaker (no-op if one is already running). */
export async function POST() {
  ensureFreshSync({ force: true });
  return Response.json(await getSyncStatus(), { headers: { "Cache-Control": "no-store" } });
}
