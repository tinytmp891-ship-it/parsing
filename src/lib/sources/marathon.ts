import { chromiumFetch, findChromeBinary } from "@/lib/net/chromium-fetch";
import { sourceFetch } from "@/lib/net/resilient-fetch";
import { extractMatchFormat } from "./format";
import { extractTournamentStage } from "./match-details";
import { describeError, resolveSport, type NormalizedEvent, type SourceAdapter, type SourceTask } from "./model";

/**
 * Marathonbet prematch adapter with automatic multi-mirror failover:
 * 1. Classic HTML mirrors (`www.marathonbet.ru`, then `www.marathonbet.by`) — serves
 *    English (`/en/betting/...`) for UTC kickoff times + English names/leagues and
 *    Russian (`/su/betting/...`) for Russian team names joined by `data-event-eventId`.
 * 2. Modern SSR site (`https://new.marathonbet.ru/su/`) — extracts upcoming matches
 *    directly from `/su/betting/<sportSlug>` and category championship pages, including
 *    ISO-8601 UTC `dateTime` attributes and tournament groupings.
 * 3. Mobile web fallback (`https://mobile.marathonbet.ru/su/`) — checked directly and
 *    rendered via headless Chromium when needed.
 */

export const CLASSIC_MARATHON_HOSTS = ["www.marathonbet.ru", "www.marathonbet.by"] as const;
export const NEW_MARATHON_HOST = "new.marathonbet.ru";
export const MOBILE_MARATHON_HOST = "mobile.marathonbet.ru";

const MAX_PAGES_PER_SPORT = 4;
const MAX_NEW_CHAMPS_PER_SPORT = 14;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type MarathonSport = { slug: string; newSlug: string; en: string; ru: string };

const SPORT_PAGES: MarathonSport[] = [
  { slug: "Football+-+11", newSlug: "football", en: "Football", ru: "Футбол" },
  { slug: "Ice+Hockey+-+537", newSlug: "ice-hockey", en: "Ice Hockey", ru: "Хоккей" },
  { slug: "Tennis+-+2398", newSlug: "tennis", en: "Tennis", ru: "Теннис" },
  { slug: "Basketball+-+6", newSlug: "basketball", en: "Basketball", ru: "Баскетбол" },
  { slug: "Volleyball+-+22712", newSlug: "volleyball", en: "Volleyball", ru: "Волейбол" },
  { slug: "e-Sports+-+1895085", newSlug: "esports", en: "Esports", ru: "Киберспорт" },
  { slug: "Table+Tennis+-+382549", newSlug: "table-tennis", en: "Table Tennis", ru: "Настольный теннис" },
  { slug: "Handball+-+52914", newSlug: "handball", en: "Handball", ru: "Гандбол" },
  { slug: "Futsal+-+444782", newSlug: "futsal", en: "Futsal", ru: "Футзал" },
  { slug: "Baseball+-+5", newSlug: "baseball", en: "Baseball", ru: "Бейсбол" },
  { slug: "American+Football+-+4", newSlug: "american-football", en: "American Football", ru: "Американский футбол" },
  { slug: "Boxing+-+7", newSlug: "boxing", en: "Boxing", ru: "Бокс" },
  { slug: "MMA+-+439050", newSlug: "mma", en: "MMA / UFC", ru: "ММА / UFC" },
  { slug: "Cricket+-+8", newSlug: "cricket", en: "Cricket", ru: "Крикет" },
  { slug: "Darts+-+9", newSlug: "darts", en: "Darts", ru: "Дартс" },
  { slug: "Snooker+-+2185", newSlug: "snooker", en: "Snooker", ru: "Снукер" },
  { slug: "Badminton+-+414330", newSlug: "badminton", en: "Badminton", ru: "Бадминтон" },
  { slug: "Rugby+Union+-+1580", newSlug: "rugby-union", en: "Rugby Union", ru: "Регби-юнион" },
  { slug: "Rugby+League+-+947", newSlug: "rugby-league", en: "Rugby League", ru: "Регби-лига" },
  { slug: "Water+Polo+-+382582", newSlug: "water-polo", en: "Water Polo", ru: "Водное поло" },
  { slug: "Bandy+-+338094", newSlug: "bandy", en: "Bandy", ru: "Бенди" },
  { slug: "Floorball+-+484963", newSlug: "floorball", en: "Floorball", ru: "Флорбол" },
  { slug: "Chess+-+140628", newSlug: "chess", en: "Chess", ru: "Шахматы" },
  { slug: "Aussie+Rules+-+237218", newSlug: "aussie-rules", en: "Aussie Rules", ru: "Австралийский футбол" },
  { slug: "Basketball+3x3+-+8163497", newSlug: "basketball-3x3", en: "Basketball 3x3", ru: "Баскетбол 3x3" },
  { slug: "Biathlon+-+6030102", newSlug: "biathlon", en: "Biathlon", ru: "Биатлон" },
  { slug: "Alpine+Skiing+-+6030100", newSlug: "alpine-skiing", en: "Alpine Skiing", ru: "Горные лыжи" },
  { slug: "Squash+-+447961", newSlug: "squash", en: "Squash", ru: "Сквош" },
  { slug: "Pool+-+300533", newSlug: "pool", en: "Pool", ru: "Пул" },
  { slug: "Curling+-+126925", newSlug: "curling", en: "Curling", ru: "Керлинг" },
  { slug: "Sumo+-+954952", newSlug: "sumo", en: "Sumo", ru: "Сумо" },
];

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function parseServerDate(html: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const m = html.match(/"serverTime":"(\d{4}),(\d{1,2}),(\d{1,2}),(\d{1,2}),(\d{1,2}),\d{1,2}"/);
  if (m) {
    return {
      year: Number(m[1]),
      month: Number(m[2]) - 1,
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
    };
  }
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth(),
    day: now.getUTCDate(),
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
  };
}

