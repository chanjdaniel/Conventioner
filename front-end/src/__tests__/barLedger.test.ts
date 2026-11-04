import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import BarLedger from '@/components/BarLedger.vue';
import { ledgerRows } from '@/utils/barLedger';

/** Answers in the question's order, not by count: the smallest first. */
function answers(count: number) {
  return ledgerRows(
    Array.from({ length: count }, (_, at) => ({
      label: `Answer ${at + 1}`,
      value: `answer-${at + 1}`,
      count: at + 1,
    })),
    1000,
  );
}

function mountLedger(rows: number, fold?: number) {
  return mount(BarLedger, {
    attachTo: document.body,
    props: {
      title: 'Kinds of work',
      rows: answers(rows),
      testid: 'bars',
      whole: 'applicants',
      fold,
    },
  });
}

type Ledger = ReturnType<typeof mountLedger>;
const drawn = (wrapper: Ledger) =>
  wrapper.findAll('[data-testid="bars"]').map((row) => row.attributes('data-value'));
const button = (wrapper: Ledger) => wrapper.find('[data-testid="bars-fold"]');
const items = (wrapper: Ledger) => wrapper.findAll('li');

describe('BarLedger without fold', () => {
  it('draws every row, in the order it was given, with no button', () => {
    const wrapper = mountLedger(30);
    expect(drawn(wrapper)).toEqual(answers(30).map((row) => row.value));
    expect(button(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it('leaves nothing on its rows for the fold', () => {
    const wrapper = mountLedger(30);
    expect(wrapper.find('[tabindex]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('says None. with no rows', () => {
    const wrapper = mountLedger(0);
    expect(wrapper.text()).toContain('None.');
    expect(button(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('BarLedger with fold', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('draws the rows by count up to the fold, whatever order they came in', () => {
    const wrapper = mountLedger(30, 10);
    expect(drawn(wrapper)).toEqual(Array.from({ length: 10 }, (_, at) => `answer-${30 - at}`));
    wrapper.unmount();
  });

  it('keeps the order it was given between rows of one count', () => {
    const rows = ledgerRows(
      ['a', 'b', 'c'].map((value) => ({ label: value, value, count: 5 })),
      15,
    );
    const wrapper = mount(BarLedger, {
      props: { title: 'Ties', rows, testid: 'bars', whole: 'applicants', fold: 2 },
    });
    expect(drawn(wrapper as Ledger)).toEqual(['a', 'b']);
    wrapper.unmount();
  });

  it('says how many more answers the button holds', () => {
    const wrapper = mountLedger(30, 10);
    expect(button(wrapper).text()).toBe('20 more answers');
    expect(button(wrapper).attributes('type')).toBe('button');
    wrapper.unmount();
  });

  it('says one more answer in the singular', () => {
    const wrapper = mountLedger(11, 10);
    expect(button(wrapper).text()).toBe('1 more answer');
    wrapper.unmount();
  });

  it('draws no button at the fold or under it, still by count', () => {
    for (const rows of [10, 3]) {
      const wrapper = mountLedger(rows, 10);
      expect(button(wrapper).exists()).toBe(false);
      expect(drawn(wrapper)[0]).toBe(`answer-${rows}`);
      wrapper.unmount();
    }
  });

  it('unfolds the rest in place, by count, and the button becomes Show fewer', async () => {
    const wrapper = mountLedger(30, 10);
    await button(wrapper).trigger('click');
    expect(drawn(wrapper)).toEqual(Array.from({ length: 30 }, (_, at) => `answer-${30 - at}`));
    expect(button(wrapper).text()).toBe('Show fewer');
    wrapper.unmount();
  });

  it('hands the focus to the first new row on unfolding', async () => {
    const wrapper = mountLedger(30, 10);
    await button(wrapper).trigger('click');
    await nextTick();
    expect(document.activeElement).toBe(items(wrapper)[10]!.element);
    expect(items(wrapper)[10]!.attributes('tabindex')).toBe('-1');
    wrapper.unmount();
  });

  it('folds again, keeping the focus on the button and the button in view', async () => {
    const wrapper = mountLedger(30, 10);
    await button(wrapper).trigger('click');
    await nextTick();
    (button(wrapper).element as HTMLButtonElement).focus();
    await button(wrapper).trigger('click');
    await nextTick();
    expect(drawn(wrapper)).toHaveLength(10);
    expect(button(wrapper).text()).toBe('20 more answers');
    expect(document.activeElement).toBe(button(wrapper).element);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(button(wrapper).element);
    wrapper.unmount();
  });

  it('stays unfolded when its rows change, as Stats narrowing to a group changes them', async () => {
    const wrapper = mountLedger(30, 10);
    await button(wrapper).trigger('click');
    await wrapper.setProps({ rows: answers(25) });
    expect(drawn(wrapper)).toHaveLength(25);
    expect(button(wrapper).text()).toBe('Show fewer');
    wrapper.unmount();
  });

  it('draws the rows as the plain ledger does: label, count, share and bar', () => {
    const wrapper = mountLedger(11, 10);
    const row = wrapper.find('[data-testid="bars"]');
    expect(row.text()).toContain('Answer 11');
    expect(wrapper.find('[data-testid="bars-count"]').text()).toBe('11');
    expect(row.find('.bar-ledger-bar').exists()).toBe(true);
    wrapper.unmount();
  });
});
