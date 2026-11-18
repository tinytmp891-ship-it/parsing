/**
 * Colours for partially matched and checked matches, stored as #rrggbb strings.
 */

export const DEFAULT_PARTIAL_COLOR = "#f59e0b";
export const DEFAULT_CHECKED_COLOR = "#22c55e";

/** How much of the chosen colour shows. The page surface shows through, so text stays readable in both themes. */
const TINT_ALPHA = 0.45;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

/** Returns a lowercase #rrggbb colour, or the fallback when the value is not a valid colour. */
export function normalizeHex(value: string | null | undefined, fallback: string): string {
  return value && HEX_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

/** Translucent version of a #rrggbb colour, used for row backgrounds. */
export function tintOf(hex: string): string {
  if (!HEX_PATTERN.test(hex)) return "transparent";
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${TINT_ALPHA})`;
}