/** Parses Marathonbet EN prematch time ("13:50" or "24 Nov 17:45") in GMT/UTC. */
export function parseMarathonTime(
  raw: string,
  ref: { year: number; month: number; day: number; hour: number; minute: number },
): Date | null {
  const clean = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const hhmmOnly = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmOnly) {
    const hh = Number(hhmmOnly[1]);
    const mm = Number(hhmmOnly[2]);
    const refMs = Date.UTC(ref.year, ref.month, ref.day, ref.hour, ref.minute);
    let candidate = Date.UTC(ref.year, ref.month, ref.day, hh, mm);
    // If more than 12 hours before serverTime, it rolled into the next UTC day.
    if (candidate < refMs - 12 * 3600_000) {
      candidate += 24 * 3600_000;
    }
    return new Date(candidate);
  }

  const withDate = clean.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2}):(\d{2})$/);
  if (withDate) {
    const day = Number(withDate[1]);
    const month = MONTHS[withDate[2].toLowerCase()];
    const hh = Number(withDate[3]);
    const mm = Number(withDate[4]);
    if (month === undefined) return null;
    let year = ref.year;
    if (month < ref.month - 6) year += 1;
    else if (month > ref.month + 6) year -= 1;
    return new Date(Date.UTC(year, month, day, hh, mm));
  }

  return null;
}

function leagueFromPath(eventPath: string, fallback: string): string {
  const rawSegments = eventPath.split("/").filter(Boolean);
  if (rawSegments.length < 3) return fallback;
  const middle = rawSegments.slice(1, -1).map((seg) => {
    try {
      return decodeURIComponent(seg.replace(/\+/g, " "));
    } catch {
      return seg.replace(/\+/g, " ");
    }
  });
  return middle.join(". ") || fallback;
}

function splitEventName(name: string): [string, string] | null {
  const vsParts = name.split(/\s+vs\s+/i);
  if (vsParts.length === 2) return [vsParts[0].trim(), vsParts[1].trim()];
  const dashParts = name.split(/\s+[-–—]\s+/);
  if (dashParts.length === 2) return [dashParts[0].trim(), dashParts[1].trim()];
  return null;
}

type ParsedRow = {
  eventId: string;
  home: string;
  away: string;
  league: string;
  startsAt: Date | null;
};

