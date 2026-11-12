/**
 * The Money section's card (T201): owed, paid and still owed, the Payments page's figures, and one
 * bar of paid against owed; still owed links to Payments on Owes, and a zero is told, not linked.
 */
import { describe, expect, it } from 'vitest';
import { moneyCard } from '@/utils/moneyCard';

const MONEY = { currency: 'CAD', owedCents: 145000, paidCents: 90000, stillOwedCents: 55000 };

describe('moneyCard', () => {
  it('reads owed, paid and still owed to the cent, in that order', () => {
    const card = moneyCard(MONEY, 'm-1')!;

    expect(card.figures.map(({ id, label, amount }) => ({ id, label, amount }))).toEqual([
      { id: 'owed', label: 'Owed', amount: '$1,450.00' },
      { id: 'paid', label: 'Paid', amount: '$900.00' },
      { id: 'stillOwed', label: 'Still owed', amount: '$550.00' },
    ]);
  });

  it('links still owed to Payments on Owes, and nothing else', () => {
    const card = moneyCard(MONEY, 'm-1')!;

    expect(card.figures.map((figure) => figure.to)).toEqual([
      null,
      null,
      { path: '/markets/m-1/payments', query: { show: 'owes' } },
    ]);
  });

  it('tells nothing still owed, and does not link it', () => {
    const card = moneyCard({ ...MONEY, paidCents: 145000, stillOwedCents: 0 }, 'm-1')!;

    expect(card.figures[2]).toMatchObject({ amount: '$0.00', to: null });
  });

  it('draws paid against owed, the track standing for what is owed, with no mark at its end', () => {
    expect(moneyCard(MONEY, 'm-1')!.bar).toEqual({
      words: '$900.00 of $1,450.00 paid',
      value: 90000,
      mark: undefined,
      scale: 145000,
    });
  });

  it('marks what is owed, and draws paid past it, only when more was paid than owed', () => {
    const { bar } = moneyCard({ ...MONEY, paidCents: 160000, stillOwedCents: 0 }, 'm-1')!;

    expect(bar).toMatchObject({ value: 160000, mark: 145000, scale: 160000 });
  });

  it('draws no paid bar below nothing, when refunds passed what was paid', () => {
    const { bar } = moneyCard({ ...MONEY, paidCents: -2000, stillOwedCents: 147000 }, 'm-1')!;

    expect(bar).toMatchObject({ words: '-$20.00 of $1,450.00 paid', value: 0 });
  });

  it('gives no card where the market sets no prices or the Payments page counts nobody', () => {
    expect(moneyCard(null, 'm-1')).toBeNull();
  });
});
