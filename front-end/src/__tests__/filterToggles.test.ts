import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FilterToggles from '@/components/FilterToggles.vue';

/** The row as a screen mounts it, holding its value as `v-model` would. */
function mountRow(
  props:
    | { multiple?: false; modelValue: string; rest?: string }
    | { multiple: true; modelValue: string[] },
) {
  const options = [
    { id: 'open', label: 'Open', count: 110 },
    { id: 'approved', label: 'Approved', count: 160 },
    { id: 'rejected', label: 'Rejected', count: 0 },
  ];
  const wrapper = mount(FilterToggles, {
    props: {
      options,
      label: 'Show applications',
      testid: 'statuses',
      ...props,
      'onUpdate:modelValue': (value: string | string[]): Promise<void> =>
        wrapper.setProps(Array.isArray(value) ? { modelValue: value } : { modelValue: value }),
    },
  });
  const toggle = (id: string) => wrapper.get(`[data-testid="statuses-${id}"]`);
  const pressed = () =>
    wrapper
      .findAll('button')
      .filter((button) => button.attributes('aria-pressed') === 'true')
      .map((button) => button.attributes('data-testid'));
  const emitted = () => wrapper.emitted('update:modelValue') ?? [];
  return { wrapper, toggle, pressed, emitted };
}

describe('the row', () => {
  it('is one group, named by its label', () => {
    const { wrapper } = mountRow({ modelValue: 'open' });
    const group = wrapper.get('[data-testid="statuses"]');
    expect(group.attributes('role')).toBe('group');
    expect(group.attributes('aria-label')).toBe('Show applications');
  });

  it('draws each option as a plain button from the primitives, never submitting a form', () => {
    const { wrapper } = mountRow({ modelValue: 'open' });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.attributes('type')).toBe('button');
      expect(button.classes()).toEqual(
        expect.arrayContaining(['btn', 'btn--secondary', 'btn--compact']),
      );
    }
  });
});

describe('the counts', () => {
  it('reads a count after its label, so the button is named by the words it shows', () => {
    const { toggle } = mountRow({ modelValue: 'open' });
    expect(toggle('approved').text()).toBe('Approved 160');
    expect(toggle('approved').attributes('aria-label')).toBeUndefined();
  });

  it('reads a count of nothing as 0', () => {
    const { toggle } = mountRow({ modelValue: 'open' });
    expect(toggle('rejected').text()).toBe('Rejected 0');
  });

  it('draws no count for an option without one', () => {
    const wrapper = mount(FilterToggles, {
      props: {
        options: [{ id: 'all', label: 'All' }],
        modelValue: 'all',
        label: 'View',
        testid: 'view',
      },
    });
    expect(wrapper.get('[data-testid="view-all"]').text()).toBe('All');
    expect(wrapper.find('.filter-toggles__count').exists()).toBe(false);
  });
});

describe('one choice', () => {
  it('presses the toggle the value names, and only that one', () => {
    const { pressed } = mountRow({ modelValue: 'approved' });
    expect(pressed()).toEqual(['statuses-approved']);
  });

  it('chooses the toggle pressed, letting the last one go', async () => {
    const { toggle, pressed, emitted } = mountRow({ modelValue: 'open' });
    await toggle('approved').trigger('click');
    expect(emitted()).toEqual([['approved']]);
    expect(pressed()).toEqual(['statuses-approved']);
  });

  it('lets the choice go when the chosen toggle is pressed again, pressing nothing', async () => {
    const { toggle, pressed, emitted } = mountRow({ modelValue: 'open' });
    await toggle('open').trigger('click');
    expect(emitted()).toEqual([['']]);
    expect(pressed()).toEqual([]);
  });

  it('chooses again from nothing chosen', async () => {
    const { toggle, pressed } = mountRow({ modelValue: '' });
    expect(pressed()).toEqual([]);
    await toggle('open').trigger('click');
    expect(pressed()).toEqual(['statuses-open']);
  });

  it('lets go to the option it rests on, its default or All toggle, when it names one', async () => {
    const { toggle, pressed, emitted } = mountRow({ modelValue: 'approved', rest: 'open' });
    await toggle('approved').trigger('click');
    expect(emitted()).toEqual([['open']]);
    expect(pressed()).toEqual(['statuses-open']);
  });

  it('keeps the option it rests on when that is pressed again, having nowhere to go', async () => {
    const { toggle, pressed, emitted } = mountRow({ modelValue: 'open', rest: 'open' });
    await toggle('open').trigger('click');
    expect(emitted()).toEqual([]);
    expect(pressed()).toEqual(['statuses-open']);
  });

  it('presses nothing for a value no option offers', () => {
    const { pressed } = mountRow({ modelValue: 'gone' });
    expect(pressed()).toEqual([]);
  });
});

describe('several', () => {
  it('presses every toggle the value names', () => {
    const { pressed } = mountRow({ multiple: true, modelValue: ['open', 'rejected'] });
    expect(pressed()).toEqual(['statuses-open', 'statuses-rejected']);
  });

  it('presses none for an empty value', () => {
    const { pressed } = mountRow({ multiple: true, modelValue: [] });
    expect(pressed()).toEqual([]);
  });

  it('toggles one in and out, keeping the others', async () => {
    const { toggle, pressed, emitted } = mountRow({ multiple: true, modelValue: ['open'] });

    await toggle('rejected').trigger('click');
    expect(emitted().at(-1)).toEqual([['open', 'rejected']]);
    expect(pressed()).toEqual(['statuses-open', 'statuses-rejected']);

    await toggle('open').trigger('click');
    expect(emitted().at(-1)).toEqual([['rejected']]);
    expect(pressed()).toEqual(['statuses-rejected']);

    await toggle('rejected').trigger('click');
    expect(emitted().at(-1)).toEqual([[]]);
    expect(pressed()).toEqual([]);
  });

  it('emits in the options order, whatever order they were pressed in', async () => {
    const { toggle, emitted } = mountRow({ multiple: true, modelValue: ['rejected'] });
    await toggle('open').trigger('click');
    expect(emitted().at(-1)).toEqual([['open', 'rejected']]);
  });

  it('drops a value no option offers, since nothing could let it go', async () => {
    const { toggle, emitted } = mountRow({ multiple: true, modelValue: ['gone', 'open'] });
    await toggle('approved').trigger('click');
    expect(emitted().at(-1)).toEqual([['open', 'approved']]);
  });
});
