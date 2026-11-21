import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import { diffSideName } from "../diff-names";
import { DEFAULT_UI_PREFS, normalizeUiPreferences } from "../ui-preferences";
import { parseCurlHttpOutput } from "../net/resilient-fetch";
import { maskProxyUrl, parseProxyLine, parseProxyLines, selectProxyForSource } from "../proxy/parse";
import { DEFAULT_PROXY_SETTINGS, type ProxyEntry } from "../proxy/types";
import { mapBcGameChunk } from "./bcgame";
import { mapBwinFixtures } from "./bwin";
import { checkLines } from "./check";
import { extractMatchFormat, parseStoredMatchFormat, pickBestMatchFormat, serializeMatchFormat } from "./format";
import { extractNewMarathonCategoryLinks, parseMarathonTime, parseNewMarathonbetHtml } from "./marathon";
import {
  extractMatchVenueInfo,
  extractTournamentStage,
  mergeMatchVenueInfo,
  parseStoredMatchVenueInfo,
  parseStoredTournamentStage,
  parseVenueLocation,
  pickBestTournamentStage,
  serializeMatchVenueInfo,
  serializeTournamentStage,
} from "./match-details";
import { mergeEvents } from "./merge";
import { ageGroupOf, normalizeName, personSimilarity, teamSimilarity, type NormalizedEvent } from "./model";
import { mapNetbetTree } from "./netbet";
import { decryptOddsPortalPayload, mapOddsPortalRows } from "./oddsportal";
import { mapOddspediaMatches } from "./oddspedia";
import { mapPinnacleMatchups } from "./pinnacle";
import { mapStakeFixtures } from "./stake";
import { mapUnibetEvents } from "./unibet";
import { extractWebSocketError, VBET_SWARM_MIRRORS } from "./vbet";

function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    source: "1xbet",
    externalId: "1",
    sportKey: "football",
    sportName: { en: "Football", ru: "Футбол" },
    leagueName: { en: "England. Premier League", ru: "Англия. Премьер-лига" },
    home: { en: "Team A", ru: "Команда А" },
    away: { en: "Team B", ru: "Команда Б" },
    startsAt: new Date(Date.now() + 2 * 3600_000),
    sourceHost: null,
    ...overrides,
  };
}

test("ageGroupOf and normalizeName unify U19, Under 19, (U19), and (19)", () => {
  assert.equal(ageGroupOf("Arsenal U19"), "u19");
  assert.equal(ageGroupOf("Arsenal Under 19"), "u19");
  assert.equal(ageGroupOf("Arsenal (U19)"), "u19");
  assert.equal(ageGroupOf("Arsenal (19)"), "u19");
  assert.equal(ageGroupOf("Арсенал (до 19)"), "u19");

  assert.equal(normalizeName("Arsenal U19"), "arsenal");
  assert.equal(normalizeName("Arsenal Under 19"), "arsenal");
  assert.equal(normalizeName("Arsenal (U19)"), "arsenal");
  assert.equal(normalizeName("Arsenal (19)"), "arsenal");
});

test("normalizeName and mergeEvents unify (w), (women), (wom), Women", () => {
  assert.equal(normalizeName("Barcelona (w)"), "barcelona");
  assert.equal(normalizeName("Barcelona (women)"), "barcelona");
  assert.equal(normalizeName("Barcelona (wom)"), "barcelona");
  assert.equal(normalizeName("Barcelona Women"), "barcelona");
  assert.equal(normalizeName("Барселона (жен)"), "барселона");

  const start = new Date(Date.now() + 3 * 3600_000);
  const e1 = makeEvent({
    source: "1xbet",
    externalId: "101",
    home: { en: "Arsenal (w)", ru: "Арсенал (ж)" },
    away: { en: "Chelsea (wom)", ru: "Челси (жен)" },
    startsAt: start,
  });
  const e2 = makeEvent({
    source: "betcity",
    externalId: "202",
    home: { en: "Arsenal (women)", ru: "Арсенал (женщины)" },
    away: { en: "Chelsea Women", ru: "Челси (ж)" },
    startsAt: start,
  });

  const merged = mergeEvents([e1, e2]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].matchType, "full");
  assert.equal(merged[0].sources.length, 2);
});

test("mergeEvents treats U19 vs (19) vs Under 19 as full match, not partial/rejected", () => {
  const start = new Date(Date.now() + 3 * 3600_000);
  const e1 = makeEvent({
    source: "1xbet",
    externalId: "11",
    home: { en: "Benfica U19", ru: "Бенфика (19)" },
    away: { en: "Porto (19)", ru: "Порту U19" },
    startsAt: start,
  });
  const e2 = makeEvent({
    source: "marathon",
    externalId: "22",
    home: { en: "Benfica Under 19", ru: "Бенфика до 19" },
    away: { en: "Porto (U19)", ru: "Порту (19)" },
    startsAt: start,
  });

  const merged = mergeEvents([e1, e2]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].matchType, "full");
});

