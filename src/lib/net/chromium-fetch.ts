import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  "/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell",
  "/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
];

export function findChromeBinary(): string | null {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

export type ChromiumFetchResult = {
  status: number;
  text: string;
  via: "chromium-cdp";
};

let cdpMutex: Promise<void> = Promise.resolve();

function withCdpLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = cdpMutex;
  let release!: () => void;
  cdpMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(release);
}

async function waitForWsUrl(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const data = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
      }
    } catch {
      // Browser still booting.
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("Timed out waiting for headless Chromium CDP port");
}

class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof msg.id === "number") {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            if (msg.error) entry.reject(new Error(msg.error.message ?? "CDP error"));
            else entry.resolve(msg.result);
          }
        }
      } catch {
        // Ignore malformed CDP message.
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 25_000): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // Ignore close error.
    }
  }
}

/**
 * Evaluates an async JS expression inside real headless Chromium over CDP
 * (optionally navigated to `originUrl` first and routed via `proxyUrl`).
 */
export async function chromiumEvaluate<T>(options: {
  originUrl?: string;
  proxyUrl?: string | null;
  expression: string;
  waitAfterNavigateMs?: number;
  timeoutMs?: number;
}): Promise<T> {
  const binary = findChromeBinary();
  if (!binary) {
    throw new Error("Headless Chromium binary not available in container");
  }

  return withCdpLock(async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "matches-cdp-"));
    const debugPort = 39_100 + Math.floor(Math.random() * 800);

    const args = [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--disable-blink-features=AutomationControlled",
    ];

    let proxyAuth: { username: string; password: string } | null = null;
    if (options.proxyUrl) {
      try {
        const parsed = new URL(options.proxyUrl);
        if (parsed.username || parsed.password) {
          proxyAuth = {
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          };
        }
        const proto = parsed.protocol.replace(/:$/, "");
        args.push(`--proxy-server=${proto}://${parsed.hostname}:${parsed.port}`);
      } catch {
        // Ignore unparseable proxy.
      }
    }

    const proc = spawn(binary, args, { stdio: "ignore" });
    let client: CdpClient | null = null;

    try {
      const wsUrl = await waitForWsUrl(debugPort, 8000);
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), 6000);
        socket.addEventListener("open", () => {
          clearTimeout(timer);
          resolve(socket);
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("WebSocket connect failed"));
        });
      });

      client = new CdpClient(ws);
      const { targetId } = (await client.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
      const { sessionId } = (await client.send("Target.attachToTarget", { targetId, flatten: true })) as {
        sessionId: string;
      };

      await client.send("Page.enable", {}, sessionId);
      if (proxyAuth) {
        await client.send(
          "Network.setExtraHTTPHeaders",
          {
            headers: {
              "Proxy-Authorization": `Basic ${Buffer.from(`${proxyAuth.username}:${proxyAuth.password}`).toString("base64")}`,
            },
          },
          sessionId,
        );
      }

      if (options.originUrl) {
        await client.send("Page.navigate", { url: options.originUrl }, sessionId);
        await new Promise((r) => setTimeout(r, options.waitAfterNavigateMs ?? 1500));
      }

      const evalRes = (await client.send(
        "Runtime.evaluate",
        { expression: options.expression, awaitPromise: true, returnByValue: true },
        sessionId,
        options.timeoutMs ?? 30_000,
      )) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };

      if (evalRes.exceptionDetails) {
        throw new Error(
          evalRes.exceptionDetails.exception?.description ||
            evalRes.exceptionDetails.text ||
            "Chromium evaluation error",
        );
      }

      if (evalRes.result?.value === undefined) {
        throw new Error("Empty Chromium CDP evaluation result");
      }

      return evalRes.result.value as T;
    } finally {
      client?.close();
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process already exited.
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure.
      }
    }
  });
}

/**
 * Executes a page + optional same-origin `fetch()` inside real headless Chromium over CDP.
 * Inherits Chrome's genuine TLS/HTTP2 fingerprint, cookie jar, and JS execution environment.
 */
export async function chromiumFetch(options: {
  url: string;
  originUrl?: string;
  proxyUrl?: string | null;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  timeoutMs?: number;
}): Promise<ChromiumFetchResult> {
  const navTarget = options.originUrl || options.url;
  const evalCode = options.originUrl
    ? `(async () => {
        const res = await fetch(${JSON.stringify(options.url)}, {
          method: ${JSON.stringify(options.method ?? "GET")},
          headers: ${JSON.stringify(options.headers ?? {})},
          ${options.body ? `body: ${JSON.stringify(options.body)},` : ""}
          credentials: "include"
        });
        return JSON.stringify({ status: res.status, text: await res.text() });
      })()`
    : `(async () => {
        return JSON.stringify({
          status: 200,
          text: document.documentElement ? document.documentElement.outerHTML : ""
        });
      })()`;

  const rawVal = await chromiumEvaluate<string>({
    originUrl: navTarget,
    proxyUrl: options.proxyUrl,
    expression: evalCode,
    waitAfterNavigateMs: 2500,
    timeoutMs: options.timeoutMs ?? 25_000,
  });

  const parsed = JSON.parse(rawVal) as { status: number; text: string };
  return { status: parsed.status, text: parsed.text, via: "chromium-cdp" };
}
