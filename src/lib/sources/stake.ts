import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * Stake (stake.com), sports section.
 *
 * Status: stake.com answers this server with a Cloudflare managed challenge (HTTP 403 with the
 * "cf-mitigated: challenge" header). The challenge is not solved or bypassed, so this adapter reports the
 * block with its exact reason. The Stake parser is only written once a reachable feed exists.
 */

const STAKE_URL = "https://stake.com/sports/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function probe(): Promise<never> {
  let response: Response;
  try {
    response = await fetch(STAKE_URL, {
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`stake.com is unreachable: ${describeError(error)}`);
  }

  const challenged = response.headers.get("cf-mitigated") === "challenge";
  await response.text().catch(() => "");

  if (challenged || response.status === 403) {
    throw new SourceUnavailableError(`stake.com shows a Cloudflare challenge to this server (HTTP ${response.status})`);
  }
  throw new SourceUnavailableError("stake.com is reachable, but the Stake parser is not implemented yet");
}

export const stakeAdapter: SourceAdapter = {
  id: "stake",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => {
    await probe();
    return [];
  },
};
