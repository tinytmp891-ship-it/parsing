import { resilientFetch } from "@/lib/net/resilient-fetch";
import { hasActiveProxyFor } from "@/lib/proxy/manager";
import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * Parimatch (`parimatch.com`, `parimatch.kz`, `pm.by`).
 *
 * Uses `resilientFetch` so any regional residential proxy (KZ / BY / CY / GB) configured in
 * Proxy Manager routes through cleanly with rotating headers, cookie jar, and HTTP/2 TLS.
 */

const TARGETS = [
  { name: "parimatch.com", url: "https://parimatch.com/" },
  { name: "parimatch.kz", url: "https://parimatch.kz/" },
  { name: "pm.by", url: "https://pm.by/" },
];

async function probe(): Promise<never> {
  const results = await Promise.all(
    TARGETS.map(async (target) => {
      try {
        const res = await resilientFetch({
          url: target.url,
          sourceId: "parimatch",
          headers: { Accept: "text/html" },
          preferHttp2: true,
          timeoutMs: 12_000,
        });
        return { name: target.name, status: res.status, error: null as string | null };
      } catch (err) {
        return { name: target.name, status: null as number | null, error: describeError(err) };
      }
    }),
  );

  const summary = results
    .map((r) => (r.status !== null ? `${r.name} HTTP ${r.status}` : `${r.name} unreachable`))
    .join(", ");

  if (results.every((r) => r.status === null)) {
    throw new Error(`Parimatch is unreachable (${summary})`);
  }

  const hint = hasActiveProxyFor("parimatch")
    ? "assigned proxy still blocked/SockJS-gated"
    : "assign a regional residential proxy in Proxy Manager";

  throw new SourceUnavailableError(
    `Parimatch has no reachable REST fixtures feed (${summary}; streams via SockJS — ${hint})`,
  );
}

export const parimatchAdapter: SourceAdapter = {
  id: "parimatch",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => {
    await probe();
    return [];
  },
};
