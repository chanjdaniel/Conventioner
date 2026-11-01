/**
 * A locked essential answer looks locked in Update info (T181, T136 review note 2).
 *
 * Update info shows the answers the assignment reads read-only to whoever may not update them
 * (E41/F01/S02). The market's own questions there are drawn in the `.field` primitive's one
 * disabled state since T136, but the essential choice rows (Tier preference, Table choice) kept the
 * applicant's white box and mint chosen row, so a locked answer looked like one to change. The Form
 * preview renders the same component `disabled`, and keeps the applicant's look: it shows what a
 * vendor sees.
 */
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import EssentialApplicationFields from '@/components/application/EssentialApplicationFields.vue';
import {
  AVAILABLE_DATES_KEY,
  SECTION_RANKING_KEY,
  TABLE_CHOICE_KEY,
  TIER_PREFERENCE_KEY,
} from '@/utils/essentialFields';
import type { EssentialFormOptions } from '@/assets/types/datatypes';

const DAY = '2099-08-01';
const OPTIONS: EssentialFormOptions = {
  dates: [DAY],
  sections: ['North', 'South'],
  tableTypes: [],
  tiers: ['Gold', 'Silver'],
  unasked: [],
};
const ANSWERS = {
  [AVAILABLE_DATES_KEY]: [DAY],
  [TIER_PREFERENCE_KEY]: { [DAY]: ['Gold'] },
  [TABLE_CHOICE_KEY]: 'half',
  [SECTION_RANKING_KEY]: ['South', 'North'],
};

function render(props: { locked?: string[]; disabled?: boolean }) {
  return mount(EssentialApplicationFields, {
    props: { options: OPTIONS, modelValue: ANSWERS, prefix: 'update-info', ...props },
  });
}

/** Every choice row of a question: the label around each tick or radio. */
function choiceRows(wrapper: VueWrapper, question: string) {
  return wrapper.find(`[data-testid="update-info-essential-${question}"]`).findAll('label');
}

function rankedRows(wrapper: VueWrapper) {
  return wrapper.find('[data-testid="update-info-essential-section-rank"]').findAll('li');
}

const lockedLook = (row: { classes: () => string[] }) => row.classes().includes('locked');

describe('a locked essential answer in Update info', () => {
  it('draws each choice row of a locked question in the locked look, its input disabled', () => {
    const wrapper = render({ locked: [TIER_PREFERENCE_KEY, TABLE_CHOICE_KEY] });
    for (const question of ['tier-preference', 'table-choice']) {
      const rows = choiceRows(wrapper, question);
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        expect(lockedLook(row), `${question}: ${row.text()}`).toBe(true);
        expect(row.find('input').attributes('disabled')).toBeDefined();
      }
      expect(
        wrapper
          .find(`[data-testid="update-info-essential-${question}"] .essential-choice-list`)
          .classes(),
      ).toContain('locked');
    }
  });

  it('marks the chosen row of a locked question without the applicant mint', () => {
    const wrapper = render({ locked: [TABLE_CHOICE_KEY] });
    const chosen = choiceRows(wrapper, 'table-choice').filter((row) =>
      row.classes().includes('checked'),
    );
    expect(chosen).toHaveLength(1);
    expect(chosen[0].text()).toBe('Half a table, shared');
    expect(lockedLook(chosen[0])).toBe(true);
    expect(chosen[0].find('input').element).toHaveProperty('checked', true);
  });

  it('draws a locked ranking in the locked look', () => {
    const wrapper = render({ locked: [SECTION_RANKING_KEY] });
    const rows = rankedRows(wrapper);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(lockedLook(row), row.text()).toBe(true);
  });

  it("keeps the applicant's look on a question the lock does not name", () => {
    const wrapper = render({ locked: [TIER_PREFERENCE_KEY] });
    for (const row of choiceRows(wrapper, 'table-choice')) {
      expect(lockedLook(row), row.text()).toBe(false);
      expect(row.find('input').attributes('disabled')).toBeUndefined();
    }
    for (const row of rankedRows(wrapper)) expect(lockedLook(row), row.text()).toBe(false);
  });
});

describe('the Form preview, disabled and locking nothing', () => {
  it("keeps the applicant's look on every row, every input disabled", () => {
    const wrapper = render({ disabled: true });
    for (const question of ['tier-preference', 'table-choice']) {
      const rows = choiceRows(wrapper, question);
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        expect(lockedLook(row), `${question}: ${row.text()}`).toBe(false);
        expect(row.find('input').attributes('disabled')).toBeDefined();
      }
    }
    expect(wrapper.find('.essential-choice-list.locked').exists()).toBe(false);
    for (const row of rankedRows(wrapper)) expect(lockedLook(row), row.text()).toBe(false);
  });
});
