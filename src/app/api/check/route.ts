import { loadEvents } from "@/lib/sources/query";
import { checkLines, CHECK_WINDOW_MS, MAX_CHECK_LINES, type CheckStatus } from "@/lib/sources/check";
import { ensureFreshSync } from "@/lib/sources/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return Response.json({ error: "Paste at least one match line." }, { status: 400 });
  }
  if (lines.length > MAX_CHECK_LINES) {
    return Response.json({ error: `Check at most ${MAX_CHECK_LINES} lines at a time.` }, { status: 400 });
  }

  // Keep the schedule fresh in the background; the check uses what is stored now.
  ensureFreshSync();

  // Only matches that start within the next 24 hours are candidates.
  const now = Date.now();
  const events = await loadEvents(new Date(now), new Date(now + CHECK_WINDOW_MS));
  const results = checkLines(lines, events);

  const summary: Record<CheckStatus, number> = { green: 0, yellow: 0, red: 0, invalid: 0 };
  for (const result of results) summary[result.status] += 1;

  return Response.json(
    { results, summary, scheduleSize: events.length, windowHours: CHECK_WINDOW_MS / 3600_000 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
