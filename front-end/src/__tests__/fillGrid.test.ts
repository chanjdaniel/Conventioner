/**
 * The How full grid (T201): a row per section, a column per market day and a total row, each cell
 * its tables used of its tables, shaded by a step that is also said in words.
 */
import { describe, expect, it } from 'vitest';
import { fillGrid, fillStep, type FillCounts } from '@/utils/fillGrid';

const SAT = '2099-08-01';
const SUN = '2099-08-02';

const FILL: FillCounts = {
  dates: [SAT, SUN],
  sections: [
    {
      section: 'Front',
      tier: 'Gold',
      cells: [
        { date: SAT, used: 28, tables: 30 },
        { date: SUN, used: 30, tables: 30 },
      ],
    },
    {
      section: 'Back',
      tier: null,
      cells: [
        { date: SAT, used: 0, tables: 1200 },
        { date: SUN, used: 4, tables: 1200 },
      ],
    },
  ],
};

describe('fillStep', () => {
  it('is none with nobody at a table', () => {
    expect(fillStep(0, 30)).toBe('none');
    expect(fillStep(0, 0)).toBe('none');
  });

  it('is a third from the first table to a third exactly', () => {
    expect(fillStep(1, 30)).toBe('third');
    expect(fillStep(10, 30)).toBe('third');
    expect(fillStep(1, 3)).toBe('third');
  });

  it('is two thirds from past a third to two thirds exactly', () => {
    expect(fillStep(11, 30)).toBe('two-thirds');
    expect(fillStep(20, 30)).toBe('two-thirds');
    expect(fillStep(2, 3)).toBe('two-thirds');
  });

  it('is nearly from past two thirds to one table short', () => {
    expect(fillStep(21, 30)).toBe('nearly');
    expect(fillStep(29, 30)).toBe('nearly');
  });

  it('is full with every table used', () => {
    expect(fillStep(30, 30)).toBe('full');
    expect(fillStep(1, 1)).toBe('full');
  });
});

describe('fillGrid', () => {
  it('is nothing before an assignment is stored, or with no section', () => {
    expect(fillGrid(null)).toBeNull();
    expect(fillGrid({ dates: [SAT], sections: [] })).toBeNull();
    expect(fillGrid({ dates: [], sections: [] })).toBeNull();
  });

  it('heads a column per market day with its short date', () => {
    expect(fillGrid(FILL)!.columns).toEqual([
      { key: SAT, label: 'Aug 1, 2099' },
      { key: SUN, label: 'Aug 2, 2099' },
    ]);
  });

  it('reads a row per section, its tier under it, each cell its tables used of its tables', () => {
    const { rows } = fillGrid(FILL)!;

    expect(rows.map(({ key, label, tier }) => ({ key, label, tier }))).toEqual([
      { key: 'Front', label: 'Front', tier: 'Gold' },
      { key: 'Back', label: 'Back', tier: '' },
    ]);
    expect(rows.map((row) => row.cells.map((cell) => [cell.figures, cell.step]))).toEqual([
      [
        ['28/30', 'nearly'],
        ['30/30', 'full'],
      ],
      [
        ['0/1,200', 'none'],
        ['4/1,200', 'third'],
      ],
    ]);
  });

  it('says each cell and its step in words, so the shade is not the only carrier', () => {
    const { rows } = fillGrid(FILL)!;

    expect(rows.flatMap((row) => row.cells.map((cell) => cell.words))).toEqual([
      '28 of 30 used, more than two thirds full',
      '30 of 30 used, full',
      '0 of 1,200 used, empty',
      '4 of 1,200 used, a third full or less',
    ]);
  });

  it('totals every section per day, shaded by the same steps', () => {
    const { total } = fillGrid(FILL)!;

    expect(total.label).toBe('All sections');
    expect(total.cells.map((cell) => [cell.used, cell.tables, cell.figures, cell.step])).toEqual([
      [28, 1230, '28/1,230', 'third'],
      [34, 1230, '34/1,230', 'third'],
    ]);
  });

  it('reads a day a section has no cell for as none of none', () => {
    const { rows } = fillGrid({
      dates: [SAT, SUN],
      sections: [{ section: 'Front', tier: 'Gold', cells: [{ date: SAT, used: 1, tables: 2 }] }],
    })!;

    expect(rows[0]!.cells.map((cell) => [cell.key, cell.figures, cell.step])).toEqual([
      [SAT, '1/2', 'two-thirds'],
      [SUN, '0/0', 'none'],
    ]);
  });
});