function parseCouponRows(
  html: string,
  ref: { year: number; month: number; day: number; hour: number; minute: number },
  fallbackSport: string,
): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const rowStarts = [...html.matchAll(/<div[^>]+class="[^"]*coupon-row[^"]*"[^>]*>/g)];

  for (let i = 0; i < rowStarts.length; i += 1) {
    const startIdx = rowStarts[i].index ?? 0;
    const endIdx =
      i + 1 < rowStarts.length ? (rowStarts[i + 1].index ?? html.length) : Math.min(html.length, startIdx + 12_000);
    const headerTag = rowStarts[i][0];
    const block = html.slice(startIdx, endIdx);

    const liveAttr = headerTag.match(/data-live="([^"]+)"/)?.[1];
    if (liveAttr !== "false") continue;

    const eventId = headerTag.match(/data-event-eventId="(\d+)"/)?.[1];
    if (!eventId) continue;

    const rawName = decodeEntities(headerTag.match(/data-event-name="([^"]*)"/)?.[1] ?? "");
    const rawPath = headerTag.match(/data-event-path="([^"]*)"/)?.[1] ?? "";

    let home = "";
    let away = "";
    const jsonAttr = block.match(/data-json="([^"]+)"/)?.[1] ?? block.match(/data-json='([^']+)'/)?.[1];
    if (jsonAttr) {
      try {
        const parsed = JSON.parse(decodeEntities(jsonAttr)) as { teamNames?: string[] };
        if (Array.isArray(parsed.teamNames) && parsed.teamNames.length >= 2) {
          home = String(parsed.teamNames[0] ?? "").trim();
          away = String(parsed.teamNames[1] ?? "").trim();
        }
      } catch {
        // Fallback to data-event-name below.
      }
    }
    if (!home || !away) {
      const split = splitEventName(rawName);
      if (split) [home, away] = split;
    }
    if (!home || !away) continue;

    const timeHtml = block.match(/data-mutable-id="prematch-time"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const startsAt = timeHtml ? parseMarathonTime(timeHtml, ref) : null;
    const league = leagueFromPath(rawPath, fallbackSport);

    rows.push({ eventId, home, away, league, startsAt });
  }

  return rows;
}

/** Extracts tournament category links from `new.marathonbet.ru/su/betting/<sport>`. */
export function extractNewMarathonCategoryLinks(html: string): { href: string; nameRu: string }[] {
  const results: { href: string; nameRu: string }[] = [];
  const seen = new Set<string>();
  const cardRe = /data-test="categorycard"[\s\S]{0,1200}?href="([^"]*\/champ\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(cardRe)) {
    const href = match[1]?.trim();
    const nameRu = stripTags(match[2] ?? "");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    results.push({ href, nameRu });
  }
  return results;
}

/**
 * Parses prematch events rendered by `https://new.marathonbet.ru/su/` (and `mobile.marathonbet.ru/su/`
 * rendered HTML) including category headers, single teams (`data-test="team"`), doubles pairs
 * (`data-test="pairteam"`), and ISO-8601 UTC `<time dateTime="...">` stamps.
 */
