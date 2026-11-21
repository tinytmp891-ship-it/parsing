import type { Lang } from "./i18n";

const en = {
  title: "Check your matches",
  subtitle:
    "Paste match lines (one per line). Each team is compared with the matches starting in the next 24 hours across all bookmakers.",
  legend: "Green: both teams found · Yellow: one team found · Red: not found in the next 24 hours",
  placeholder: "Paste match lines here, one per line…",
  check: "Check matches",
  checking: "Checking…",
  clear: "Clear",
  sample: "Insert example",
  summary: (green: number, yellow: number, red: number) => `Green: ${green} · Yellow: ${yellow} · Red: ${red}`,
  green: "Both teams found",
  yellow: "One team found",
  red: "Not found in the next 24 hours",
  invalid: "Could not read two team names",
  schedule: "Schedule",
  noSchedule: "No matching match starts in the next 24 hours.",
  sameId: "Same 1xBet ID",
  empty: "Paste at least one match line.",
  failed: "Check failed",
  schedulePrefix: (n: number) => `Checked against ${n.toLocaleString("en-US")} events starting in the next 24 hours`,
  allStartAt: (time: string) => `All found matches start at ${time}`,
  allStartInHour: (hour: string) => `All found matches start in the ${hour}:00 hour`,
  kickoffTime: "Start time",
};

export type CheckerDict = typeof en;

const ru: CheckerDict = {
  title: "Проверка матчей",
  subtitle:
    "Вставьте строки матчей (по одной на строку). Каждая команда сверяется с матчами, которые начинаются в ближайшие 24 часа, у всех букмекеров.",
  legend: "Зелёный: обе команды найдены · Жёлтый: найдена одна команда · Красный: в ближайшие 24 часа не найдено",
  placeholder: "Вставьте строки матчей сюда, по одной на строку…",
  check: "Проверить",
  checking: "Проверка…",
  clear: "Очистить",
  sample: "Вставить пример",
  summary: (green: number, yellow: number, red: number) =>
    `Зелёных: ${green} · Жёлтых: ${yellow} · Красных: ${red}`,
  green: "Обе команды найдены",
  yellow: "Найдена одна команда",
  red: "Не найдено в ближайшие 24 часа",
  invalid: "Не удалось разобрать две команды",
  schedule: "В расписании",
  noSchedule: "Подходящего матча, который начнётся в ближайшие 24 часа, нет.",
  sameId: "Совпал ID 1xBet",
  empty: "Вставьте хотя бы одну строку матча.",
  failed: "Ошибка проверки",
  schedulePrefix: (n: number) => `Проверено по ${n.toLocaleString("ru-RU")} событиям, которые начнутся в ближайшие 24 часа`,
  allStartAt: (time: string) => `Все найденные матчи начинаются в ${time}`,
  allStartInHour: (hour: string) => `Все найденные матчи начинаются в ${hour}:00–${hour}:59`,
  kickoffTime: "Время начала",
};

export const checkerDictionaries: Record<Lang, CheckerDict> = { en, ru };
