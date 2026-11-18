import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * bwin (www.bwin.com), live betting page.
 *
 * The page itself loads, but its match data comes from the bwin betting API (/cds-api/...).
 * That API answers this server with a Cloudflare "access denied" page (HTTP 403), a firewall block
 * on the server's address. No data can be read from here, so this adapter reports the exact reason.
 * The block is not worked around.
 */

const BWIN_PAGE = "https://www.bwin.com/en/sports/live/betting";
const BWIN_API = "https://www.bwin.com/cds-api/bettingoffer/counts?state=Latest&lang=en&country=GB&userCountry=GB";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function get(url: string, accept: string): Promise<Response> {
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`bwin.com is unreachable: ${describeError(error)}`);
  }
}

async function probe(): Promise<never> {
  const [page, api] = await Promise.all([get(BWIN_PAGE, "text/html"), get(BWIN_API, "application/json")]);
  await Promise.all([page.text().catch(() => ""), api.text().catch(() => "")]);

  if (api.status === 403) {
    throw new SourceUnavailableError(
      "bwin.com blocks its betting data API from this server (HTTP 403, Cloudflare access denied)",
    );
  }
  if (!page.ok) {
    throw new SourceUnavailableError(`bwin.com live page unavailable (HTTP ${page.status})`);
  }
  throw new SourceUnavailableError(
    `bwin.com betting API answered HTTP ${api.status}, but the bwin parser is not implemented yet`,
  );
}

export const bwinAdapter: SourceAdapter = {
  id: "bwin",
  concurrency: 1,
  createTasks: async (): Promise<SourceTask[]> => {
    await probe();
    return [];
  },
};
