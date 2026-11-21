import { resilientFetch } from "@/lib/net/resilient-fetch";
import { hasActiveProxyFor } from "@/lib/proxy/manager";
import { describeError, SourceUnavailableError, type SourceAdapter, type SourceTask } from "./model";

/**
 * bet365 (www.bet365.com).
 *
 * Uses `resilientFetch` (Proxy Manager residential/mobile pool -> HTTP/2 curl -> Chromium CDP).
 * Direct datacenter IPs are blocked by Cloudflare (HTTP 403); assign a clean GB/EU residential
 * proxy in Proxy Manager for `bet365` to test/route traffic through a residential exit node.
 */

const BET365_URL = "https://www.bet365.com/";

async function probe(): Promise<never> {
  let res: Awaited<ReturnType<typeof resilientFetch>>;
  try {
    res = await resilientFetch({
      url: BET365_URL,
      sourceId: "bet365",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      allowChromiumFallback: true,
      preferHttp2: true,
      timeoutMs: 20_000,
    });
  } catch (error) {
    throw new Error(`bet365.com is unreachable: ${describeError(error)}`);
  }

  const hint = hasActiveProxyFor("bet365")
    ? "assigned proxy was also blocked"
    : "add a GB/EU residential proxy in Proxy Manager";

  if (res.status === 403 || /attention required|you have been blocked|cloudflare/i.test(res.text)) {
    throw new SourceUnavailableError(`bet365.com blocks this IP (HTTP ${res.status}, Cloudflare; ${hint})`);
  }
  throw new SourceUnavailableError(
    `bet365.com responded HTTP ${res.status} (${res.via}); proprietary binary/WebSocket feed parser requires live session tokens`,
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
