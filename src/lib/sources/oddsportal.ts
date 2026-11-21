import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { sourceFetch } from "@/lib/net/resilient-fetch";
import { extractMatchFormat } from "./format";
import { extractMatchVenueInfo, extractTournamentStage } from "./match-details";
import { resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * OddsPortal (www.oddsportal.com) upcoming matches across multiple sports.
 * Uses OddsPortal's `/proxy/ajax-nextgames/{sportId}/0/2/{YYYYMMDD}.dat?page={page}&hideFinished=1`
 * endpoint and decrypts its AES-256-CBC + PBKDF2 + gzip response envelope.
 */

const BASE_URL = "https://www.oddsportal.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

// Client-side bundle key parameters (`module 402339`).
const OP_KEY = pbkdf2Sync(
  Buffer.from("Sio4c1EhcCQ3YURfZlIyeVdAZ0huKjNiVnAjc0FkTGRfaw==", "base64").toString("utf8"),
  Buffer.from("NWI5YThmMmMzZTZkMWE0YjdjOGU5ZDBmMWEyYjNjNGQ=", "base64").toString("utf8"),
  1000,
  32,
  "sha256",
);

const SPORTS: { id: number; name: string }[] = [
  { id: 1, name: "Football" },
  { id: 2, name: "Tennis" },
  { id: 3, name: "Basketball" },
  { id: 4, name: "Hockey" },
  { id: 5, name: "American Football" },
  { id: 6, name: "Baseball" },
  { id: 7, name: "Handball" },
  { id: 8, name: "Rugby Union" },
  { id: 9, name: "Floorball" },
  { id: 12, name: "Volleyball" },
  { id: 13, name: "Cricket" },
  { id: 14, name: "Darts" },
  { id: 22, name: "Water Polo" },
  { id: 36, name: "Esports" },
];

const MAX_PAGES_PER_DATE = 3;
const REQUEST_GAP_MS = 450;

export type OddsPortalRow = {
  id?: number | string;
  "home-name"?: string;
  "away-name"?: string;
  "event-stage-id"?: number;
  "date-start-timestamp"?: number;
  "country-name"?: string;
  "tournament-name"?: string;
  "sport-url-name"?: string;
  breadcrumbs?: {
    sport?: { name?: string };
    country?: { name?: string };
    tournament?: { name?: string };
  };
};

export type OddsPortalResponse = {
  d?: {
    total?: number;
    hasMore?: boolean;
    rows?: OddsPortalRow[];
  };
};

export function decryptOddsPortalPayload(rawText: string): OddsPortalResponse {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error("Empty OddsPortal payload");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as OddsPortalResponse;
  }

  const outer = Buffer.from(trimmed, "base64").toString("latin1");
  const colon = outer.lastIndexOf(":");
  if (colon <= 0) throw new Error("Unexpected OddsPortal envelope");

  const ivHex = outer.slice(colon + 1);
  if (!/^[0-9a-fA-F]{32}$/.test(ivHex)) throw new Error("Invalid OddsPortal IV");

  const ciphertext = Buffer.from(outer.slice(0, colon), "base64");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", OP_KEY, iv);
  let decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  for (let i = 0; i < 3 && decrypted.length >= 2 && decrypted[0] === 0x1f && decrypted[1] === 0x8b; i += 1) {
    decrypted = gunzipSync(decrypted);
  }
  return JSON.parse(decrypted.toString("utf8")) as OddsPortalResponse;
}

export function mapOddsPortalRows(
  rows: OddsPortalRow[],
  sportFallback: string,
  nowMs = Date.now(),
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];

  for (const row of rows) {
    // Stage 1 = Scheduled (prematch); skip live, postponed, or finished matches.
    if (row["event-stage-id"] !== 1 || row.id == null) continue;
    const home = row["home-name"]?.trim() ?? "";
    const away = row["away-name"]?.trim() ?? "";
    const ts = row["date-start-timestamp"];
    if (!home || !away || !ts) continue;

    const startsAt = new Date(ts * 1000);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    const sportRaw = row.breadcrumbs?.sport?.name?.trim() || row["sport-url-name"]?.trim() || sportFallback;
    const sport = resolveSport(sportRaw);

    const country = row["country-name"]?.trim() || row.breadcrumbs?.country?.name?.trim();
    const tournament = row["tournament-name"]?.trim() || row.breadcrumbs?.tournament?.name?.trim();
    const league = [country, tournament].filter(Boolean).join(". ") || sport.name.en;

    events.push({
      source: "oddsportal",
      externalId: String(row.id),
      sportKey: sport.key,
      sportName: sport.name,
      leagueName: { en: league, ru: league },
      home: { en: home, ru: home },
      away: { en: away, ru: away },
      startsAt,
      sourceHost: "www.oddsportal.com",
      matchFormat: extractMatchFormat({
        sportKey: sport.key,
        leagueEn: league,
        homeEn: home,
        awayEn: away,
      }),
      tournamentStage: extractTournamentStage({ leagueEn: league }),
      matchInfo: extractMatchVenueInfo({ country }),
    });
  }

  return events;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOddsPortalPage(sportId: number, dateStr: string, page: number): Promise<OddsPortalResponse | null> {
  const url = `${BASE_URL}/proxy/ajax-nextgames/${sportId}/0/2/${dateStr}.dat?page=${page}&hideFinished=1`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await sourceFetch("oddsportal", url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: `${BASE_URL}/matches/`,
        Accept: "text/plain, */*",
      },
      timeoutMs: 20_000,
    });

    if (response.status === 429) {
      await response.text().catch(() => "");
      if (attempt === 0) {
        await sleep(2200);
        continue;
      }
      return null;
    }

    if (!response.ok) {
      throw new Error(`OddsPortal HTTP ${response.status}`);
    }

    const raw = await response.text();
    if (!raw || raw.startsWith("<")) return null;
    return decryptOddsPortalPayload(raw);
  }
  return null;
}

function utcDateStrings(): string[] {
  const now = new Date();
  return [0, 1].map((offsetDays) => {
    const d = new Date(now.getTime() + offsetDays * 24 * 3600_000);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  });
}

async function createTasks(): Promise<SourceTask[]> {
  const dates = utcDateStrings();
  const tasks: SourceTask[] = [];

  for (const dateStr of dates) {
    for (const sport of SPORTS) {
      tasks.push({
        label: `OddsPortal · ${sport.name} · ${dateStr}`,
        run: async () => {
          const collected: NormalizedEvent[] = [];
          for (let page = 1; page <= MAX_PAGES_PER_DATE; page += 1) {
            await sleep(REQUEST_GAP_MS);
            const payload = await fetchOddsPortalPage(sport.id, dateStr, page);
            const rows = payload?.d?.rows ?? [];
            if (rows.length === 0) break;
            collected.push(...mapOddsPortalRows(rows, sport.name));
            if (!payload?.d?.hasMore) break;
          }
          return collected;
        },
      });
    }
  }

  return tasks;
}

export const oddsportalAdapter: SourceAdapter = {
  id: "oddsportal",
  concurrency: 1,
  createTasks,
};
