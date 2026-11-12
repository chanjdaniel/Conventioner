/**
 * The column chart (T201): a column per bucket from a baseline, an empty bucket a gap on it, the
 * largest count marked by a line at the top, the first and last bucket named under the axis, and the
 * whole read as one sentence, with every bucket in a table behind "Numbers by day".
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ColumnChart from '@/components/charts/ColumnChart.vue';

const COLUMNS = [
  { key: '2026-10-01', label: 'Oct 1', name: 'Thu, Oct 1, 2026', count: 3 },
  { key: '2026-10-02', label: 'Oct 2', name: 'Fri, Oct 2, 2026', count: 0 },
  { key: '2026-10-03', label: 'Oct 3', name: 'Sat, Oct 3, 2026', count: 12 },
  { key: '2026-10-04', label: 'Oct 4', name: 'Sun, Oct 4, 2026', count: 6 },
];

function mountChart(columns = COLUMNS) {
  return mount(ColumnChart, {
    props: {
      title: 'When they applied',
      columns,
      summary: '21 applications from Oct 1 to 4, 2026, most on Oct 3: 12',
      numbers: 'Numbers by day',
      keyHead: 'Day',
      countHead: 'Applications',
      testid: 'chart',
    },
  });
}

describe('ColumnChart', () => {
  it('is one image named by its summary', () => {
    const plot = mountChart().find('[role="img"]');
    expect(plot.attributes('aria-label')).toBe(
      '21 applications from Oct 1 to 4, 2026, most on Oct 3: 12',
    );
  });

  it('draws a column per bucket, each against the largest, an empty one a gap', () => {
    const columns = mountChart().findAll('[data-testid="chart-column"]');
    expect(columns.map((c) => c.attributes('data-count'))).toEqual(['3', '0', '12', '6']);
    expect(columns.map((c) => c.attributes('style'))).toEqual([
      'height: 25%;',
      'height: 0%;',
      'height: 100%;',
      'height: 50%;',
    ]);
    expect(columns[1].classes()).toContain('column-chart-column--empty');
  });

  it('marks the largest count at the top', () => {
    expect(mountChart().find('[data-testid="chart-most"]').text()).toBe('12');
  });

  it('names the first and the last bucket under the axis', () => {
    const axis = mountChart().find('[data-testid="chart-axis"]');
    expect(axis.findAll('span').map((s) => s.text())).toEqual(['Oct 1', 'Oct 4']);
  });

  it('names one bucket once', () => {
    const axis = mountChart(COLUMNS.slice(0, 1)).find('[data-testid="chart-axis"]');
    expect(axis.findAll('span').map((s) => s.text())).toEqual(['Oct 1']);
  });

  it('lists every bucket, empty ones included, in a table behind its disclosure', () => {
    const wrapper = mountChart();
    const details = wrapper.find('details');
    expect(details.find('summary').text()).toBe('Numbers by day');
    expect(details.findAll('thead th').map((th) => th.text())).toEqual(['Day', 'Applications']);
    expect(
      details.findAll('tbody tr').map((tr) => tr.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['Thu, Oct 1, 2026', '3'],
      ['Fri, Oct 2, 2026', '0'],
      ['Sat, Oct 3, 2026', '12'],
      ['Sun, Oct 4, 2026', '6'],
    ]);
  });
});