test("individual sports match participant initials in EN and RU", () => {
  assert.ok(personSimilarity("j sinner", "jannik sinner") >= 0.9);
  assert.ok(personSimilarity("sinner j", "jannik sinner") >= 0.9);
  assert.ok(personSimilarity("д медведев", "даниил медведев") >= 0.9);
  assert.ok(personSimilarity("медведев д", "даниил медведев") >= 0.9);
  assert.equal(personSimilarity("f sinner", "jannik sinner"), 0);
  assert.ok(teamSimilarity("n li", "na li", { individual: true }) >= 0.9);

  const start = new Date(Date.now() + 3 * 3600_000);
  const t1 = makeEvent({
    source: "1xbet",
    externalId: "t1",
    sportKey: "tennis",
    sportName: { en: "Tennis", ru: "Теннис" },
    home: { en: "Jannik Sinner", ru: "Янник Синнер" },
    away: { en: "Carlos Alcaraz", ru: "Карлос Алькарас" },
    startsAt: start,
  });
  const t2 = makeEvent({
    source: "betcity",
    externalId: "t2",
    sportKey: "tennis",
    sportName: { en: "Tennis", ru: "Теннис" },
    home: { en: "Sinner, J.", ru: "Синнер Я." },
    away: { en: "C. Alcaraz", ru: "К. Алькарас" },
    startsAt: start,
  });

  const merged = mergeEvents([t1, t2]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].matchType, "full");
});

test("checkLines matches individual sports with initials and collects all matching bookmakers", () => {
  const now = Date.now();
  const start = new Date(now + 2 * 3600_000);
  const events: NormalizedEvent[] = [
    makeEvent({
      source: "1xbet",
      externalId: "9001",
      sportKey: "tennis",
      sportName: { en: "Tennis", ru: "Теннис" },
      home: { en: "Daniil Medvedev", ru: "Даниил Медведев" },
      away: { en: "Alexander Zverev", ru: "Александр Зверев" },
      startsAt: start,
    }),
    makeEvent({
      source: "betcity",
      externalId: "9002",
      sportKey: "tennis",
      sportName: { en: "Tennis", ru: "Теннис" },
      home: { en: "Д. Медведев", ru: "Д. Медведев" },
      away: { en: "А. Зверев", ru: "А. Зверев" },
      startsAt: start,
    }),
  ];

  const [res] = checkLines(["D. Medvedev - Zverev A.    Tennis. ATP"], events, now);
  assert.equal(res.status, "green");
  assert.equal(res.homeMatched, true);
  assert.equal(res.awayMatched, true);
  assert.ok(res.match);
  assert.deepEqual(res.match.sources, ["1xbet", "betcity"]);
});

test("diffSideName underlines matching teams, highlights diffs in red, and ignores U19/(19)/(w)/(women)", () => {
  const matchAge = diffSideName("Benfica U19", "Benfica (19)");
  assert.equal(matchAge.matched, true);
  assert.deepEqual(matchAge.segments, [{ text: "Benfica (19)", kind: "match" }]);

  const matchWomen = diffSideName("Arsenal (w)", "Arsenal (women)");
  assert.equal(matchWomen.matched, true);
  assert.deepEqual(matchWomen.segments, [{ text: "Arsenal (women)", kind: "match" }]);

  const partial = diffSideName("Manchester United (w)", "Manchester City (wom)");
  assert.equal(partial.matched, false);
  const redTexts = partial.segments.filter((s) => s.kind === "diff").map((s) => s.text);
  assert.deepEqual(redTexts, ["City"]);
  assert.equal(partial.segments.some((s) => s.text.includes("(wom)") && s.kind === "neutral"), true);
});

test("parseMarathonTime handles today HH:MM and future DD Mon HH:MM in UTC", () => {
  const ref = { year: 2026, month: 10, day: 19, hour: 13, minute: 30 };
  const today = parseMarathonTime("15:45", ref);
  assert.equal(today?.toISOString(), "2026-11-19T15:45:00.000Z");

  const nextDay = parseMarathonTime("01:15", { year: 2026, month: 10, day: 19, hour: 23, minute: 30 });
  assert.equal(nextDay?.toISOString(), "2026-11-20T01:15:00.000Z");

  const future = parseMarathonTime("24 Nov 17:45", ref);
  assert.equal(future?.toISOString(), "2026-11-24T17:45:00.000Z");
});

