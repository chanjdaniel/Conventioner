/**
 * An applicant's answer, cut where it names a web address, so each address can be a link.
 *
 * A reviewer judges a vendor by their portfolio, and the portfolio is a link in an answer: on the
 * review card it was plain text, so every one of 225 had to be copied into a new tab by hand
 * (E26 re-walk).
 *
 * Only `http:` and `https:` ever become a link. The answer is the applicant's own text, so this is
 * the line between "a link to their shop" and a `javascript:` address planted in a form.
 */
export interface AnswerSegment {
  text: string;
  /** Set only on an address, and only one this module has parsed as http or https. */
  href?: string;
}

const ADDRESS = /https?:\/\/[^\s<>"]+/gi;

/** What ends a sentence after an address is not part of it: "see https://shop.example." */
const TRAILING = /[.,;:!?'"]+$/;

/** The address with the punctuation after it removed, and a ")" kept only when it closes a "(". */
function trimmed(found: string): string {
  let address = found;
  for (;;) {
    const before = address;
    address = address.replace(TRAILING, '');
    const opens = (address.match(/\(/g) ?? []).length;
    const closes = (address.match(/\)/g) ?? []).length;
    if (address.endsWith(')') && closes > opens) address = address.slice(0, -1);
    if (address === before) return address;
  }
}

function webAddress(text: string): string | undefined {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function answerSegments(value: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let from = 0;
  for (const match of value.matchAll(ADDRESS)) {
    const address = trimmed(match[0]);
    const href = webAddress(address);
    if (!href) continue;
    const at = match.index ?? 0;
    if (at > from) segments.push({ text: value.slice(from, at) });
    segments.push({ text: address, href });
    from = at + address.length;
  }
  if (from < value.length) segments.push({ text: value.slice(from) });
  return segments;
}