export function parseNewMarathonbetHtml(
  html: string,
  sportEn: string,
  sportRu: string,
  nowMs = Date.now(),
  sourceHost = NEW_MARATHON_HOST,
): NormalizedEvent[] {
  const resolved = resolveSport(sportEn, sportRu);
  const events: NormalizedEvent[] = [];
  const seen = new Set<string>();

  // Track category card positions so each event inherits the nearest preceding tournament header.
  const categories: { index: number; nameRu: string; slug: string }[] = [];
  const catRe = /data-test="categorycard"[\s\S]{0,1200}?href="([^"]*\/(?:champ|betting)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(catRe)) {
    const href = m[1] ?? "";
    const slug = href.split("/").filter(Boolean).pop() ?? "";
    const nameRu = stripTags(m[2] ?? "");
    if (nameRu) {
      categories.push({ index: m.index ?? 0, nameRu, slug });
    }
  }

  // Fallback page heading (used on single championship pages `/su/betting/champ/...`)
  const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const pageHeadingRu = headingMatch ? stripTags(headingMatch[1]) : "";

  const eventStarts = [...html.matchAll(/data-test="event"[^>]*href="([^"]+)"[^>]*>/g)];
  let catCursor = 0;

  for (let i = 0; i < eventStarts.length; i += 1) {
    const startIdx = eventStarts[i].index ?? 0;
    const endIdx =
      i + 1 < eventStarts.length ? (eventStarts[i + 1].index ?? html.length) : Math.min(html.length, startIdx + 6000);
    const href = eventStarts[i][1] ?? "";
    const block = html.slice(startIdx, endIdx);

    while (catCursor + 1 < categories.length && categories[catCursor + 1].index <= startIdx) {
      catCursor += 1;
    }
    const activeCategory = categories[catCursor]?.index <= startIdx ? categories[catCursor] : undefined;

    const timeStr = block.match(/dateTime="([^"]+)"/i)?.[1];
    if (!timeStr) continue;
    const startsAt = new Date(timeStr);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= nowMs) continue;

    // Extract single teams (`data-test="team"`) or doubles pairs (`data-test="pairteam"`).
    let homeRu = "";
    let awayRu = "";

    const pairBlocks = [...block.matchAll(/data-test="pairteam"[^>]*>([\s\S]*?)<\/div>/g)];
    if (pairBlocks.length >= 2) {
      const side1 = [...pairBlocks[0][1].matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)].map((m) => stripTags(m[1]));
      const side2 = [...pairBlocks[1][1].matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)].map((m) => stripTags(m[1]));
      homeRu = side1.filter(Boolean).join(" / ");
      awayRu = side2.filter(Boolean).join(" / ");
    } else {
      const mobileTeams = [...block.matchAll(/<strong class="u-mobile-only">([\s\S]*?)<\/strong>/g)]
        .map((m) => stripTags(m[1]))
        .filter(Boolean);
      if (mobileTeams.length >= 2) {
        [homeRu, awayRu] = mobileTeams;
      } else {
        const teamBlocks = [...block.matchAll(/data-test="team"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)]
          .map((m) => stripTags(m[1]))
          .filter(Boolean);
        if (teamBlocks.length >= 2) [homeRu, awayRu] = teamBlocks;
      }
    }

    if (!homeRu || !awayRu) continue;

    // Parse URL segments: `/su/betting/event/<sport>/<league>/<home>-vs-<away>`
    // or `/su/betting/esports/event/<game>/<tournament>/<home>-vs-<away>`
    const cleanPath = href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/su\/betting\//, "");
    const parts = cleanPath.split("/").filter(Boolean);
    const matchSlug = parts[parts.length - 1] ?? "";
    const leagueSlug = parts.length >= 2 ? parts[parts.length - 2] : activeCategory?.slug ?? "";

    let homeEn = homeRu;
    let awayEn = awayRu;
    const vsMatch = matchSlug.match(/^(.+)-vs-(.+)$/);
    if (vsMatch && pairBlocks.length < 2) {
      homeEn = humanizeSlug(vsMatch[1]) || homeRu;
      awayEn = humanizeSlug(vsMatch[2]) || awayRu;
    }

    const leagueRu =
      activeCategory && activeCategory.slug !== "top-league"
        ? activeCategory.nameRu
        : pageHeadingRu || (leagueSlug ? humanizeSlug(leagueSlug) : sportRu);
    const leagueEn =
      leagueSlug && leagueSlug !== "top-league"
        ? humanizeSlug(leagueSlug)
        : leagueRu || sportEn;

    const externalId = `new:${cleanPath}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    events.push({
      source: "marathon",
      externalId,
      sportKey: resolved.key,
      sportName: resolved.name,
      leagueName: { en: leagueEn, ru: leagueRu },
      home: { en: homeEn, ru: homeRu },
      away: { en: awayEn, ru: awayRu },
      startsAt,
      sourceHost,
      matchFormat: extractMatchFormat({
        sportKey: resolved.key,
        leagueEn,
        leagueRu,
        homeEn,
        awayEn,
      }),
      tournamentStage: extractTournamentStage({
        leagueEn,
        leagueRu,
      }),
    });
  }

  return events;
}

async function fetchHtml(url: string, ajax = false, mobile = false): Promise<string> {
  const response = await sourceFetch("marathon", url, {
    headers: {
      "User-Agent": mobile ? MOBILE_USER_AGENT : USER_AGENT,
      Accept: ajax ? "application/json, text/javascript, */*" : "text/html",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      ...(ajax ? { "X-Requested-With": "XMLHttpRequest" } : {}),
    },
    timeoutMs: 25_000,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchClassicSportPages(host: string, sport: MarathonSport): Promise<NormalizedEvent[]> {
  const baseUrlEn = `https://${host}/en/betting/${sport.slug}`;
  const baseUrlRu = `https://${host}/su/betting/${sport.slug}`;

  const [firstEn, firstRu] = await Promise.all([
    fetchHtml(baseUrlEn),
    fetchHtml(baseUrlRu).catch(() => ""),
  ]);

  const ref = parseServerDate(firstEn);
  const enRows: ParsedRow[] = parseCouponRows(firstEn, ref, sport.en);
  const ruById = new Map<string, { home: string; away: string; league: string }>();

  if (firstRu) {
    for (const row of parseCouponRows(firstRu, ref, sport.ru)) {
      ruById.set(row.eventId, { home: row.home, away: row.away, league: row.league });
    }
  }

  // Paginate additional pages if present.
  let hasNext = firstEn.includes("nextPageContent");
  for (let page = 1; page < MAX_PAGES_PER_SPORT && hasNext; page += 1) {
    try {
      const [ajaxEn, ajaxRu] = await Promise.all([
        fetchHtml(`${baseUrlEn}?page=${page}&pageAction=getPage`, true),
        fetchHtml(`${baseUrlRu}?page=${page}&pageAction=getPage`, true).catch(() => ""),
      ]);
      const payloadEn = JSON.parse(ajaxEn) as { selector?: string; content?: string }[];
      const contentEn = payloadEn.find((p) => p.content)?.content ?? "";
      if (!contentEn) break;
      const moreEn = parseCouponRows(contentEn, ref, sport.en);
      if (moreEn.length === 0) break;
      enRows.push(...moreEn);
      hasNext = contentEn.includes("nextPageContent");

      if (ajaxRu) {
        try {
          const payloadRu = JSON.parse(ajaxRu) as { content?: string }[];
          const contentRu = payloadRu.find((p) => p.content)?.content ?? "";
          for (const row of parseCouponRows(contentRu, ref, sport.ru)) {
            ruById.set(row.eventId, { home: row.home, away: row.away, league: row.league });
          }
        } catch {
          // Ignore RU pagination parse failure; English names remain intact.
        }
      }
    } catch {
      break;
    }
  }

  const nowMs = Date.now();
  const resolved = resolveSport(sport.en, sport.ru);
  const events: NormalizedEvent[] = [];
  const seen = new Set<string>();

  for (const row of enRows) {
    if (!row.startsAt || row.startsAt.getTime() <= nowMs) continue;
    if (seen.has(row.eventId)) continue;
    seen.add(row.eventId);

    const ru = ruById.get(row.eventId);
    const leagueRu = ru?.league || row.league;
    events.push({
      source: "marathon",
      externalId: row.eventId,
      sportKey: resolved.key,
      sportName: resolved.name,
      leagueName: { en: row.league, ru: leagueRu },
      home: { en: row.home, ru: ru?.home || row.home },
      away: { en: row.away, ru: ru?.away || row.away },
      startsAt: row.startsAt,
      sourceHost: host,
      matchFormat: extractMatchFormat({
        sportKey: resolved.key,
        leagueEn: row.league,
        leagueRu,
        homeEn: row.home,
        awayEn: row.away,
      }),
      tournamentStage: extractTournamentStage({
        leagueEn: row.league,
        leagueRu,
      }),
    });
  }

  return events;
}