test("mapUnibetEvents filters live/past events and merges EN + RU translations", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureIso = new Date(now + 2 * 3600_000).toISOString();
  const pastIso = new Date(now - 3600_000).toISOString();

  const enData = {
    events: [
      {
        event: {
          id: 101,
          homeName: "Arsenal",
          awayName: "Chelsea",
          start: futureIso,
          state: "NOT_STARTED",
          path: [{ englishName: "Football" }, { englishName: "England" }, { englishName: "Premier League" }],
        },
      },
      {
        event: {
          id: 102,
          homeName: "Live Home",
          awayName: "Live Away",
          start: futureIso,
          state: "STARTED",
        },
      },
      {
        event: {
          id: 103,
          homeName: "Past Home",
          awayName: "Past Away",
          start: pastIso,
          state: "NOT_STARTED",
        },
      },
    ],
  };
  const ruData = {
    events: [
      {
        event: {
          id: 101,
          homeName: "Арсенал",
          awayName: "Челси",
          path: [{ name: "Футбол" }, { name: "Англия" }, { name: "Премьер-лига" }],
        },
      },
    ],
  };

  const mapped = mapUnibetEvents(enData, ruData, "Football", now);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].source, "unibet");
  assert.equal(mapped[0].externalId, "101");
  assert.equal(mapped[0].home.en, "Arsenal");
  assert.equal(mapped[0].home.ru, "Арсенал");
  assert.equal(mapped[0].leagueName.ru, "Англия. Премьер-лига");
});

test("mapBcGameChunk resolves sports/tournaments/competitors and skips virtual/non-match entries", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const scheduled = Math.floor((now + 3 * 3600_000) / 1000);

  const enChunk = {
    sports: { sp1: { name: "Basketball" } },
    categories: { cat1: { name: "USA" } },
    tournaments: { tr1: { name: "NBA" } },
    events: {
      ev1: {
        desc: {
          scheduled,
          type: "match",
          virtual: false,
          sport: "sp1",
          category: "cat1",
          tournament: "tr1",
          competitors: [{ name: "Lakers" }, { name: "Celtics" }],
        },
      },
      ev2: {
        desc: {
          scheduled,
          type: "outright",
          virtual: false,
          sport: "sp1",
          competitors: [{ name: "A" }, { name: "B" }],
        },
      },
      ev3: {
        desc: {
          scheduled,
          type: "match",
          virtual: true,
          sport: "sp1",
          competitors: [{ name: "Virt1" }, { name: "Virt2" }],
        },
      },
    },
  };
  const ruChunk = {
    sports: { sp1: { name: "Баскетбол" } },
    categories: { cat1: { name: "США" } },
    tournaments: { tr1: { name: "НБА" } },
    events: {
      ev1: {
        desc: {
          competitors: [{ name: "Лейкерс" }, { name: "Селтикс" }],
        },
      },
    },
  };

  const mapped = mapBcGameChunk(enChunk, ruChunk, now);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].source, "bcgame");
  assert.equal(mapped[0].sportKey, "basketball");
  assert.equal(mapped[0].leagueName.en, "USA. NBA");
  assert.equal(mapped[0].leagueName.ru, "США. НБА");
  assert.equal(mapped[0].home.ru, "Лейкерс");
});

test("mapNetbetTree extracts upcoming matches and skips live events", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureIso = new Date(now + 4 * 3600_000).toISOString();

  const mapped = mapNetbetTree(
    {
      tree: [
        {
          name: "Tennis",
          region: { name: "ATP" },
          competitions: [
            {
              name: "ATP Finals",
              events: [
                {
                  id: 555,
                  starts_at: futureIso,
                  is_live: false,
                  competitors: [
                    { name: "Novak Djokovic", is_home: false },
                    { name: "Carlos Alcaraz", is_home: true },
                  ],
                },
                {
                  id: 556,
                  starts_at: futureIso,
                  is_live: true,
                  competitors: [{ name: "Live A", is_home: true }, { name: "Live B", is_home: false }],
                },
              ],
            },
          ],
        },
      ],
    },
    "Tennis",
    now,
  );

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].source, "netbet");
  assert.equal(mapped[0].home.en, "Carlos Alcaraz");
  assert.equal(mapped[0].away.en, "Novak Djokovic");
  assert.equal(mapped[0].leagueName.en, "ATP. ATP Finals");
});

test("decryptOddsPortalPayload decrypts gzipped AES-256-CBC payload and mapOddsPortalRows filters stage 1", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const ts = Math.floor((now + 2 * 3600_000) / 1000);
  const payload = {
    d: {
      hasMore: false,
      rows: [
        {
          id: "op-1",
          "home-name": "Real Madrid",
          "away-name": "Barcelona",
          "event-stage-id": 1,
          "date-start-timestamp": ts,
          "country-name": "Spain",
          "tournament-name": "LaLiga",
          "sport-url-name": "football",
        },
        {
          id: "op-2",
          "home-name": "Live 1",
          "away-name": "Live 2",
          "event-stage-id": 2,
          "date-start-timestamp": ts,
        },
      ],
    },
  };

  const key = pbkdf2Sync(
    Buffer.from("Sio4c1EhcCQ3YURfZlIyeVdAZ0huKjNiVnAjc0FkTGRfaw==", "base64").toString("utf8"),
    Buffer.from("NWI5YThmMmMzZTZkMWE0YjdjOGU5ZDBmMWEyYjNjNGQ=", "base64").toString("utf8"),
    1000,
    32,
    "sha256",
  );
  const iv = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const encryptedB64 = Buffer.concat([cipher.update(gz), cipher.final()]).toString("base64");
  const wire = Buffer.from(`${encryptedB64}:${iv.toString("hex")}`, "latin1").toString("base64");

  const decoded = decryptOddsPortalPayload(wire);
  const rows = decoded.d?.rows ?? [];
  const mapped = mapOddsPortalRows(rows, "Football", now);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].source, "oddsportal");
  assert.equal(mapped[0].leagueName.en, "Spain. LaLiga");
  assert.equal(mapped[0].home.en, "Real Madrid");
  assert.throws(() => decryptOddsPortalPayload("not-valid-envelope"));
});

