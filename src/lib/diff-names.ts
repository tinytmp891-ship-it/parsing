import { ageGroupOf, normalizeName, teamSimilarity } from "./sources/model";

export type DiffSegment = {
  text: string;
  /**
   * - "match": the whole team/player name matches the reference (render underlined)
   * - "same": a shared word inside a differing team/player name (render normal/underlined)
   * - "diff": differing part of a team/player name (render in red)
   * - "neutral": whitespace/punctuation or ignored equivalent marker like U19/(19)/(w)/(women)
   */
  kind: "match" | "same" | "diff" | "neutral";
};

const SIDE_THRESHOLD = 0.8;

const EQUIV_TAG_RE =
  /(\(\s*(?:u[\s-]?\d{1,2}|under[\s-]?\d{1,2}|1[4-9]|2[0-3]|w\.?|women|wom\.?|ladies|fem|ж|жен)\s*\)|\b(?:u[\s-]?\d{1,2}|under[\s-]?\d{1,2}|до[\s-]+\d{1,2}|women|wom\.?|ladies|жен|женщины)\b)/giu;

function markerKey(token: string): string | null {
  const age = ageGroupOf(token);
  if (age) return `age:${age}`;
  const lower = token.toLowerCase().replace(/[().\s]/g, "");
  if (["w", "women", "wom", "ladies", "fem", "ж", "жен", "женщины"].includes(lower)) {
    return "gender:women";
  }
  return null;
}

function extractMarkers(text: string): Set<string> {
  const set = new Set<string>();
  const matches = text.match(EQUIV_TAG_RE);
  if (!matches) return set;
  for (const m of matches) {
    const key = markerKey(m);
    if (key) set.add(key);
  }
  return set;
}

function normWord(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е");
}

function tokenizePreservingSpacing(text: string): { text: string; type: "tag" | "word" | "sep"; marker?: string }[] {
  const tokens: { text: string; type: "tag" | "word" | "sep"; marker?: string }[] = [];
  let cursor = 0;

  const pushPlain = (slice: string) => {
    const wordOrSep = /([\p{L}\p{N}]+|[^\p{L}\p{N}]+)/gu;
    let m: RegExpExecArray | null;
    while ((m = wordOrSep.exec(slice)) !== null) {
      const part = m[0];
      const isWord = /^[\p{L}\p{N}]+$/u.test(part);
      tokens.push({ text: part, type: isWord ? "word" : "sep" });
    }
  };

  EQUIV_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EQUIV_TAG_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      pushPlain(text.slice(cursor, match.index));
    }
    const rawTag = match[0];
    const key = markerKey(rawTag);
    if (key) {
      tokens.push({ text: rawTag, type: "tag", marker: key });
    } else {
      pushPlain(rawTag);
    }
    cursor = match.index + rawTag.length;
  }
  if (cursor < text.length) {
    pushPlain(text.slice(cursor));
  }
  return tokens;
}

function isWordMatched(word: string, refWords: string[], individual: boolean): boolean {
  const nw = normWord(word);
  if (!nw) return true;
  if (refWords.includes(nw)) return true;
  if (individual && nw.length === 1) {
    return refWords.some((rw) => rw.startsWith(nw));
  }
  if (individual && nw.length >= 2) {
    return refWords.some((rw) => rw.length === 1 && nw.startsWith(rw));
  }
  return false;
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === seg.kind) {
      prev.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/**
 * Produces segments for rendering `candidate` compared against `reference`:
 * - If the two team/player names match (>= SIDE_THRESHOLD after normalizing U19/(19)/(w)/(women)/initials),
 *   the whole side is marked `"match"` (underlined in UI).
 * - Otherwise, differing parts are marked `"diff"` (highlighted in red), shared words `"same"`,
 *   and equivalent age/women markers `"neutral"` so they aren't falsely flagged in red.
 */
export function diffSideName(
  reference: string,
  candidate: string,
  options?: { individual?: boolean },
): { matched: boolean; segments: DiffSegment[] } {
  const refNorm = normalizeName(reference);
  const candNorm = normalizeName(candidate);
  const individual = options?.individual ?? false;

  if (!candidate) return { matched: false, segments: [] };
  if (!reference) return { matched: false, segments: [{ text: candidate, kind: "neutral" }] };

  const score = teamSimilarity(refNorm, candNorm, { individual });
  if (score >= SIDE_THRESHOLD) {
    return { matched: true, segments: [{ text: candidate, kind: "match" }] };
  }

  const refMarkers = extractMarkers(reference);
  const refWords = refNorm.split(" ").filter(Boolean);
  const tokens = tokenizePreservingSpacing(candidate);

  const rawSegments: DiffSegment[] = tokens.map((tok) => {
    if (tok.type === "sep") return { text: tok.text, kind: "neutral" };
    if (tok.type === "tag" && tok.marker && refMarkers.has(tok.marker)) {
      return { text: tok.text, kind: "neutral" };
    }
    if (tok.type === "tag") {
      // Tag present in candidate only; ignore age/women markers when both mean U19 or women,
      // or mark differing tag as diff if it's a genuinely different marker (e.g. U18 vs U20).
      return { text: tok.text, kind: refMarkers.size === 0 ? "neutral" : "diff" };
    }
    const matched = isWordMatched(tok.text, refWords, individual);
    return { text: tok.text, kind: matched ? "same" : "diff" };
  });

  // Merge whitespace between two adjacent "diff" segments so multi-word differing team names
  // highlight cleanly as a single continuous red span.
  for (let i = 1; i < rawSegments.length - 1; i += 1) {
    if (
      rawSegments[i].kind === "neutral" &&
      /^\s+$/.test(rawSegments[i].text) &&
      rawSegments[i - 1].kind === "diff" &&
      rawSegments[i + 1].kind === "diff"
    ) {
      rawSegments[i].kind = "diff";
    }
  }

  return { matched: false, segments: mergeAdjacent(rawSegments) };
}
