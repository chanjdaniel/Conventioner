/**
 * The Pricing card's money (E43/F01/S01, S02): a full table's price per day for each tier and each
 * row of the card, in cents and in the market's one currency, and what an assignment costs as the
 * drawer's date cards say it.
 *
 * The back end is the authority: it prices each assignment (`back-end/pricing.py`, served on the tables
 * read) and refuses a plan whose prices it would not keep. This only reads and writes the card.
 */
import type { PriceGroup, PricingObject, TierPrice } from '@/assets/types/datatypes';

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
export const UNPRICED: PricingObject = {
  currency: 'CAD',
  halfTablePercent: 50,
  groups: [],
  everyoneElse: [],
};

/** The card's fixed last row, for a vendor in no group, as `EVERYONE_ELSE` in `back-end/pricing.py`. */
export const EVERYONE_ELSE = 'Everyone else';

/** The card's groups; none on a card saved before there were any. */
export function groupsOf(pricing: PricingObject | null | undefined): PriceGroup[] {
  return pricing?.groups ?? [];
}

/**
 * What is wrong with `name` as the name of the group at `index` among `names`, in the card's words,
 * or null: a group needs a name, its own, and never the last row's (`pricing_refusal` refuses each).
 */
export function groupNameProblem(
  name: string,
  names: readonly string[],
  index: number,
): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return 'Name this group.';
  if (key === EVERYONE_ELSE.toLowerCase()) return `"${EVERYONE_ELSE}" is the last row.`;
  const taken = names.some((other, i) => i !== index && other.trim().toLowerCase() === key);
  return taken ? 'Another group is called this.' : null;
}

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

/**
 * One assignment as its date card prices it: "Gold, full table, $35", or with the card's row that
 * set it where the card has groups, "Gold, full table, Example College student + club member, $12"; null where
 * it has no price.
 */
export function priceLine(
  assignment: {
    tier: string;
    tableChoice: string;
    priceCents?: number | null;
    priceGroup?: string | null;
  },
  currency: string,
): string | null {
  if (assignment.priceCents == null) return null;
  const size = /half/i.test(assignment.tableChoice) ? 'half table' : 'full table';
  const parts = [
    assignment.tier.trim(),
    size,
    assignment.priceGroup ?? '',
    formatPrice(assignment.priceCents, currency),
  ].filter(Boolean);
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * A typed amount as cents: null for a blank cell (no price), undefined for text that is not an
 * amount. Whole units or one or two decimals, an optional leading "$".
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
 * The one tier renamed in place when the tiers changed from `before` to `after`, the names in
 * order, as `[from, to]`; null when the change was anything else, or `from` is still a tier.
 */
export function tierRenamed(
  before: readonly string[],
  after: readonly string[],
): readonly [string, string] | null {
  if (before.length !== after.length) return null;
  const changed = before.flatMap((name, i) => (name !== after[i] ? [i] : []));
  if (changed.length !== 1) return null;
  const [from, to] = [before[changed[0]], after[changed[0]]];
  return after.includes(from) ? null : [from, to];
}

/**
 * A row's prices once the tiers changed from `before` to `after`: a tier renamed in place keeps its
 * price, a removed tier's price goes, and a tier never has two. The same array where nothing changed.
 */
function pricesAfterTierChange(
  prices: TierPrice[],
  before: readonly string[],
  after: readonly string[],
): TierPrice[] {
  let moved = prices;
  const renamed = tierRenamed(before, after);
  if (renamed) {
    const [from, to] = renamed;
    if (!moved.some((price) => price.tier === to)) {
      moved = moved.map((price) => (price.tier === from ? { ...price, tier: to } : price));
    }
  }
  const tiers = new Set(after);
  const kept = moved.filter(
    (price, i) => tiers.has(price.tier) && moved.findIndex((p) => p.tier === price.tier) === i,
  );
  const same = kept.length === prices.length && kept.every((price, i) => price === prices[i]);
  return same ? prices : kept;
}

/**
 * The prices once the tiers changed from `before` to `after`, the names in order, "Everyone else"'s
 * and each group's: a tier renamed in place keeps its price, a removed tier's price goes, and a
 * tier never has two. The same object where nothing changed, so a caller writes only a real change.
 */
export function pricingAfterTierChange<P extends PricingObject | null | undefined>(
  pricing: P,
  before: readonly string[],
  after: readonly string[],
): P {
  if (!pricing) return pricing;
  const everyoneElse = pricesAfterTierChange(pricing.everyoneElse, before, after);
  const groups = groupsOf(pricing).map((group) => {
    const prices = pricesAfterTierChange(group.prices, before, after);
    return prices === group.prices ? group : { ...group, prices };
  });
  const same =
    everyoneElse === pricing.everyoneElse &&
    groups.every((group, i) => group === groupsOf(pricing)[i]);
  if (same) return pricing;
  return { ...pricing, everyoneElse, ...(pricing.groups ? { groups } : {}) } as P;
}
