import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import RowGroup from '@/components/RowGroup.vue';

const seats = (count: number) =>
  Array.from({ length: count }, (_, at) => ({ id: `seat-${at + 1}`, name: `Seat ${at + 1}` }));

function mountGroup(count: number, props: { fold?: number; level?: 2 | 3 | 4 | 5 | 6 } = {}) {
  return mount(RowGroup, {
    attachTo: document.body,
    props: {
      heading: 'North Wing',
      items: seats(count),
      itemKey: (item: { id: string }) => item.id,
      testid: 'group',
      ...props,
    },
    slots: {
      row: `<template #row="{ item, index }"><span data-testid="seat">{{ index }}: {{ item.name }}</span></template>`,
    },
  });
}

type Group = ReturnType<typeof mountGroup>;
const rows = (wrapper: Group) => wrapper.findAll('[data-testid="group-row"]');
const seatTexts = (wrapper: Group) => wrapper.findAll('[data-testid="seat"]').map((s) => s.text());
const button = (wrapper: Group) => wrapper.find('[data-testid="group-fold"]');

describe('RowGroup', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('names the group in a heading, level 3 unless told', () => {
    const wrapper = mountGroup(3);
    expect(wrapper.get('h3').text()).toBe('North Wing');
    wrapper.unmount();
    const nested = mountGroup(3, { level: 4 });
    expect(nested.get('h4').text()).toBe('North Wing');
    expect(nested.find('h3').exists()).toBe(false);
    nested.unmount();
  });

  it('gives the slot each item and its index', () => {
    const wrapper = mountGroup(2);
    expect(seatTexts(wrapper)).toEqual(['0: Seat 1', '1: Seat 2']);
    wrapper.unmount();
  });

  it('shows every row at the fold of 20 or under it, with no button', () => {
    for (const count of [1, 19, 20]) {
      const wrapper = mountGroup(count);
      expect(rows(wrapper)).toHaveLength(count);
      expect(button(wrapper).exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it('past the fold shows the first rows and Show all N in the heading', () => {
    const wrapper = mountGroup(31);
    expect(rows(wrapper)).toHaveLength(20);
    expect(seatTexts(wrapper)[19]).toBe('19: Seat 20');
    expect(button(wrapper).text()).toBe('Show all 31 in North Wing');
    expect(button(wrapper).attributes('type')).toBe('button');
    wrapper.unmount();
  });

  it('folds at the size it is given', () => {
    const wrapper = mountGroup(8, { fold: 5 });
    expect(rows(wrapper)).toHaveLength(5);
    expect(button(wrapper).text()).toBe('Show all 8 in North Wing');
    wrapper.unmount();
  });

  it('unfolds in place, the button becomes Show fewer, and the first new row takes the focus', async () => {
    const wrapper = mountGroup(31);
    await button(wrapper).trigger('click');
    await nextTick();
    expect(rows(wrapper)).toHaveLength(31);
    expect(button(wrapper).text()).toBe('Show fewer in North Wing');
    expect(document.activeElement).toBe(rows(wrapper)[20]!.element);
    expect(rows(wrapper)[20]!.attributes('tabindex')).toBe('-1');
    wrapper.unmount();
  });

  it('folds again, keeping the focus on the button and the button in view', async () => {
    const wrapper = mountGroup(31);
    await button(wrapper).trigger('click');
    await nextTick();
    (button(wrapper).element as HTMLButtonElement).focus();
    await button(wrapper).trigger('click');
    await nextTick();
    expect(rows(wrapper)).toHaveLength(20);
    expect(button(wrapper).text()).toBe('Show all 31 in North Wing');
    expect(document.activeElement).toBe(button(wrapper).element);
    expect(scrollIntoView.mock.contexts[0]).toBe(button(wrapper).element);
    wrapper.unmount();
  });

  it('names the group after Show fewer for a reader only, as each section has one', async () => {
    const wrapper = mountGroup(31);
    await button(wrapper).trigger('click');
    expect(button(wrapper).find('.visually-hidden').text()).toBe('in North Wing');
    wrapper.unmount();
  });

  it('keeps each row by its key when the items change, and stays unfolded', async () => {
    const wrapper = mountGroup(31);
    await button(wrapper).trigger('click');
    const first = rows(wrapper)[1]!.element;
    await wrapper.setProps({ items: seats(31).slice(1) });
    expect(rows(wrapper)).toHaveLength(30);
    expect(rows(wrapper)[0]!.element).toBe(first);
    expect(button(wrapper).text()).toBe('Show fewer in North Wing');
    wrapper.unmount();
  });
});
