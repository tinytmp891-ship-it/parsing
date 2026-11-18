import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * bet365 (www.bet365.com).
 *
 * Status: bet365 blocks this server. Plain HTTP gets a Cloudflare "Attention Required" page (HTTP 403),
 * and a real headless browser gets "Sorry, you have been blocked", so no pre-match data can be read from
 * here. This adapter probes the site and reports the exact reason. The block is not worked around.
 */

const BET365_URL = "https://www.bet365.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function probe(): Promise<never> {
  let response: Response;
  try {
    response = await fetch(BET365_URL, {
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    // Network errors are retried on the next sync; only real blocks are cached as unavailable.
    throw new Error(`bet365.com is unreachable: ${describeError(error)}`);
  }

  const body = await response.text().catch(() => "");
  if (response.status === 403 || /attention required|you have been blocked|cloudflare/i.test(body)) {
    throw new SourceUnavailableError(`bet365.com blocks this server (HTTP ${response.status}, Cloudflare)`);
  }
  throw new SourceUnavailableError(
    "bet365.com is reachable, but the bet365 pre-match feed parser is not implemented yet",
  );
}

export const bet365Adapter: SourceAdapter = {
  id: "bet365",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => {
    await probe();
    return [];
  },
};