test("normalizeUiPreferences validates presets and falls back safely", () => {
  assert.deepEqual(normalizeUiPreferences(null), DEFAULT_UI_PREFS);
  assert.deepEqual(
    normalizeUiPreferences({
      accent: "indigo",
      radius: "sharp",
      density: "compact",
      surface: "elevated",
      motionEnabled: false,
      ambientBackdrop: false,
    }),
    {
      accent: "indigo",
      radius: "sharp",
      density: "compact",
      surface: "elevated",
      motionEnabled: false,
      ambientBackdrop: false,
    },
  );
  assert.deepEqual(
    normalizeUiPreferences({ accent: "neon-invalid", radius: "giant", motionEnabled: "yes" }),
    DEFAULT_UI_PREFS,
  );
});

test("parseProxyLine and maskProxyUrl handle URL, host:port:user:pass, and deduplicate bulk lines", () => {
  const full = parseProxyLine("socks5://alice:s3cr3t@10.0.0.1:1080");
  assert.ok(full);
  assert.equal(full.protocol, "socks5");
  assert.equal(full.host, "10.0.0.1");
  assert.equal(full.port, 1080);
  assert.equal(full.username, "alice");
  assert.equal(maskProxyUrl(full.url), "socks5://alice:••••@10.0.0.1:1080");

  const fourPart = parseProxyLine("192.168.1.50:8080:bob:pw123", "https");
  assert.ok(fourPart);
  assert.equal(fourPart.protocol, "https");
  assert.equal(fourPart.username, "bob");
  assert.equal(fourPart.password, "pw123");

  const bulk = parseProxyLines(
    "# comment\n192.168.1.50:8080:bob:pw123\nhttps://bob:pw123@192.168.1.50:8080\nbad-proxy-line\n1.2.3.4:3128",
    "https",
  );
  assert.equal(bulk.parsed.length, 2);
  assert.deepEqual(bulk.invalid, ["bad-proxy-line"]);
});

test("selectProxyForSource prioritizes task-isolated pools, respects cooldowns, and rotates sticky sessions", () => {
  const makeProxy = (id: string, sources: ProxyEntry["sources"], extra: Partial<ProxyEntry> = {}): ProxyEntry => ({
    id,
    url: `http://10.0.0.${id}:8080`,
    protocol: "http",
    host: `10.0.0.${id}`,
    port: 8080,
    username: "",
    password: "",
    label: `Proxy ${id}`,
    proxyType: "residential",
    country: "GB",
    sources,
    enabled: true,
    lastStatus: "ok",
    lastLatencyMs: 100,
    lastExitIp: null,
    lastError: null,
    lastCheckedAt: null,
    successCount: 1,
    failCount: 0,
    cooldownUntil: null,
    ...extra,
  });

  const now = 1_000_000;
  const globalProxy = makeProxy("1", [], { lastLatencyMs: 25 });
  const stakeProxy = makeProxy("2", ["stake"], { lastLatencyMs: 120 });
  const cooledProxy = makeProxy("3", ["stake"], { cooldownUntil: now + 60_000 });
  const state = { cursors: new Map<string, number>(), sticky: new Map<string, { proxyId: string; expiresAt: number }>() };

  // Dedicated non-cooled proxy beats global proxy even in fastest/sticky mode.
  const picked = selectProxyForSource([globalProxy, stakeProxy, cooledProxy], DEFAULT_PROXY_SETTINGS, "stake", state, undefined, now);
  assert.equal(picked?.id, "2");

  // Unassigned source falls back to global pool.
  const fallback = selectProxyForSource([globalProxy, stakeProxy], DEFAULT_PROXY_SETTINGS, "bet365", state, undefined, now);
  assert.equal(fallback?.id, "1");
});

test("parseCurlHttpOutput strips proxy CONNECT & redirect headers cleanly", () => {
  const raw =
    "HTTP/1.1 200 Connection established\r\n\r\n" +
    "HTTP/2 302 \r\nLocation: /next\r\nSet-Cookie: sid=abc; Path=/\r\n\r\n" +
    "HTTP/2 200 \r\nContent-Type: application/json\r\nSet-Cookie: tok=xyz; Path=/\r\n\r\n" +
    '{"ok":true}';
  const parsed = parseCurlHttpOutput(raw);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers["content-type"], "application/json");
  assert.deepEqual(parsed.setCookies, ["sid=abc; Path=/", "tok=xyz; Path=/"]);
  assert.equal(parsed.body, '{"ok":true}');
});

