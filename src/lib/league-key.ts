/**
 * Stable key for a tournament (league), shared by the API and the page.
 * Format: "<sportKey>/<slug>", where the slug comes from the English league name.
 */

const KEY_PATTERN = /^[a-z0-9-]{1,60}\/[a-z0-9-]{1,100}$/;

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return `h${(hash >>> 0).toString(36)}`;
}

export function leagueKeyOf(sportKey: string, leagueEn: string): string {
  const slug = leagueEn
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  return `${sportKey}/${slug || hashText(leagueEn)}`;
}

export function isLeagueKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export function sportKeyOfLeague(key: string): string {
  return key.split("/")[0] ?? "";
}
