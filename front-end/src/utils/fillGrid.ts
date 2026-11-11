/**
 * The Stats tab's How full (T201): each section's tables used on each market day, of its tables.
 * The server counts it (`count_fill` in `back-end/market_stats.py`) from the stored assignment's
 * rows, a table with anyone at it used, half held included, so the grid adds up to the "table-days
 * used" and "free" figures; `null` until an assignment is stored.
 *
 * Here those counts become the grid `FillGrid` draws: a row per section, a column per market day,
 * a total row, and each cell's step, the shade it is drawn in and the words a screen reader hears
 * in its place, so the shade is never the only carrier.
 */
import { getShortDate } from '@/utils/utils';

export interface FillCell {
  /** The plan's own spelling of the date. */
  date: string;
  used: number;
  tables: number;
}

export interface FillSection {
  section: string;
  /** `null` for a section of no tier. */
  tier: string | null;
  /** One per market date, in the answer's `dates` order. */
  cells: FillCell[];
}

/** The server's `fill`; `null` until an assignment is stored. */
export interface FillCounts {
  dates: string[];
  sections: FillSection[];
}

/**
 * How full a cell is: nobody, up to a third, up to two thirds, past that but short of full, and
 * full. Each step past the first is a shade of green (`--mm-fill-*` in `base.css`); an empty cell
 * keeps the card's white, so a gap stands out.
 */
export type FillStep = 'none' | 'third' | 'two-thirds' | 'nearly' | 'full';

/** Each step in words, said in the cell for a screen reader. */
export const FILL_STEP_WORDS: Record<FillStep, string> = {
  none: 'empty',
  third: 'a third full or less',
  'two-thirds': 'two thirds full or less',
  nearly: 'more than two thirds full',
  full: 'full',
};

export interface FillGridColumn {
  key: string;
  /** The date in its short form: "Apr 22, 2024". */
  label: string;
}

export interface FillGridCell {
  key: string;
  used: number;
  tables: number;
  /** What the cell shows: "28/30". */
  figures: string;
  step: FillStep;
  /** What a screen reader hears: "28 of 30 used, more than two thirds full". */
  words: string;
}

export interface FillGridRow {
  key: string;
  label: string;
  /** The section's tier, under its name; empty for the total row and a section of no tier. */
  tier: string;
  cells: FillGridCell[];
}

export interface FillGridModel {
  columns: FillGridColumn[];
  rows: FillGridRow[];
  /** Every section's tables used of all, per day. */
  total: FillGridRow;
}

/** A cell's step. Compared in whole numbers, so 10 of 30 is a third exactly, not a float's hair past. */
export function fillStep(used: number, tables: number): FillStep {
  if (used <= 0 || tables <= 0) return 'none';
  if (used >= tables) return 'full';
  if (used * 3 <= tables) return 'third';
  if (used * 3 <= tables * 2) return 'two-thirds';
  return 'nearly';
}

function gridCell(key: string, used: number, tables: number): FillGridCell {
  const step = fillStep(used, tables);
  return {
    key,
    used,
    tables,
    figures: `${figure(used)}/${figure(tables)}`,
    step,
    words: `${figure(used)} of ${figure(tables)} used, ${FILL_STEP_WORDS[step]}`,
  };
}

/** The grid of a stored assignment; none before one is stored or where the plan has no table. */
export function fillGrid(fill: FillCounts | null): FillGridModel | null {
  if (!fill || !fill.dates.length || !fill.sections.length) return null;
  const columns = fill.dates.map((date) => ({ key: date, label: getShortDate(date) }));
  const byDate = (section: FillSection) => new Map(section.cells.map((cell) => [cell.date, cell]));
  const rows = fill.sections.map((section) => {
    const cells = byDate(section);
    return {
      key: section.section,
      label: section.section,
      tier: section.tier ?? '',
      cells: fill.dates.map((date) =>
        gridCell(date, cells.get(date)?.used ?? 0, cells.get(date)?.tables ?? 0),
      ),
    };
  });
  const total = {
    key: 'total',
    label: 'All sections',
    tier: '',
    cells: fill.dates.map((date, index) =>
      gridCell(
        date,
        sum(rows.map((row) => row.cells[index]!.used)),
        sum(rows.map((row) => row.cells[index]!.tables)),
      ),
    ),
  };
  return { columns, rows, total };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** A count of tables: "1,250". */
function figure(n: number): string {
  return n.toLocaleString('en-US');
}