async function fetchNewSportPages(sport: MarathonSport): Promise<NormalizedEvent[]> {
  const indexUrl = `https://${NEW_MARATHON_HOST}/su/betting/${sport.newSlug}`;
  const indexHtml = await fetchHtml(indexUrl);
  const nowMs = Date.now();

  const merged = new Map<string, NormalizedEvent>();
  for (const ev of parseNewMarathonbetHtml(indexHtml, sport.en, sport.ru, nowMs, NEW_MARATHON_HOST)) {
    merged.set(ev.externalId, ev);
  }

  // Fetch top tournament pages (skipping top-league/euro-ups which duplicate individual leagues) for deeper coverage.
  const categories = extractNewMarathonCategoryLinks(indexHtml)
    .filter((c) => !c.href.endsWith("/top-league") && !c.href.endsWith("/euro-ups"))
    .slice(0, MAX_NEW_CHAMPS_PER_SPORT);

  const champResults = await Promise.all(
    categories.map((cat) =>
      fetchHtml(`https://${NEW_MARATHON_HOST}${cat.href}`)
        .then((html) => parseNewMarathonbetHtml(html, sport.en, sport.ru, nowMs, NEW_MARATHON_HOST))
        .catch(() => [] as NormalizedEvent[]),
    ),
  );

  for (const list of champResults) {
    for (const ev of list) merged.set(ev.externalId, ev);
  }

  return [...merged.values()];
}