test("mapBwinFixtures supports team properties and positional tennis participants + EN/RU join", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureIso = new Date(now + 2 * 3600_000).toISOString();

  const mapped = mapBwinFixtures(
    [
      {
        id: 111,
        stage: "PreMatch",
        startDate: futureIso,
        sport: { id: 4, name: { value: "Football" } },
        region: { name: { value: "Spain" } },
        competition: { name: { value: "LaLiga" } },
        participants: [
          { name: { value: "Real Madrid" }, properties: { type: "HomeTeam" } },
          { name: { value: "Barcelona" }, properties: { type: "AwayTeam" } },
          { name: { value: "Player Goalscorer" }, properties: { type: "Player" } },
        ],
      },
      {
        id: 222,
        stage: "PreMatch",
        startDate: futureIso,
        sport: { id: 5, name: { value: "Tennis" } },
        region: { name: { value: "ATP" } },
        competition: { name: { value: "Finals" } },
        participants: [{ name: { value: "Jannik Sinner" } }, { name: { value: "Carlos Alcaraz" } }],
      },
      {
        id: 333,
        stage: "Live",
        startDate: futureIso,
        participants: [{ name: { value: "Live A" } }, { name: { value: "Live B" } }],
      },
    ],
    [
      {
        id: 111,
        sport: { name: { value: "Футбол" } },
        region: { name: { value: "Испания" } },
        competition: { name: { value: "Ла Лига" } },
        participants: [
          { name: { value: "Реал Мадрид" }, properties: { type: "HomeTeam" } },
          { name: { value: "Барселона" }, properties: { type: "AwayTeam" } },
        ],
      },
    ],
    "Football",
    now,
  );

  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].home.en, "Real Madrid");
  assert.equal(mapped[0].home.ru, "Реал Мадрид");
  assert.equal(mapped[0].leagueName.ru, "Испания. Ла Лига");
  assert.equal(mapped[1].sportKey, "tennis");
  assert.equal(mapped[1].home.en, "Jannik Sinner");
});

test("mapPinnacleMatchups handles Soccer vs American Football and skips live/hidden/parent matchups", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureIso = new Date(now + 3 * 3600_000).toISOString();

  const soccer = mapPinnacleMatchups(
    [
      {
        id: 1,
        type: "matchup",
        status: "pending",
        startTime: futureIso,
        league: { name: "Premier League" },
        participants: [
          { alignment: "home", name: "Liverpool" },
          { alignment: "away", name: "Everton" },
        ],
      },
      {
        id: 2,
        type: "matchup",
        isLive: true,
        startTime: futureIso,
        participants: [
          { alignment: "home", name: "Live1" },
          { alignment: "away", name: "Live2" },
        ],
      },
    ],
    "Soccer",
    29,
    now,
  );
  assert.equal(soccer.length, 1);
  assert.equal(soccer[0].sportKey, "football");

  const nfl = mapPinnacleMatchups(
    [
      {
        id: 3,
        type: "matchup",
        startTime: futureIso,
        league: { name: "NFL" },
        participants: [
          { alignment: "home", name: "Chiefs" },
          { alignment: "away", name: "Bills" },
        ],
      },
    ],
    "Football",
    15,
    now,
  );
  assert.equal(nfl.length, 1);
  assert.equal(nfl[0].sportKey, "american-football");
});

test("mapOddspediaMatches and mapStakeFixtures extract upcoming prematch fixtures", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureIso = new Date(now + 2 * 3600_000).toISOString();

  const oddspedia = mapOddspediaMatches(
    [
      {
        id: 99,
        ht: "Inter",
        at: "Milan",
        md: futureIso,
        category_name: "Italy",
        league_name: "Serie A",
        sport_name: "Football",
      },
      { id: 100, ht: "Live1", at: "Live2", md: futureIso, is_live: true },
    ],
    "football",
    now,
  );
  assert.equal(oddspedia.length, 1);
  assert.equal(oddspedia[0].leagueName.en, "Italy. Serie A");

  const stake = mapStakeFixtures(
    [
      {
        id: "st-1",
        data: {
          __typename: "SportFixtureDataMatch",
          startTime: futureIso,
          competitors: [{ name: "Lakers" }, { name: "Nuggets" }],
        },
        tournament: { name: "NBA", category: { name: "USA" } },
      },
    ],
    "basketball",
    now,
  );
  assert.equal(stake.length, 1);
  assert.equal(stake[0].sportKey, "basketball");
  assert.equal(stake[0].leagueName.en, "USA. NBA");
});

