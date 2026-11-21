import { resilientFetch } from "@/lib/net/resilient-fetch";
import { hasActiveProxyFor } from "@/lib/proxy/manager";
import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * TotoGaming (sport.totogaming.am / totogaming.com / sport.totogaming.ro).
 *
 * Uses `resilientFetch` (Proxy Manager geo-targeted residential/mobile pool -> HTTP/2 curl -> Chromium).
 * Direct server requests receive HTTP 451 / `/restrictedregion` or Akamai 403; routing through an
 * Armenian (AM) or Romanian (RO) proxy in Proxy Manager unlocks access cleanly.
 */

const TARGETS = [
  { name: "sport.totogaming.am", url: "https://sport.totogaming.am/SportsBook/Home" },
  { name: "www.totogaming.com", url: "https://www.totogaming.com/en/sport" },
  { name: "sport.totogaming.ro", url: "https://sport.totogaming.ro/SportsBook/Home" },
];

type ProbeResult = { name: string; status: number | null; body: string; error: string | null };

async function probeTarget(target: { name: string; url: string }): Promise<ProbeResult> {
  try {
    const res = await resilientFetch({
      url: target.url,
      sourceId: "totogaming",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      preferHttp2: true,
      timeoutMs: 15_000,
    });
    return { name: target.name, status: res.status, body: res.text, error: null };
  } catch (error) {
    return { name: target.name, status: null, body: "", error: describeError(error) };
  }
}

async function probe(): Promise<never> {
  const results = await Promise.all(TARGETS.map(probeTarget));
  const details = results
    .map((r) => (r.status !== null ? `${r.name} HTTP ${r.status}` : `${r.name} unreachable`))
    .join(", ");

  if (results.every((r) => r.status === null)) {
    throw new Error(`TotoGaming is unreachable (${details})`);
  }

  const has451 = results.some((r) => r.status === 451 || /not available in your region|restrictedregion/i.test(r.body));
  const has403 = results.some((r) => r.status === 403 || /access denied/i.test(r.body));
  const hint = hasActiveProxyFor("totogaming")
    ? "assigned proxy was also geo/WAF blocked (use AM/RO residential IP)"
    : "assign an AM or RO residential proxy in Proxy Manager";

  if (has451 && has403) {
    throw new SourceUnavailableError(`TotoGaming region/WAF blocked (${details}; ${hint})`);
  }
  if (has451) {
    throw new SourceUnavailableError(`TotoGaming geo-restricted (${details}; ${hint})`);
  }
  if (has403) {
    throw new SourceUnavailableError(`TotoGaming WAF blocked (${details}; ${hint})`);
  }
  throw new SourceUnavailableError(`TotoGaming reachable (${details}), Digitain feed parser awaits unblocked session`);
}

export const totogamingAdapter: SourceAdapter = {
  id: "totogaming",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => {
    await probe();
    return [];
  },
};
