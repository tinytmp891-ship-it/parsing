import { chromiumEvaluate, findChromeBinary } from "@/lib/net/chromium-fetch";
import { hasActiveProxyFor, pickProxy, recordProxyOutcome } from "@/lib/proxy/manager";
import { extractMatchFormat } from "./format";
import { extractMatchVenueInfo, extractTournamentStage } from "./match-details";
import { describeError, isPresent, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * Vbet uses the BetConstruct "Swarm" WebSocket API across multiple regional mirrors
 * (`eu-swarm-ws-re.vbet.com`, `eu-swarm-newm.vbet.am`, `eu-swarm-newm.vbet.com`,
 * `eu-swarm-ws-re.vbet.am`). It opens a session, reads the prematch tree for the
 * next 72 hours in English and Russian, and joins both by game id.
 *
 * If direct Node WebSocket connections fail across all mirrors (or a proxy is configured
 * for `vbet`), it automatically falls back to Chromium's WebSocket stack via CDP.
 */

export const VBET_SWARM_MIRRORS = [
  { wsUrl: "wss://eu-swarm-ws-re.vbet.com/", host: "sport.vbet.com" },
  { wsUrl: "wss://eu-swarm-newm.vbet.am", host: "sport.vbet.am" },
  { wsUrl: "wss://eu-swarm-newm.vbet.com", host: "sport.vbet.com" },
  { wsUrl: "wss://eu-swarm-ws-re.vbet.am/", host: "sport.vbet.am" },
] as const;

const SITE_ID = 0;
const WINDOW_SECONDS = 72 * 3600;
const CONNECT_TIMEOUT_MS = 14_000;
const CALL_TIMEOUT_MS = 45_000;

type SwarmReply = { rid?: string; code?: number; data?: any };

/** Vbet prefixes some national-team names with a seeding digit ("1 Argentina"); other sites do not. */
function cleanTeamName(name: string): string {
  return name.replace(/^\d\s+(?=\D)/, "").trim();
}

export function extractWebSocketError(event: unknown, fallback = "WebSocket connection failed"): string {
  if (!event || typeof event !== "object") return fallback;
  const e = event as {
    message?: unknown;
    reason?: unknown;
    code?: unknown;
    error?: { message?: unknown; cause?: { message?: unknown } };
  };
  const parts = [
    typeof e.error?.cause?.message === "string" ? e.error.cause.message : "",
    typeof e.error?.message === "string" ? e.error.message : "",
    typeof e.message === "string" ? e.message : "",
    typeof e.reason === "string" ? e.reason : "",
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts[0];
  if (typeof e.code === "number") return `WebSocket closed (${e.code})`;
  return fallback;
}

type VbetGame = {
  id: number;
  sport: string;
  region: string;
  competition: string;
  team1: string;
  team2: string;
  startTs: number;
  matchLength: number | null;
  addInfo: string | null;
  round: number | null;
};

type FetchResult = {
  games: VbetGame[];
  host: string;
};

class SwarmSession {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<string, { resolve: (reply: SwarmReply) => void; reject: (error: Error) => void }>();

  static open(wsUrl: string): Promise<SwarmSession> {
    const session = new SwarmSession();
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch (err) {
        reject(new Error(`Vbet socket init failed (${wsUrl}): ${describeError(err)}`));
        return;
      }

      session.socket = socket;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          socket.close();
        } catch {
          // Ignore close error on timeout.
        }
        reject(new Error(`Vbet socket did not open in time (${wsUrl})`));
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(session);
      };

      socket.onerror = (event) => {
        clearTimeout(timer);
        const detail = extractWebSocketError(event, "socket handshake/network error");
        if (!settled) {
          settled = true;
          reject(new Error(`Vbet socket error (${wsUrl}): ${detail}`));
        } else {
          session.failAll(`Vbet socket error (${wsUrl}): ${detail}`);
        }
      };

      socket.onmessage = (event) => session.handle(event.data);

      socket.onclose = (event) => {
        clearTimeout(timer);
        const reason = extractWebSocketError(event, "Vbet socket closed");
        if (!settled) {
          settled = true;
          reject(new Error(`Vbet socket closed before open (${wsUrl}): ${reason}`));
        } else {
          session.failAll(reason);
        }
      };
    });
  }

  private handle(raw: unknown) {
    let reply: SwarmReply;
    try {
      reply = JSON.parse(String(raw)) as SwarmReply;
    } catch {
      return;
    }
    if (!reply.rid) return;
    const waiter = this.pending.get(reply.rid);
    if (!waiter) return;
    this.pending.delete(reply.rid);
    waiter.resolve(reply);
  }

  private failAll(message: string) {
    for (const [rid, waiter] of this.pending) {
      this.pending.delete(rid);
      waiter.reject(new Error(message));
    }
  }

  call(command: string, params: Record<string, unknown>): Promise<SwarmReply> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Vbet socket is not open"));
    }
    const rid = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error(`Vbet ${command} timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(rid, {
        resolve: (reply) => {
          clearTimeout(timer);
          if (reply.code !== 0) reject(new Error(`Vbet ${command} failed with code ${reply.code}`));
          else resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ command, rid, params }));
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // Ignore close error.
    }
  }
}

function extractGamesFromSportTree(sports: Record<string, any> | undefined): VbetGame[] {
  const games: VbetGame[] = [];
  for (const sport of Object.values(sports ?? {})) {
    for (const region of Object.values<any>(sport.region ?? {})) {
      for (const competition of Object.values<any>(region.competition ?? {})) {
        for (const game of Object.values<any>(competition.game ?? {})) {
          // Only prematch single matches: both teams known and not live.
          if (!game.team1_name || !game.team2_name || game.is_live) continue;
          const parsedLength =
            game.match_length != null ? Number.parseInt(String(game.match_length), 10) : Number.NaN;
          const parsedRound = game.round != null ? Number.parseInt(String(game.round), 10) : Number.NaN;
          games.push({
            id: Number(game.id),
            sport: String(sport.name),
            region: String(region.name ?? ""),
            competition: String(competition.name ?? ""),
            team1: cleanTeamName(String(game.team1_name)),
            team2: cleanTeamName(String(game.team2_name)),
            startTs: Number(game.start_ts),
            matchLength: Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null,
            addInfo: typeof game.add_info_name === "string" ? game.add_info_name.trim() || null : null,
            round: Number.isFinite(parsedRound) && parsedRound > 0 ? parsedRound : null,
          });
        }
      }
    }
  }
  return games;
}

async function fetchGamesFromMirror(wsUrl: string, language: "eng" | "rus"): Promise<VbetGame[]> {
  const session = await SwarmSession.open(wsUrl);
  try {
    await session.call("request_session", { site_id: SITE_ID, language, source: 42 });

    const now = Math.floor(Date.now() / 1000);
    const reply = await session.call("get", {
      source: "betting",
      what: {
        sport: ["id", "name"],
        region: ["id", "name"],
        competition: ["id", "name"],
        game: ["id", "team1_name", "team2_name", "start_ts", "is_live", "match_length", "add_info_name", "round"],
      },
      where: { game: { start_ts: { "@gte": now, "@lte": now + WINDOW_SECONDS } } },
    });

    return extractGamesFromSportTree(reply.data?.data?.sport);
  } finally {
    session.close();
  }
}

async function fetchGamesViaChromium(language: "eng" | "rus"): Promise<FetchResult> {
  if (!findChromeBinary()) {
    throw new Error("Headless Chromium not available for Vbet WebSocket fallback");
  }
  const proxy = hasActiveProxyFor("vbet") ? pickProxy("vbet") : null;
  const startedAt = Date.now();
  const mirrorUrls = VBET_SWARM_MIRRORS.map((m) => m.wsUrl);
  const mirrorHosts = VBET_SWARM_MIRRORS.map((m) => m.host);

  const expression = `(async () => {
    const urls = ${JSON.stringify(mirrorUrls)};
    const hosts = ${JSON.stringify(mirrorHosts)};
    const errors = [];
    for (let i = 0; i < urls.length; i++) {
      const wsUrl = urls[i];
      try {
        const sport = await new Promise((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("timeout")); }, 35000);
          ws.onopen = () => {
            ws.send(JSON.stringify({
              command: "request_session",
              rid: "1",
              params: { site_id: ${SITE_ID}, language: ${JSON.stringify(language)}, source: 42 }
            }));
          };
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(String(ev.data));
              if (msg.rid === "1") {
                if (msg.code !== 0) { clearTimeout(timer); ws.close(); return reject(new Error("session code " + msg.code)); }
                const now = Math.floor(Date.now() / 1000);
                ws.send(JSON.stringify({
                  command: "get",
                  rid: "2",
                  params: {
                    source: "betting",
                    what: {
                      sport: ["id", "name"],
                      region: ["id", "name"],
                      competition: ["id", "name"],
                      game: ["id", "team1_name", "team2_name", "start_ts", "is_live", "match_length", "add_info_name", "round"]
                    },
                    where: { game: { start_ts: { "@gte": now, "@lte": now + ${WINDOW_SECONDS} } } }
                  }
                }));
              } else if (msg.rid === "2") {
                clearTimeout(timer);
                ws.close();
                if (msg.code !== 0) return reject(new Error("get code " + msg.code));
                resolve((msg.data && msg.data.data && msg.data.data.sport) || {});
              }
            } catch (err) {
              clearTimeout(timer);
              try { ws.close(); } catch {}
              reject(err);
            }
          };
          ws.onerror = () => { clearTimeout(timer); reject(new Error("browser WebSocket error")); };
          ws.onclose = (ev) => { clearTimeout(timer); reject(new Error("browser WebSocket closed " + ev.code)); };
        });
        return JSON.stringify({ host: hosts[i], sport });
      } catch (e) {
        errors.push(wsUrl + ": " + (e && e.message ? e.message : String(e)));
      }
    }
    throw new Error(errors.join("; "));
  })()`;

  try {
    const raw = await chromiumEvaluate<string>({
      proxyUrl: proxy?.url ?? null,
      expression,
      timeoutMs: 60_000,
    });
    const parsed = JSON.parse(raw) as { host: string; sport: Record<string, any> };
    if (proxy) {
      recordProxyOutcome(proxy.id, { ok: true, latencyMs: Date.now() - startedAt }, "vbet");
    }
    return { games: extractGamesFromSportTree(parsed.sport), host: parsed.host || "sport.vbet.com" };
  } catch (error) {
    if (proxy) {
      recordProxyOutcome(proxy.id, { ok: false, latencyMs: Date.now() - startedAt, error: describeError(error) }, "vbet");
    }
    throw error;
  }
}

async function fetchGames(language: "eng" | "rus", preferredHost?: string): Promise<FetchResult> {
  // If user specifically assigned an active proxy to Vbet, use Chromium CDP + proxy first so proxy routing works for WS.
  if (hasActiveProxyFor("vbet")) {
    try {
      return await fetchGamesViaChromium(language);
    } catch {
      // Fall through to direct WebSocket mirrors if proxy browser fallback fails.
    }
  }

  const ordered = preferredHost
    ? [...VBET_SWARM_MIRRORS].sort((a, b) => (a.host === preferredHost ? -1 : b.host === preferredHost ? 1 : 0))
    : [...VBET_SWARM_MIRRORS];

  const errors: string[] = [];
  for (const mirror of ordered) {
    try {
      const games = await fetchGamesFromMirror(mirror.wsUrl, language);
      return { games, host: mirror.host };
    } catch (error) {
      errors.push(describeError(error));
    }
  }

  // Final fallback: headless Chromium native WebSocket stack across all mirrors.
  try {
    return await fetchGamesViaChromium(language);
  } catch (chromiumError) {
    errors.push(`Chromium fallback: ${describeError(chromiumError)}`);
  }

  throw new Error(errors[0] || "Vbet WebSocket mirrors unreachable");
}

function toEvent(game: VbetGame, ru: VbetGame | undefined, nowMs: number, sourceHost: string): NormalizedEvent | null {
  const startsAt = new Date(game.startTs * 1000);
  if (startsAt.getTime() <= nowMs) return null;

  const sport = resolveSport(game.sport, ru?.sport);
  const leagueEn = [game.region, game.competition].filter(Boolean).join(". ");
  const leagueRu = ru ? [ru.region, ru.competition].filter(Boolean).join(". ") : leagueEn;

  const finalLeagueRu = leagueRu || leagueEn;
  const matchFormat = extractMatchFormat({
    sportKey: sport.key,
    leagueEn,
    leagueRu: finalLeagueRu,
    homeEn: game.team1,
    awayEn: game.team2,
    feedMinutes: game.matchLength,
    feedHints: [game.addInfo],
  });

  const tournamentStage = extractTournamentStage({
    leagueEn,
    leagueRu: finalLeagueRu,
    feedHints: [game.round, game.addInfo],
  });

  const cleanNote = game.addInfo && !tournamentStage && !/^\d+$/.test(game.addInfo) ? game.addInfo : undefined;
  const matchInfo = extractMatchVenueInfo({
    country: game.region,
    note: cleanNote,
  });

  return {
    source: "vbet",
    externalId: String(game.id),
    sportKey: sport.key,
    sportName: sport.name,
    leagueName: { en: leagueEn, ru: finalLeagueRu },
    home: { en: game.team1, ru: ru?.team1 || game.team1 },
    away: { en: game.team2, ru: ru?.team2 || game.team2 },
    startsAt,
    sourceHost,
    matchFormat,
    tournamentStage,
    matchInfo,
  };
}

async function createTasks(): Promise<SourceTask[]> {
  const run = async (): Promise<NormalizedEvent[]> => {
    const english = await fetchGames("eng");
    // Russian names are a bonus: if that session fails, the English names are used.
    const russian = await fetchGames("rus", english.host)
      .then((res) => res.games)
      .catch(() => [] as VbetGame[]);
    const ruById = new Map(russian.map((game) => [game.id, game] as const));
    const nowMs = Date.now();
    return english.games.map((game) => toEvent(game, ruById.get(game.id), nowMs, english.host)).filter(isPresent);
  };

  return [{ label: "Vbet betting schedule", run }];
}

export const vbetAdapter: SourceAdapter = {
  id: "vbet",
  concurrency: 1,
  createTasks,
};
