/**
 * Every amount reads to the cent, the same on screen and in the file: the front end's money text is
 * run over the one table of cases the back end's `money_text` is run over
 * (`back-end/tests/fixtures/money_texts.json`), so a case added there is checked on both sides.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { money } from '@/utils/payments';
import { CURRENCIES, formatPrice } from '@/utils/pricing';

type MoneyText = { cents: number; currency: string | null; text: string };

// Resolved from the project root rather than `import.meta.url`, as `contrast.test.ts` reads its file.
const MONEY_TEXTS: MoneyText[] = JSON.parse(
  readFileSync(resolvePath(process.cwd(), '../back-end/tests/fixtures/money_texts.json'), 'utf8'),
);

describe('an amount reads to the cent', () => {
  it.each(MONEY_TEXTS.map((c) => [c.text, c] as const))(
    '%s',
    (_text, { cents, currency, text }) => {
      expect(money(cents, { currency })).toBe(text);
    },
  );

  it.each(MONEY_TEXTS.filter((c) => c.cents >= 0 && c.currency).map((c) => [c.text, c] as const))(
    '%s is the price formatter too',
    (_text, { cents, currency, text }) => {
      expect(formatPrice(cents, currency as string)).toBe(text);
    },
  );

  it('the table reads every offered currency', () => {
    const read = new Set(MONEY_TEXTS.map((c) => c.currency));
    expect(CURRENCIES.filter((c) => !read.has(c.code))).toEqual([]);
  });
});
