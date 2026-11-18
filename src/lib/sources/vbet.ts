import { isPresent, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * Vbet (sport.vbet.am) uses the BetConstruct "Swarm" WebSocket API.
 * The site opens wss://eu-swarm-newm.vbet.am, starts a session, and reads the game tree
 * (sport -> region -> competition -> game). This adapter reads the next 72 hours in English
 * and in Russian, and joins both by game id.
 */

const SWARM_URL = "wss://eu-swarm-newm.vbet.am";
const SITE_ID = 0;
const WINDOW_SECONDS = 72 * 3600;
const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;

type SwarmReply = { rid?: string; code?: number; data?: any };

/** Vbet prefixes some national-team names with a seeding digit ("1 Argentina"); other sites do not. */
function cleanTeamName(name: string): string {
  return name.replace(/^\d\s+(?=\D)/, "").trim();
}

type VbetGame = {
  id: number;
  sport: string;
  region: string;
  competition: string;
  team1: string;
  team2: string;
  startTs: number;
};

class SwarmSession {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<string, { resolve: (reply: SwarmReply) => void; reject: (error: Error) => void }>();

  static open(): Promise<SwarmSession> {
    const session = new SwarmSession();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(SWARM_URL);
      session.socket = socket;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Vbet socket did not open in time"));
      }, CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve(session);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Vbet socket error"));
      };
      socket.onmessage = (event) => session.handle(event.data);
      socket.onclose = () => session.failAll("Vbet socket closed");
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
    if (!socket) return Promise.reject(new Error("Vbet socket is not open"));
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
    this.socket?.close();
  }
}

async function fetchGames(language: "eng" | "rus"): Promise<VbetGame[]> {
  const session = await SwarmSession.open();
  try {
    await session.call("request_session", { site_id: SITE_ID, language, source: 42 });

    const now = Math.floor(Date.now() / 1000);
    const reply = await session.call("get", {
      source: "betting",
      what: {
        sport: ["id", "name"],
        region: ["id", "name"],
        competition: ["id", "name"],
        game: ["id", "team1_name", "team2_name", "start_ts", "is_live"],
      },
      where: { game: { start_ts: { "@gte": now, "@lte": now + WINDOW_SECONDS } } },
    });

    const sports: Record<string, any> = reply.data?.data?.sport ?? {};
    const games: VbetGame[] = [];
    for (const sport of Object.values(sports)) {
      for (const region of Object.values<any>(sport.region ?? {})) {
        for (const competition of Object.values<any>(region.competition ?? {})) {
          for (const game of Object.values<any>(competition.game ?? {})) {
            // Only prematch single matches: both teams known and not live.
            if (!game.team1_name || !game.team2_name || game.is_live) continue;
            games.push({
              id: Number(game.id),
              sport: String(sport.name),
              region: String(region.name ?? ""),
              competition: String(competition.name ?? ""),
              team1: cleanTeamName(String(game.team1_name)),
              team2: cleanTeamName(String(game.team2_name)),
              startTs: Number(game.start_ts),
            });
          }
        }
      }
    }
    return games;
  } finally {
    session.close();
  }
}

function toEvent(game: VbetGame, ru: VbetGame | undefined, nowMs: number): NormalizedEvent | null {
  const startsAt = new Date(game.startTs * 1000);
  if (startsAt.getTime() <= nowMs) return null;

  const sport = resolveSport(game.sport, ru?.sport);
  const leagueEn = [game.region, game.competition].filter(Boolean).join(". ");
  const leagueRu = ru ? [ru.region, ru.competition].filter(Boolean).join(". ") : leagueEn;

  return {
    source: "vbet",
    externalId: String(game.id),
    sportKey: sport.key,
    sportName: sport.name,
    leagueName: { en: leagueEn, ru: leagueRu || leagueEn },
    home: { en: game.team1, ru: ru?.team1 || game.team1 },
    away: { en: game.team2, ru: ru?.team2 || game.team2 },
    startsAt,
    sourceHost: "sport.vbet.am",
  };
}

async function createTasks(): Promise<SourceTask[]> {
  const run = async (): Promise<NormalizedEvent[]> => {
    const english = await fetchGames("eng");
    // Russian names are a bonus: if that session fails, the English names are used.
    const russian = await fetchGames("rus").catch(() => [] as VbetGame[]);
    const ruById = new Map(russian.map((game) => [game.id, game] as const));
    const nowMs = Date.now();
    return english.map((game) => toEvent(game, ruById.get(game.id), nowMs)).filter(isPresent);
  };

  return [{ label: "Vbet betting schedule", run }];
}

export const vbetAdapter: SourceAdapter = {
  id: "vbet",
  concurrency: 1,
  createTasks,
};
