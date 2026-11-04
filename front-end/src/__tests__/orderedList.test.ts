import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import draggable from 'vuedraggable';
import OrderedList from '@/components/OrderedList.vue';

interface Column {
  id: string;
  label: string;
}

const NAME = { id: 'name', label: 'Name' };
const EMAIL = { id: 'email', label: 'Email' };
const STATUS = { id: 'status', label: 'Status' };

let mounted: VueWrapper | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** The list as a screen mounts it, holding its order as `v-model` would. */
function mountList(modelValue: Column[], slots: Record<string, string> = {}) {
  const wrapper = mount(OrderedList<Column>, {
    attachTo: document.body,
    props: {
      modelValue,
      itemKey: (item: Column) => item.id,
      itemLabel: (item: Column) => item.label,
      label: 'In the file',
      testid: 'order',
      'onUpdate:modelValue': (value: Column[]) => wrapper.setProps({ modelValue: value }),
    } as never,
    slots,
  });
  mounted = wrapper;
  const rows = () => wrapper.findAll('[data-testid="order-row"]').map((row) => row.text());
  const up = (id: string) => wrapper.get(`[data-testid="order-up-${id}"]`);
  const down = (id: string) => wrapper.get(`[data-testid="order-down-${id}"]`);
  const emitted = () => wrapper.emitted('update:modelValue') ?? [];
  return { wrapper, rows, up, down, emitted };
}

describe('what a row is', () => {
  it('lists its items in order, an ordered list named by its label', () => {
    const { wrapper, rows } = mountList([NAME, EMAIL, STATUS]);
    const list = wrapper.get('ol');
    expect(list.attributes('aria-label')).toBe('In the file');
    expect(rows()).toEqual(['Name', 'Email', 'Status']);
  });

  it("has the primitive's drag handle, hidden from a reader since the buttons do the same", () => {
    const { wrapper } = mountList([NAME, EMAIL]);
    const handles = wrapper.findAll('.drag-handle');
    expect(handles).toHaveLength(2);
    expect(handles[0]!.attributes('aria-hidden')).toBe('true');
  });

  it('names each move button by its item', () => {
    const { up, down } = mountList([NAME, EMAIL]);
    expect(up('email').attributes('aria-label')).toBe('Move Email up');
    expect(down('name').attributes('aria-label')).toBe('Move Name down');
  });

  it("disables the first row's up and the last row's down, and no other", () => {
    const { up, down } = mountList([NAME, EMAIL, STATUS]);
    expect(up('name').attributes('disabled')).toBeDefined();
    expect(down('status').attributes('disabled')).toBeDefined();
    for (const open of [down('name'), up('email'), down('email'), up('status')]) {
      expect(open.attributes('disabled')).toBeUndefined();
    }
  });

  it('disables both on a list of one', () => {
    const { up, down } = mountList([NAME]);
    expect(up('name').attributes('disabled')).toBeDefined();
    expect(down('name').attributes('disabled')).toBeDefined();
  });

  it("draws a row by the screen's slot, given the item and its place", () => {
    const { rows } = mountList([NAME, EMAIL], {
      row: `<template #row="{ item, index }">{{ index + 1 }}. {{ item.id }}</template>`,
    });
    expect(rows()).toEqual(['1. name', '2. email']);
  });

  it('draws an empty list as an empty list', () => {
    const { wrapper, rows } = mountList([]);
    expect(rows()).toEqual([]);
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

describe('moving by the buttons', () => {
  it('emits the order with the row moved up', async () => {
    const { up, emitted, rows } = mountList([NAME, EMAIL, STATUS]);
    await up('email').trigger('click');
    expect(emitted()).toEqual([[[EMAIL, NAME, STATUS]]]);
    await nextTick();
    expect(rows()).toEqual(['Email', 'Name', 'Status']);
  });

  it('emits the order with the row moved down', async () => {
    const { down, emitted, rows } = mountList([NAME, EMAIL, STATUS]);
    await down('email').trigger('click');
    expect(emitted()).toEqual([[[NAME, STATUS, EMAIL]]]);
    await nextTick();
    expect(rows()).toEqual(['Name', 'Status', 'Email']);
  });

  it('never changes the list it was given', async () => {
    const given = [NAME, EMAIL, STATUS];
    const { up } = mountList(given);
    await up('status').trigger('click');
    expect(given).toEqual([NAME, EMAIL, STATUS]);
  });

  it("keeps the focus on the moved row's button, so it can be pressed again", async () => {
    const { up } = mountList([NAME, EMAIL, STATUS]);
    (up('status').element as HTMLElement).focus();
    await up('status').trigger('click');
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(up('status').element);
  });

  it("hands the focus to the row's other button when it reaches the end", async () => {
    const { up, down } = mountList([NAME, EMAIL]);
    (up('email').element as HTMLElement).focus();
    await up('email').trigger('click');
    await nextTick();
    await nextTick();
    expect(up('email').attributes('disabled')).toBeDefined();
    expect(document.activeElement).toBe(down('email').element);
  });
});

describe('moving by dragging', () => {
  it('emits the order the drag leaves', async () => {
    const { wrapper, emitted } = mountList([NAME, EMAIL, STATUS]);
    wrapper.getComponent(draggable).vm.$emit('update:modelValue', [STATUS, NAME, EMAIL]);
    await nextTick();
    expect(emitted()).toEqual([[[STATUS, NAME, EMAIL]]]);
  });

  it('holds a drag to the handle, so a press on a button or a word is no drag', () => {
    const { wrapper } = mountList([NAME]);
    expect(wrapper.getComponent(draggable).vm.$attrs.handle).toBe('.drag-handle');
  });
});
