import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * Marathonbet, main site and the "old" live domain.
 *
 * Status: both domains answer this server with HTTP 451 ("unavailable for legal reasons"), a
 * jurisdiction restriction on the server's location. No pre-match data can be read from here.
 * The restriction is respected: this adapter reports it rather than routing around it through a mirror.
 */

const TARGETS = [
  { name: "www.marathonbet.com", url: "https://www.marathonbet.com/en/" },
  { name: "old.marathonbet.com", url: "https://old.marathonbet.com/su/live/popular" },
];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type ProbeResult = { name: string; status: number | null; error: string | null };

async function probeTarget(target: { name: string; url: string }): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(target.url, {
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { name: target.name, status: null, error: describeError(error) };
  }
  await response.text().catch(() => "");
  return { name: target.name, status: response.status, error: null };
}

async function probe(): Promise<never> {
  const results = await Promise.all(TARGETS.map(probeTarget));
  const details = results
    .map((result) => (result.status !== null ? `${result.name} HTTP ${result.status}` : `${result.name} unreachable`))
    .join(", ");

  if (results.every((result) => result.status === null)) {
    throw new Error(`Marathonbet is unreachable (${details})`);
  }
  if (results.every((result) => result.status === 451)) {
    throw new SourceUnavailableError(`Marathonbet is unavailable for legal reasons from this server (${details})`);
  }
  throw new SourceUnavailableError(`Marathonbet cannot be read from this server (${details})`);
}

export const marathonAdapter: SourceAdapter = {
  id: "marathon",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => {
    await probe();
    return [];
  },
};
