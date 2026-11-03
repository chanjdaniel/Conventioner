/**
 * The Pricing card's money, in cents and in the market's currency (E43/F01/S01).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  CURRENCIES,
  centsFromText,
  focusedAmountText,
  groupNameProblem,
  leftAmountText,
  priceLine,
  priceText,
  pricingAfterTierChange,
} from '@/utils/pricing';
import type { PricingObject } from '@/assets/types/datatypes';

type MoneyText = { cents: number; currency: string | null; text: string };

// The table of cases both sides read (`moneyTexts.test.ts`), from the project root.
const MONEY_TEXTS: MoneyText[] = JSON.parse(
  readFileSync(resolvePath(process.cwd(), '../back-end/tests/fixtures/money_texts.json'), 'utf8'),
);

const PRICED: PricingObject = {
  currency: 'CAD',
  halfTablePercent: 50,
  everyoneElse: [
    { tier: 'Gold', cents: 3500 },
    { tier: 'Silver', cents: 3000 },
  ],
};

describe('a price reads in the market currency', () => {
  // What each amount reads is pinned by the table both sides read, in `moneyTexts.test.ts`.
  it('offers Canadian dollars first, the default', () => {
    expect(CURRENCIES[0].code).toBe('CAD');
  });
});

describe('the date card says what the assignment costs', () => {
  it('names the tier, the size and the price', () => {
    expect(priceLine({ tier: 'Gold', tableChoice: 'Full Table', priceCents: 3500 }, 'CAD')).toBe(
      'Gold, full table, $35.00',
    );
    expect(
      priceLine({ tier: 'Silver', tableChoice: 'Half Table (Left)', priceCents: 1500 }, 'CAD'),
    ).toBe('Silver, half table, $15.00');
  });

  it('says nothing for an assignment with no price', () => {
    expect(priceLine({ tier: 'Gold', tableChoice: 'Full Table', priceCents: null }, 'CAD')).toBe(
      null,
    );
    expect(priceLine({ tier: 'Gold', tableChoice: 'Full Table' }, 'CAD')).toBe(null);
  });

  it('names the price group that set it (E43/F01/S02)', () => {
    expect(
      priceLine(
        {
          tier: 'Gold',
          tableChoice: 'Full Table',
          priceCents: 1200,
          priceGroup: 'Example College student + club member',
        },
        'CAD',
      ),
    ).toBe('Gold, full table, Example College student + club member, $12.00');
    expect(
      priceLine(
        {
          tier: 'Silver',
          tableChoice: 'Full Table',
          priceCents: 3000,
          priceGroup: 'Everyone else',
        },
        'CAD',
      ),
    ).toBe('Silver, full table, Everyone else, $30.00');
  });

  it('leaves the tier out where the table has none', () => {
    expect(priceLine({ tier: '', tableChoice: 'Full Table', priceCents: 1000 }, 'CAD')).toBe(
      'Full table, $10.00',
    );
  });
});

describe('a typed amount becomes cents', () => {
  it.each([
    ['35', 3500],
    ['35.5', 3550],
    ['35.50', 3550],
    ['0', 0],
    [' 12.05 ', 1205],
    ['$30', 3000],
    ['50', 5000],
    ['50.5', 5050],
    ['$50', 5000],
    ['$1,234.50', 123450],
    ['1,234.50', 123450],
    ['1234.50', 123450],
    ['US$50.00', 5000],
    ['€ 50', 5000],
    ['£50', 5000],
    ['A$50', 5000],
    ['NZ$1,500.50', 150050],
    ['$100,000.00', 10_000_000],
  ])('%s is %s cents', (text, cents) => {
    expect(centsFromText(text)).toBe(cents);
  });

  it('a blank cell is no price', () => {
    expect(centsFromText('')).toBe(null);
    expect(centsFromText('  ')).toBe(null);
  });

  it.each([
    'abc',
    '-5',
    '-$5',
    '$-5',
    '35.555',
    '1.2.3',
    '35,50',
    '1,23',
    '1,2345',
    ',123',
    '1,234,',
    '$$5',
    'US$$5',
    '$US50',
    '5$',
    '$',
    '$ ',
    '$.50',
    'C$50',
    '$100,000.01',
  ])('%s is not an amount', (text) => {
    expect(centsFromText(text)).toBe(undefined);
  });

  it.each(MONEY_TEXTS.filter((c) => c.cents >= 0).map((c) => [c.text, c.cents] as const))(
    '%s, as the app writes it, reads back as %d cents',
    (text, cents) => {
      // The cases past the most one table-day may cost are no price a cell takes.
      expect(centsFromText(text)).toBe(cents <= 10_000_000 ? cents : undefined);
    },
  );

  it('a stored price reads back as a plain number to the cent', () => {
    expect(priceText(3500)).toBe('35.00');
    expect(priceText(3550)).toBe('35.50');
    expect(priceText(5)).toBe('0.05');
    expect(priceText(0)).toBe('0.00');
    expect(priceText(null)).toBe('');
    expect(priceText(undefined)).toBe('');
  });
});

describe('an amount field reads as currency once left, and the number while focused', () => {
  it.each([
    ['$1,234.50', '1234.50'],
    ['50', '50.00'],
    ['$50', '50.00'],
    ['US$100,000.00', '100000.00'],
    ['0', '0.00'],
    ['', ''],
    ['3x', '3x'],
    ['35,50', '35,50'],
  ])('focused, %j reads %j', (text, focused) => {
    expect(focusedAmountText(text)).toBe(focused);
  });

  it.each([
    ['50', 'CAD', '$50.00'],
    ['50.5', 'CAD', '$50.50'],
    ['1234.5', 'CAD', '$1,234.50'],
    ['50', 'USD', 'US$50.00'],
    ['$50', 'EUR', '€50.00'],
    ['0', 'CAD', '$0.00'],
    ['', 'CAD', ''],
    ['3x', 'CAD', '3x'],
    ['-5', 'CAD', '-5'],
  ])('left, %j in %s reads %j', (text, currency, left) => {
    expect(leftAmountText(text, currency)).toBe(left);
  });

  it('a blank of spaces stays blank either way', () => {
    expect(focusedAmountText('  ')).toBe('');
    expect(leftAmountText('  ', 'CAD')).toBe('');
  });
});

describe('the prices follow the tiers they price', () => {
  it('a renamed tier keeps its price', () => {
    const after = pricingAfterTierChange(PRICED, ['Gold', 'Silver'], ['Golden', 'Silver']);

    expect(after?.everyoneElse).toEqual([
      { tier: 'Golden', cents: 3500 },
      { tier: 'Silver', cents: 3000 },
    ]);
  });

  it('a removed tier takes its price with it', () => {
    const after = pricingAfterTierChange(PRICED, ['Gold', 'Silver'], ['Silver']);

    expect(after?.everyoneElse).toEqual([{ tier: 'Silver', cents: 3000 }]);
  });

  it('reordering the tiers changes no price', () => {
    expect(pricingAfterTierChange(PRICED, ['Gold', 'Silver'], ['Silver', 'Gold'])).toBe(PRICED);
  });

  it('a new tier has no price yet', () => {
    expect(pricingAfterTierChange(PRICED, ['Gold', 'Silver'], ['Gold', 'Silver', ''])).toBe(PRICED);
  });

  it('a market with no pricing stays without', () => {
    expect(pricingAfterTierChange(null, ['Gold'], ['Golden'])).toBe(null);
    expect(pricingAfterTierChange(undefined, ['Gold'], ['Golden'])).toBe(undefined);
  });

  it('a name typed onto a tier that is already priced does not take its price', () => {
    // Two tiers both named Gold mid-typing: one price, never two for one tier.
    const after = pricingAfterTierChange(PRICED, ['Gold', 'Silver'], ['Gold', 'Gold']);

    expect(after?.everyoneElse).toEqual([{ tier: 'Gold', cents: 3500 }]);
  });
});

describe("a group's prices follow the tiers too", () => {
  const GROUPED: PricingObject = {
    ...PRICED,
    groups: [
      {
        name: 'Students',
        conditions: [{ key: 'affiliation', answers: ['Student'] }],
        prices: [
          { tier: 'Gold', cents: 1500 },
          { tier: 'Silver', cents: 1300 },
        ],
      },
    ],
  };

  it('a renamed tier keeps each group its price', () => {
    const after = pricingAfterTierChange(GROUPED, ['Gold', 'Silver'], ['Golden', 'Silver']);

    expect(after?.groups?.[0].prices).toEqual([
      { tier: 'Golden', cents: 1500 },
      { tier: 'Silver', cents: 1300 },
    ]);
    expect(after?.groups?.[0].conditions).toEqual(GROUPED.groups?.[0].conditions);
  });

  it("a removed tier takes each group's price with it", () => {
    const after = pricingAfterTierChange(GROUPED, ['Gold', 'Silver'], ['Silver']);

    expect(after?.groups?.[0].prices).toEqual([{ tier: 'Silver', cents: 1300 }]);
  });

  it('reordering the tiers changes nothing', () => {
    expect(pricingAfterTierChange(GROUPED, ['Gold', 'Silver'], ['Silver', 'Gold'])).toBe(GROUPED);
  });
});

describe("a group's name", () => {
  const names = ['Example College student only', 'Alumni'];

  it('is needed', () => {
    expect(groupNameProblem('  ', names, 0)).toBe('Name this group.');
  });

  it('is its own, whatever its case', () => {
    expect(groupNameProblem('alumni ', names, 0)).toBe('Another group is called this.');
    expect(groupNameProblem('Alumni', names, 1)).toBe(null);
  });

  it("is never the last row's", () => {
    expect(groupNameProblem('Everyone Else', names, 0)).toBe('"Everyone else" is the last row.');
  });
});
