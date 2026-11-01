/**
 * Words with an address in them, cut so the screen keeps each address readable (T137 review note
 * 7, T181): it breaks, if a line is too narrow for it, only before its "@" or before a dot, never
 * at a hyphen inside a name. The history's table and sentences and the review's words
 * (`reviewers.ts`) all draw their addresses through `EmailAddress.vue`, which reads these parts.
 */

/** A piece of words as drawn: words, or an address split at its "@". */
export type AddressPart =
  { kind: 'text'; text: string } | { kind: 'address'; local: string; domain: string };

/** An address, its domain ending on a letter or digit, so a sentence's full stop stays words. */
const ADDRESS = /[^\s@,;()]+@[^\s@,;()]+\.[^\s@,;()]*[^\s@,;().]/g;

/**
 * Words' pieces, each address apart, so the screen keeps the part before the "@" and the part from
 * it whole.
 */
export function addressParts(value: string): AddressPart[] {
  const parts: AddressPart[] = [];
  let at = 0;
  for (const match of value.matchAll(ADDRESS)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ kind: 'text', text: value.slice(at, start) });
    const split = match[0].indexOf('@');
    parts.push({ kind: 'address', local: match[0].slice(0, split), domain: match[0].slice(split) });
    at = start + match[0].length;
  }
  if (at < value.length) parts.push({ kind: 'text', text: value.slice(at) });
  return parts;
}

/**
 * A part of an address cut before each of its dots, so a line too narrow for the part breaks it
 * at a dot ("@example" then ".com") before it breaks inside a word.
 */
export function dotPieces(part: string): string[] {
  return part.split(/(?=\.)/).filter(Boolean);
}

/** A run of a piece of an address: a hyphen and the character after it are held together. */
export interface HyphenRun {
  text: string;
  /** A hyphen with what follows it, which the screen keeps on one line. */
  held: boolean;
}

/**
 * A piece of an address cut around each hyphen, the hyphen held to the character after it, so a
 * line never ends at a hyphen inside a name ("rv-sam" never breaks to "rv-" and "sam").
 */
export function hyphenRuns(piece: string): HyphenRun[] {
  const runs: HyphenRun[] = [];
  let at = 0;
  for (const match of piece.matchAll(/-+[^-]?/g)) {
    const start = match.index ?? 0;
    if (start > at) runs.push({ text: piece.slice(at, start), held: false });
    runs.push({ text: match[0], held: true });
    at = start + match[0].length;
  }
  if (at < piece.length) runs.push({ text: piece.slice(at), held: false });
  return runs;
}

/** The words the parts draw, as one string: what the accessible name reads, and a test compares. */
export function partsText(parts: readonly AddressPart[]): string {
  return parts
    .map((part) => (part.kind === 'text' ? part.text : part.local + part.domain))
    .join('');
}