test("extractMatchFormat handles basketball 4x10/4x12/2x20, esports BOx, hockey, tennis, cricket, and guards against team-size/distance false positives", () => {
  assert.equal(extractMatchFormat({ sportKey: "basketball", leagueEn: "USA. NBA" })?.code, "4×12");
  assert.equal(extractMatchFormat({ sportKey: "basketball", leagueEn: "USA. NCAAB" })?.code, "2×20");
  assert.equal(extractMatchFormat({ sportKey: "basketball", leagueEn: "EuroLeague" })?.code, "4×10");
  assert.equal(extractMatchFormat({ sportKey: "basketball", leagueEn: "Chinese Taipei. TPBL. Men. (4x12 min)" })?.code, "4×12");
  assert.equal(extractMatchFormat({ sportKey: "basketball-3x3", leagueEn: "FIBA 3x3 World Tour" })?.code, "1×10 / 21");

  // Guard: team sizes (4x4) and relay distances (4x6 km) must NOT become timed period minutes
  const vball = extractMatchFormat({
    sportKey: "volleyball",
    leagueEn: "Belarus. League Pro (4x4). Best of 3 sets",
  });
  assert.equal(vball?.code, "Bo3 Sets");

  assert.equal(
    extractMatchFormat({ sportKey: "biathlon", leagueEn: "World Championships. 4x6 km Relay. Women" }),
    null,
  );

  // Football playoff "Best of 3" must stay 2x45 match format, not BO3
  assert.equal(
    extractMatchFormat({ sportKey: "football", leagueEn: "USA. MLS. Round of 16. Best of 3" })?.code,
    "2×45",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "football", leagueEn: "Youth Cup", feedMinutes: 80 })?.code,
    "2×40",
  );

  // Ice Hockey standard vs short tournament
  assert.equal(extractMatchFormat({ sportKey: "ice-hockey", leagueEn: "NHL" })?.code, "3×20");
  assert.equal(
    extractMatchFormat({ sportKey: "ice-hockey", leagueEn: "Russia. Magnitka Open. 3x10" })?.code,
    "3×10",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "ice-hockey", leagueEn: "Ball Hockey. Czech Republic. Extraliga (3x15 min.)" })?.code,
    "3×15",
  );

  // Esports series & Russian phrasing
  assert.equal(extractMatchFormat({ sportKey: "esports", leagueEn: "CS2. CCT Europe Series (best of 3)" })?.code, "BO3");
  assert.equal(extractMatchFormat({ sportKey: "esports", leagueEn: "Valorant. Grand Final", leagueRu: "Финал. до 3 побед" })?.code, "BO5");
  assert.equal(extractMatchFormat({ sportKey: "esports", leagueEn: "BLAST Slam", feedBestOf: 3 })?.code, "BO3");
  assert.equal(extractMatchFormat({ sportKey: "esports", leagueEn: "eFootball", feedMinutes: 12 })?.code, "2×6");

  // Feed hints (1xBet MIO.MaF), Tennis, Snooker, Darts, Boxing
  assert.equal(
    extractMatchFormat({ sportKey: "table-tennis", leagueEn: "Masters", feedHints: ["7 Games Match"] })?.code,
    "Bo7 Sets",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "cricket", leagueEn: "Domestic League", feedHints: ["T20"] })?.code,
    "T20",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "tennis", leagueEn: "ATP. Wimbledon. Men Singles" })?.code,
    "Bo5 Sets",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "tennis", leagueEn: "WTA. Wimbledon. Women Singles" })?.code,
    "Bo3 Sets",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "snooker", leagueEn: "UK Championship. Best of 11 frames" })?.code,
    "Bo11 Frames",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "darts", leagueEn: "Winmau Tour. Best of 7 legs" })?.code,
    "Bo7 Legs",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "boxing", leagueEn: "Title Bouts. 10 rounds of 2 min" })?.code,
    "10×2",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "mma", leagueEn: "UFC Fight Night" })?.code,
    "3×5",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "mixed-martial-arts", leagueEn: "UFC Title Bout" })?.code,
    "5×5",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "mma", leagueEn: "Bare Knuckle FC" })?.code,
    "5×2",
  );
  assert.equal(
    extractMatchFormat({ sportKey: "badminton", leagueEn: "BWF World Tour" })?.code,
    "Bo3 Games",
  );
});

test("mergeEvents prefers higher-confidence matchFormat across bookmakers and serialization round-trips", () => {
  const start = new Date(Date.now() + 2 * 3600_000);
  const e1 = makeEvent({
    source: "1xbet",
    externalId: "e-1",
    sportKey: "esports",
    sportName: { en: "Esports", ru: "Киберспорт" },
    leagueName: { en: "CS 2. CCT Europe Series", ru: "CS 2. CCT Europe Series" },
    home: { en: "NAVI", ru: "NAVI" },
    away: { en: "FaZe", ru: "FaZe" },
    startsAt: start,
    matchFormat: null,
  });
  const e2 = makeEvent({
    source: "pinnacle",
    externalId: "p-1",
    sportKey: "esports",
    sportName: { en: "Esports", ru: "Киберспорт" },
    leagueName: { en: "CS2 - CCT Europe Series", ru: "CS2 - CCT Europe Series" },
    home: { en: "NAVI", ru: "NAVI" },
    away: { en: "FaZe", ru: "FaZe" },
    startsAt: start,
    matchFormat: extractMatchFormat({ sportKey: "esports", leagueEn: "CS2", feedBestOf: 3 }),
  });

  const merged = mergeEvents([e1, e2]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].matchFormat?.code, "BO3");
  assert.equal(merged[0].matchFormat?.origin, "feed");

  const picked = pickBestMatchFormat(
    extractMatchFormat({ sportKey: "basketball", leagueEn: "Unknown", }),
    extractMatchFormat({ sportKey: "basketball", leagueEn: "NBA", feedMinutes: 48 }),
  );
  assert.equal(picked?.code, "4×12");
  assert.equal(picked?.origin, "feed");

  const roundTrip = parseStoredMatchFormat(serializeMatchFormat(picked));
  assert.deepEqual(roundTrip, picked);
});

