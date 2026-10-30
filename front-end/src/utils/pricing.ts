/**
 * The Pricing card's money (E43/F01/S01): a full table's price per day for each tier, in cents and
 * in the market's one currency, and what an assignment costs as the drawer's date cards say it.
 *
 * The back end is the authority: it prices each assignment (`back-end/pricing.py`, served on the tables
 * read) and refuses a plan whose prices it would not keep. This only reads and writes the card.
 */
import type { PricingObject } from '@/assets/types/datatypes';

/** The currencies the card offers, as `PRICING_CURRENCIES` in `back-end/datatypes.py` lists them. */
export const CURRENCIES: readonly { code: string; name: string }[] = [
  { code: 'CAD', name: 'Canadian dollars' },
  { code: 'USD', name: 'US dollars' },
  { code: 'EUR', name: 'Euros' },
  { code: 'GBP', name: 'Pounds sterling' },
  { code: 'AUD', name: 'Australian dollars' },
  { code: 'NZD', name: 'New Zealand dollars' },
];

/** The card a market starts from before anything is typed: Canadian dollars, half off. */
export const UNPRICED: PricingObject = { currency: 'CAD', halfTablePercent: 50, everyoneElse: [] };

/** The most one table-day may cost, as the server holds it: $100,000. */
const MOST_CENTS = 10_000_000;

/** An amount in the market's currency: "$35", or "$15.01" where there are cents. */
export function formatPrice(cents: number, currency: string): string {
  const fraction = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(cents / 100);
}

/** One assignment as its date card prices it: "Gold, full table, $35"; null where it has no price. */
export function priceLine(
  assignment: { tier: string; tableChoice: string; priceCents?: number | null },
  currency: string,
): string | null {
  if (assignment.priceCents == null) return null;
  const size = /half/i.test(assignment.tableChoice) ? 'half table' : 'full table';
  const parts = [assignment.tier.trim(), size, formatPrice(assignment.priceCents, currency)].filter(
    Boolean,
  );
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * A typed amount as cents: null for a blank cell (no price), undefined for text that is not an
 * amount. Whole units or two decimals, an optional leading "$".
 */
export function centsFromText(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents <= MOST_CENTS ? cents : undefined;
}

/** A typed half-table share: a whole percent from 0 to 100, or undefined for anything else. */
export function percentFromText(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const percent = Number(trimmed);
  return percent <= 100 ? percent : undefined;
}

/** A stored price as the cell shows it: "35", "35.50"; blank where there is none. */
export function priceText(cents: number | null | undefined): string {
  if (cents == null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * The prices once the tiers changed from `before` to `after`, the names in order: a tier renamed
 * in place keeps its price, a removed tier's price goes, and a tier never has two. The same object
 * where nothing changed, so a caller writes only a real change.
 */
export function pricingAfterTierChange<P extends PricingObject | null | undefined>(
  pricing: P,
  before: readonly string[],
  after: readonly string[],
): P {
  if (!pricing) return pricing;
  let prices = pricing.everyoneElse;
  const renamed =
    before.length === after.length
      ? before.flatMap((name, i) => (name !== after[i] ? [i] : []))
      : [];
  if (renamed.length === 1) {
    const from = before[renamed[0]];
    const to = after[renamed[0]];
    if (!after.includes(from) && !prices.some((price) => price.tier === to)) {
      prices = prices.map((price) => (price.tier === from ? { ...price, tier: to } : price));
    }
  }
  const tiers = new Set(after);
  const kept = prices.filter(
    (price, i) => tiers.has(price.tier) && prices.findIndex((p) => p.tier === price.tier) === i,
  );
  const same =
    kept.length === pricing.everyoneElse.length &&
    kept.every((price, i) => price === pricing.everyoneElse[i]);
  return same ? pricing : ({ ...pricing, everyoneElse: kept } as P);
}