async function fetchMobileSportPages(sport: MarathonSport): Promise<NormalizedEvent[]> {
  const url = `https://${MOBILE_MARATHON_HOST}/su/sport/prematch/${sport.newSlug}`;
  let html = "";
  if (findChromeBinary()) {
    const rendered = await chromiumFetch({ url, timeoutMs: 25_000 });
    if (rendered.status >= 400) throw new Error(`HTTP ${rendered.status}`);
    html = rendered.text;
  } else {
    html = await fetchHtml(url, false, true);
  }
  return parseNewMarathonbetHtml(html, sport.en, sport.ru, Date.now(), MOBILE_MARATHON_HOST);
}

type MirrorResolution =
  | { mode: "classic"; host: string }
  | { mode: "new"; host: string }
  | { mode: "mobile"; host: string };

async function resolveWorkingMirror(): Promise<MirrorResolution> {
  const errors: string[] = [];

  for (const host of CLASSIC_MARATHON_HOSTS) {
    try {
      const res = await sourceFetch("marathon", `https://${host}/en/`, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        timeoutMs: 10_000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.text().catch(() => "");
      return { mode: "classic", host };
    } catch (err) {
      errors.push(`${host}: ${describeError(err)}`);
    }
  }

  try {
    const res = await sourceFetch("marathon", `https://${NEW_MARATHON_HOST}/su/betting`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8" },
      timeoutMs: 12_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.text().catch(() => "");
    return { mode: "new", host: NEW_MARATHON_HOST };
  } catch (err) {
    errors.push(`${NEW_MARATHON_HOST}: ${describeError(err)}`);
  }

  try {
    const res = await sourceFetch("marathon", `https://${MOBILE_MARATHON_HOST}/su/sport/prematch/popular`, {
      headers: { "User-Agent": MOBILE_USER_AGENT, Accept: "text/html" },
      timeoutMs: 12_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.text().catch(() => "");
    return { mode: "mobile", host: MOBILE_MARATHON_HOST };
  } catch (err) {
    errors.push(`${MOBILE_MARATHON_HOST}: ${describeError(err)}`);
  }

  throw new Error(`Marathonbet unreachable (${errors.join("; ")})`);
}

export const marathonAdapter: SourceAdapter = {
  id: "marathon",
  concurrency: 4,
  createTasks: async (): Promise<SourceTask[]> => {
    const mirror = await resolveWorkingMirror();
    return SPORT_PAGES.map((sport) => ({
      label: `Marathonbet (${mirror.host}) · ${sport.en}`,
      run: () =>
        mirror.mode === "classic"
          ? fetchClassicSportPages(mirror.host, sport)
          : mirror.mode === "new"
            ? fetchNewSportPages(sport)
            : fetchMobileSportPages(sport),
    }));
  },
};