test("extractTournamentStage parses feed hints and league titles in EN/RU while ignoring match formats and URLs", () => {
  assert.deepEqual(extractTournamentStage({ leagueEn: "Germany. Bundesliga", feedHints: ["Tour 10"] }), {
    label: { en: "Tour 10", ru: "Тур 10" },
    origin: "feed",
  });
  assert.deepEqual(extractTournamentStage({ leagueEn: "Champions League", feedHints: ["Play-off. Round 1"] }), {
    label: { en: "Play-offs · Round 1", ru: "Плей-офф · Раунд 1" },
    origin: "feed",
  });
  assert.deepEqual(extractTournamentStage({ leagueEn: "England. League Cup. Quarterfinals" }), {
    label: { en: "Quarterfinals", ru: "Четвертьфинал" },
    origin: "title",
  });
  assert.deepEqual(extractTournamentStage({ leagueEn: "League", feedHints: [9] }), {
    label: { en: "Round 9", ru: "Тур 9" },
    origin: "feed",
  });
  assert.deepEqual(extractTournamentStage({ leagueEn: "League", feedHints: ["1/8 Final"] }), {
    label: { en: "1/8 Final", ru: "1/8 финала" },
    origin: "feed",
  });
  assert.deepEqual(extractTournamentStage({ leagueEn: "World Cup. Group B" }), {
    label: { en: "Group B", ru: "Группа B" },
    origin: "title",
  });
  assert.equal(
    extractTournamentStage({
      leagueEn: "Esports Battle (4x5min)",
      feedHints: ["4x10 min", "1670329", "Esports Battle (4x5min)", "https://example.com/stream"],
    }),
    null,
  );
  assert.equal(
    extractTournamentStage({
      leagueEn: "Brazil. NBB",
      feedHints: ["NBB"],
    }),
    null,
  );
});

test("parseVenueLocation and extractMatchVenueInfo normalize country, stadium, city, surface, and weather", () => {
  assert.deepEqual(parseVenueLocation("BayArena (Leverkusen)"), {
    stadium: "BayArena",
    city: "Leverkusen",
  });
  assert.deepEqual(parseVenueLocation("Center Court"), {
    venueRaw: "Center Court",
  });

  const full = extractMatchVenueInfo({
    country: "Germany",
    locationRaw: "BayArena (Leverkusen)",
    surface: "Grass",
    temperature: "+7°C",
    weather: "Cloudy",
    windSpeed: "4",
    windDir: "NW wind",
    humidity: "78",
  });
  assert.deepEqual(full, {
    country: "Germany",
    city: "Leverkusen",
    stadium: "BayArena",
    surface: { en: "Grass", ru: "Трава" },
    temperature: "+7°C",
    weather: "Cloudy",
    wind: "NW 4 m/s",
    humidity: "78%",
  });

  // Non-country regions, eSports/virtual categories, and empty notes collapse cleanly to null.
  assert.equal(extractMatchVenueInfo({ country: "World", note: "https://example.com" }), null);
  assert.equal(extractMatchVenueInfo({ country: "World Tennis Men" }), null);
  assert.equal(extractMatchVenueInfo({ country: "eFootball" }), null);
  assert.equal(extractMatchVenueInfo({ country: "IEsports Footballl" }), null);
  assert.equal(extractMatchVenueInfo({ country: "SIS Competitive Gaming" }), null);
});

