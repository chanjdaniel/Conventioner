/**
 * The How full table (T201): a real table, captioned, a row header per section and a column header
 * per day, each cell's figures shown and its step said in words, the shade a class on the cell.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FillGrid from '@/components/charts/FillGrid.vue';
import { fillGrid } from '@/utils/fillGrid';

const GRID = fillGrid({
  dates: ['2099-08-01', '2099-08-02'],
  sections: [
    {
      section: 'Front',
      tier: 'Gold',
      cells: [
        { date: '2099-08-01', used: 28, tables: 30 },
        { date: '2099-08-02', used: 30, tables: 30 },
      ],
    },
    {
      section: 'Back',
      tier: null,
      cells: [
        { date: '2099-08-01', used: 0, tables: 6 },
        { date: '2099-08-02', used: 2, tables: 6 },
      ],
    },
  ],
})!;

function mountGrid() {
  return mount(FillGrid, { props: { title: 'Tables used each day', grid: GRID, testid: 'fill' } });
}

describe('FillGrid', () => {
  it('is a table captioned by its title, with a header per day and per section', () => {
    const table = mountGrid().find('table');

    expect(table.find('caption').text()).toBe('Tables used each day');
    expect(table.findAll('thead th[scope="col"]').map((th) => th.text())).toEqual([
      'Section',
      'Aug 1, 2099',
      'Aug 2, 2099',
    ]);
    expect(table.findAll('tbody th[scope="row"]').map((th) => th.text())).toEqual([
      'Front, Gold',
      'Back',
    ]);
    expect(table.find('tfoot th[scope="row"]').text()).toBe('All sections');
  });

  it('shows each cell as used/tables, hidden from a screen reader, which hears it in words', () => {
    const cells = mountGrid().findAll('[data-testid="fill-cell"]');

    expect(cells.map((cell) => cell.find('[data-testid="fill-figures"]').text())).toEqual([
      '28/30',
      '30/30',
      '0/6',
      '2/6',
    ]);
    expect(cells[0]!.find('[data-testid="fill-figures"]').attributes('aria-hidden')).toBe('true');
    expect(cells.map((cell) => cell.find('.visually-hidden').text())).toEqual([
      '28 of 30 used, more than two thirds full',
      '30 of 30 used, full',
      '0 of 6 used, empty',
      '2 of 6 used, a third full or less',
    ]);
  });

  it('shades each cell by its step, the total row too', () => {
    const wrapper = mountGrid();

    expect(
      wrapper.findAll('[data-testid="fill-cell"]').map((cell) => cell.attributes('data-step')),
    ).toEqual(['nearly', 'full', 'none', 'third']);
    expect(wrapper.find('[data-testid="fill-cell"]').classes()).toContain('fill-grid-cell--nearly');
    const total = wrapper.findAll('[data-testid="fill-total"] td');
    expect(
      total.map((cell) => [
        cell.find('[data-testid="fill-figures"]').text(),
        cell.attributes('data-step'),
      ]),
    ).toEqual([
      ['28/36', 'nearly'],
      ['32/36', 'nearly'],
    ]);
  });
});
