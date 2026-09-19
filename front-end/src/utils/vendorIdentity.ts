/**
 * How the product names a vendor, in one place.
 *
 * The rule, from readable-journey ticket 02: **name primary, email secondary, and never name
 * instead of email.** Two vendors can share a name; the address is guaranteed unique and
 * guaranteed present, it is what check-in matches on, and it is what ties a vendor back to their
 * application. At a door someone is reading it off a phone.
 *
 * **A vendor with no name falls back to the email** and looks exactly like the product did before
 * names existed. That is the floor: this ships without making any existing market look worse, and
 * no vendor is decorated with "Unnamed vendor".
 */

/** Email address to the name that application stored, as the server reports it. */
export type VendorNames = Readonly<Record<string, string>>;

/** The one key both sides match on. Every writer lowercases; so does every reader. */
function normalized(email: string | null | undefined): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

/** This vendor's stored name, or an empty string when their application has none. */
export function vendorName(email: string | null | undefined, names: VendorNames): string {
  return names[normalized(email)] ?? '';
}

/**
 * The line that leads: the name when there is one, the address when there is not.
 *
 * For a surface that shows only one line. Anywhere with room for two shows this AND the address.
 */
export function vendorHeadline(email: string | null | undefined, names: VendorNames): string {
  return vendorName(email, names) || String(email ?? '').trim();
}

/** Does this vendor answer to what was typed in a search box? Name and address, both. */
export function vendorMatches(
  query: string,
  email: string | null | undefined,
  names: VendorNames,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const address = normalized(email);
  const name = vendorName(email, names).toLowerCase();
  return address.includes(needle) || name.includes(needle);
}