test("mergeEvents merges tournamentStage and matchInfo across bookmakers and round-trips JSON storage", () => {
  const start = new Date(Date.now() + 2 * 3600_000);
  const stageTitle = extractTournamentStage({ leagueEn: "Spain. Copa del Rey. Quarterfinals" });
  const stageFeed = extractTournamentStage({ leagueEn: "Spain. Copa del Rey", feedHints: ["Quarterfinals"] });

  assert.equal(pickBestTournamentStage(stageTitle, stageFeed)?.origin, "feed");

  const infoA = extractMatchVenueInfo({ country: "Spain" });
  const infoB = extractMatchVenueInfo({ locationRaw: "Santiago Bernabeu (Madrid)", temperature: "14°C" });
  assert.deepEqual(mergeMatchVenueInfo(infoA, infoB), {
    country: "Spain",
    city: "Madrid",
    stadium: "Santiago Bernabeu",
    temperature: "14°C",
  });

  const e1 = makeEvent({
    source: "1xbet",
    externalId: "x-1",
    leagueName: { en: "Spain. Copa del Rey", ru: "Испания. Кубок" },
    home: { en: "Real Madrid", ru: "Реал Мадрид" },
    away: { en: "Valencia", ru: "Валенсия" },
    startsAt: start,
    tournamentStage: stageFeed,
    matchInfo: infoB,
  });
  const e2 = makeEvent({
    source: "vbet",
    externalId: "v-1",
    leagueName: { en: "Spain. Copa del Rey", ru: "Испания. Кубок" },
    home: { en: "Real Madrid", ru: "Реал Мадрид" },
    away: { en: "Valencia", ru: "Валенсия" },
    startsAt: start,
    tournamentStage: stageTitle,
    matchInfo: infoA,
  });

  const merged = mergeEvents([e1, e2]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tournamentStage?.label.en, "Quarterfinals");
  assert.equal(merged[0].matchInfo?.stadium, "Santiago Bernabeu");
  assert.equal(merged[0].matchInfo?.country, "Spain");

  assert.deepEqual(parseStoredTournamentStage(serializeTournamentStage(merged[0].tournamentStage)), merged[0].tournamentStage);
  assert.deepEqual(parseStoredMatchVenueInfo(serializeMatchVenueInfo(merged[0].matchInfo)), merged[0].matchInfo);
});

test("parseNewMarathonbetHtml extracts singles, doubles pairteam, category headers, and filters past events", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const futureIso = new Date(now + 4 * 3600_000).toISOString();
  const pastIso = new Date(now - 3600_000).toISOString();

  const sampleHtml = `
    <div data-test="cardsgroup">
      <div data-test="categorycard">
        <a data-test="link" href="/su/betting/champ/football/russia-premier-league">РПЛ</a>
      </div>
      <a data-test="event" href="/su/betting/event/football/russia-premier-league/orenburg-vs-baltika">
        <div data-test="team"><strong class="u-mobile-only">Оренбург</strong></div>
        <div data-test="team"><strong class="u-mobile-only">Балтика</strong></div>
        <time data-test="dateinfo" dateTime="${futureIso}"></time>
      </a>
      <a data-test="event" href="/su/betting/event/football/russia-premier-league/old-match-vs-past">
        <div data-test="team"><strong class="u-mobile-only">Старый</strong></div>
        <div data-test="team"><strong class="u-mobile-only">Прошедший</strong></div>
        <time data-test="dateinfo" dateTime="${pastIso}"></time>
      </a>
    </div>
    <div data-test="cardsgroup">
      <div data-test="categorycard">
        <a data-test="link" href="/su/betting/champ/tennis/atp-finals">Финал ATP</a>
      </div>
      <a data-test="event" href="/su/betting/event/tennis/atp-finals/m-arevalo-m-pavic-vs-c-harrison-n-skupski">
        <div data-test="pairteam"><strong>Аревало, Марсело</strong><strong>Павич, Мате</strong></div>
        <div data-test="pairteam"><strong>Харрисон, Кристиан</strong><strong>Скупски, Нил</strong></div>
        <time data-test="dateinfo" dateTime="${futureIso}"></time>
      </a>
    </div>
  `;

  const cats = extractNewMarathonCategoryLinks(sampleHtml);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].nameRu, "РПЛ");

  const footballEvents = parseNewMarathonbetHtml(sampleHtml, "Football", "Футбол", now);
  assert.equal(footballEvents.length, 2);

  assert.equal(footballEvents[0].source, "marathon");
  assert.equal(footballEvents[0].sourceHost, "new.marathonbet.ru");
  assert.equal(footballEvents[0].home.ru, "Оренбург");
  assert.equal(footballEvents[0].away.ru, "Балтика");
  assert.equal(footballEvents[0].home.en, "Orenburg");
  assert.equal(footballEvents[0].away.en, "Baltika");
  assert.equal(footballEvents[0].leagueName.ru, "РПЛ");

  assert.equal(footballEvents[1].home.ru, "Аревало, Марсело / Павич, Мате");
  assert.equal(footballEvents[1].away.ru, "Харрисон, Кристиан / Скупски, Нил");
  assert.equal(footballEvents[1].leagueName.ru, "Финал ATP");
});

test("extractWebSocketError surfaces concrete error messages and VBET_SWARM_MIRRORS provides multi-domain failover", () => {
  assert.ok(VBET_SWARM_MIRRORS.length >= 3);
  assert.ok(VBET_SWARM_MIRRORS.some((m) => m.host === "sport.vbet.com"));
  assert.ok(VBET_SWARM_MIRRORS.some((m) => m.host === "sport.vbet.am"));
  assert.equal(extractWebSocketError({ error: { cause: { message: "ECONNRESET" } } }), "ECONNRESET");
  assert.equal(extractWebSocketError({ message: "TLS handshake failed" }), "TLS handshake failed");
  assert.equal(extractWebSocketError({ code: 1006 }), "WebSocket closed (1006)");
});





