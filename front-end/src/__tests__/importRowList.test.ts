/**
 * The import preview's rows (E38/F03/S01): a list of rows that expand, each headed by who it is
 * and its file row, opening to the answers as the review card lays them out. The rows the
 * automatic rejections reject read the same, led by the reason (E38/F03/S02).
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImportRowList from '@/components/csvImport/ImportRowList.vue';
import type { AnswerRow } from '@/utils/essentialFields';

function answer(key: string, label: string, value: string): AnswerRow {
  return { key, label, value, custom: true };
}

const NADIA = {
  row: 2,
  email: 'nadia@ember.test',
  name: 'Nadia Okonkwo',
  leading: [answer('business_name', 'Business name', 'Ember Ceramics')],
  rest: [
    answer('product_type', 'What do you sell?', 'Pottery'),
    answer('instagram', 'Instagram', '@ember'),
  ],
};
const THEO = {
  row: 3,
  email: 'theo@thistle.test',
  name: '',
  leading: [],
  rest: [answer('business_name', 'Business name', 'Thorn & Thistle')],
};

function list(props: Record<string, unknown>) {
  return mount(ImportRowList, { props: { rowTestid: 'import-sample-row', ...props } });
}

describe('the import preview’s rows', () => {
  it('heads each row with who it is and its file row', () => {
    const rows = list({ rows: [NADIA, THEO] }).findAll('[data-testid="import-sample-row"]');

    expect(rows).toHaveLength(2);
    const nadia = rows[0]!.get('summary');
    expect(nadia.get('[data-testid="import-row-name"]').text()).toBe('Nadia Okonkwo');
    expect(nadia.get('[data-testid="import-row-email"]').text()).toBe('nadia@ember.test');
    expect(nadia.get('[data-testid="import-row-number"]').text()).toBe('Row 2');
    // No name: the address alone, never "Unnamed vendor".
    const theo = rows[1]!.get('summary');
    expect(theo.get('[data-testid="import-row-name"]').text()).toBe('theo@thistle.test');
    expect(theo.find('[data-testid="import-row-email"]').exists()).toBe(false);
  });

  it('is a disclosure per row, the first open when asked', () => {
    const rows = list({ rows: [NADIA, THEO], openFirst: true }).findAll(
      '[data-testid="import-sample-row"]',
    );

    // `details > summary` is the native disclosure: a button to the keyboard and to a reader.
    expect(rows.map((row) => row.element.firstElementChild?.tagName)).toEqual([
      'SUMMARY',
      'SUMMARY',
    ]);
    expect(rows.map((row) => (row.element as HTMLDetailsElement).open)).toEqual([true, false]);
    expect(
      list({ rows: [NADIA, THEO] })
        .findAll('[data-testid="import-sample-row"]')
        .some((row) => (row.element as HTMLDetailsElement).open),
    ).toBe(false);
  });

  it('opens to the leading answers, then the rest behind "N more answers"', () => {
    const nadia = list({ rows: [NADIA] }).get('[data-testid="import-sample-row"]');

    expect(nadia.get('[data-testid="import-sample-row-leading"]').text()).toContain(
      'Ember Ceramics',
    );
    expect(nadia.get('[data-testid="import-sample-row-rest-summary"]').text()).toBe(
      '2 more answers',
    );
    // A market that marked nothing to read first shows every answer, as the review card does.
    const theo = list({ rows: [THEO] }).get('[data-testid="import-sample-row"]');
    expect(theo.find('[data-testid="import-sample-row-rest"]').exists()).toBe(false);
    expect(theo.get('[data-testid="import-sample-row-answers"]').text()).toContain(
      'Thorn & Thistle',
    );
  });

  it('leads a rejected row with its reason, and marks its heading', () => {
    const rejected = { ...NADIA, reason: 'Answered “Half a table, shared” to “Table choice”' };
    const row = list({ rows: [rejected], rowTestid: 'import-rejected-row' }).get(
      '[data-testid="import-rejected-row"]',
    );

    expect(row.get('summary').text()).toContain('Rejected');
    const reason = row.get('[data-testid="import-row-reason"]');
    expect(reason.text()).toBe(
      'Rejected automatically: Answered “Half a table, shared” to “Table choice”',
    );
    // The reason comes before the answers it judged.
    const body = row.get('.import-row-body').element;
    expect(body.firstElementChild).toBe(reason.element);
  });
});
