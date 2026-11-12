/**
 * The Room section's cards (T201): a row per market day and, with two tiers or more, a row per
 * tier, each the tables asked against the plan's tables, every row of a card on one scale; before
 * anyone applies, the tables alone.
 */
import { describe, expect, it } from 'vitest';
import { roomCards, type RoomCounts } from '@/utils/roomRows';

const ROOM: RoomCounts = {
  dates: [
    { date: '2099-08-01', asked: 42, tables: 30 },
    { date: '2099-08-02', asked: 12.5, tables: 30 },
  ],
  tiers: [
    { tier: 'Gold', asked: 40, tables: 24 },
    { tier: 'Silver', asked: 20.5, tables: 36 },
  ],
};

describe('roomCards', () => {
  it('reads each day as its tables asked against its tables, named by its date', () => {
    const [days] = roomCards(ROOM, true);

    expect(days!.id).toBe('days');
    expect(days!.title).toBe('Tables asked each day');
    expect(days!.rows.map(({ key, label, words }) => ({ key, label, words }))).toEqual([
      { key: '2099-08-01', label: 'Saturday, August 1, 2099', words: '42 asking, 30 tables' },
      { key: '2099-08-02', label: 'Sunday, August 2, 2099', words: '12.5 asking, 30 tables' },
    ]);
  });

  it('draws every row of a card on its largest asked or tables', () => {
    const [days, tiers] = roomCards(ROOM, true);

    expect(days!.scale).toBe(42);
    expect(days!.rows.map((row) => [row.asked, row.tables])).toEqual([
      [42, 30],
      [12.5, 30],
    ]);
    expect(tiers!.scale).toBe(40);
    expect(
      roomCards({ ...ROOM, dates: [{ date: '2099-08-01', asked: 3, tables: 30 }] }, true)[0]!.scale,
    ).toBe(30);
  });

  it('says a day asks more than it has', () => {
    const [days] = roomCards(ROOM, true);

    expect(days!.rows.map((row) => row.over)).toEqual([true, false]);
  });

  it('reads each tier as the table-days asked against its table-days, with a note of why they add up past the days', () => {
    const [, tiers] = roomCards(ROOM, true);

    expect(tiers!.id).toBe('tiers');
    expect(tiers!.title).toBe('Table-days asked each tier');
    expect(tiers!.rows.map(({ key, label, words, over }) => ({ key, label, words, over }))).toEqual(
      [
        { key: 'Gold', label: 'Gold', words: '40 asking, 24 table-days', over: true },
        { key: 'Silver', label: 'Silver', words: '20.5 asking, 36 table-days', over: false },
      ],
    );
    expect(tiers!.note).toBe('A vendor who accepts two tiers on a day counts in both.');
  });

  it('says the days are a ceiling', () => {
    expect(roomCards(ROOM, true)[0]!.note).toBe(
      'A ceiling: someone available three days who wants at most two counts on all three.',
    );
  });

  it('has no tier card for a plan of one tier', () => {
    expect(roomCards({ ...ROOM, tiers: [] }, true).map((card) => card.id)).toEqual(['days']);
  });

  it('reads the tables alone before anyone applies, with no bar and no note', () => {
    const cards = roomCards(
      {
        dates: [{ date: '2099-08-01', asked: 0, tables: 1 }],
        tiers: [
          { tier: 'Gold', asked: 0, tables: 8 },
          { tier: 'Silver', asked: 0, tables: 12 },
        ],
      },
      false,
    );

    expect(cards.map((card) => card.rows.map((row) => [row.words, row.asked]))).toEqual([
      [['1 table', null]],
      [
        ['8 table-days', null],
        ['12 table-days', null],
      ],
    ]);
    expect(cards.map((card) => card.note)).toEqual(['', '']);
  });

  it('counts one table and one table-day in the singular', () => {
    const [days, tiers] = roomCards(
      {
        dates: [{ date: '2099-08-01', asked: 1, tables: 1 }],
        tiers: [
          { tier: 'Gold', asked: 1, tables: 1 },
          { tier: 'Silver', asked: 0, tables: 0 },
        ],
      },
      true,
    );

    expect(days!.rows[0]!.words).toBe('1 asking, 1 table');
    expect(tiers!.rows.map((row) => row.words)).toEqual([
      '1 asking, 1 table-day',
      '0 asking, 0 table-days',
    ]);
  });

  it('has no card when the plan has no dates', () => {
    expect(roomCards(null, true)).toEqual([]);
  });
});
