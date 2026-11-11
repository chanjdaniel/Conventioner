/**
 * The meter bar (T201): one row, a label, the caller's words, and a bar of a value against the
 * card's scale; given a mark, a line where it falls and the value past it in the attention fill.
 * The bar is hidden from a screen reader, which reads the words.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import MeterBar from '@/components/charts/MeterBar.vue';

type Props = InstanceType<typeof MeterBar>['$props'];

function mountMeter(
  props: Partial<Props> & Pick<Props, 'value' | 'scale'>,
  slots: Record<string, string> = {},
) {
  return mount(MeterBar, {
    props: { label: 'Saturday', words: '42 asking, 30 tables', testid: 'meter', ...props },
    slots,
  });
}

const width = (wrapper: ReturnType<typeof mountMeter>, part: string) =>
  wrapper.find(`[data-testid="meter-${part}"]`).attributes('style');

describe('MeterBar', () => {
  it('reads its label and words, and hides the bar', () => {
    const meter = mountMeter({ value: 42, mark: 30, scale: 42 });

    expect(meter.find('[data-testid="meter-label"]').text()).toBe('Saturday');
    expect(meter.find('[data-testid="meter-words"]').text()).toBe('42 asking, 30 tables');
    expect(meter.find('[data-testid="meter-bar"]').attributes('aria-hidden')).toBe('true');
  });

  it('draws the value against the scale, with no mark when none is given', () => {
    const meter = mountMeter({ value: 9, scale: 12 });

    expect(width(meter, 'within')).toBe('width: 75%;');
    expect(meter.find('[data-testid="meter-past"]').exists()).toBe(false);
    expect(meter.find('[data-testid="meter-mark"]').exists()).toBe(false);
  });

  it('draws the mark where it falls, and the value past it in the attention fill', () => {
    const meter = mountMeter({ value: 40, mark: 30, scale: 50 });

    expect(width(meter, 'within')).toBe('width: 60%;');
    expect(width(meter, 'past')).toBe('left: 60%; width: 20%;');
    expect(meter.find('[data-testid="meter-mark"]').attributes('style')).toBe('left: 60%;');
    expect(meter.find('[data-testid="meter-past"]').classes()).toContain('meter-bar-past');
  });

  it('draws nothing past a mark the value stays under', () => {
    const meter = mountMeter({ value: 12, mark: 30, scale: 30 });

    expect(width(meter, 'within')).toBe('width: 40%;');
    expect(meter.find('[data-testid="meter-past"]').exists()).toBe(false);
    expect(meter.find('[data-testid="meter-mark"]').attributes('style')).toBe('left: 100%;');
  });

  it('draws an empty bar on a scale of nothing', () => {
    const meter = mountMeter({ value: 0, mark: 0, scale: 0 });

    expect(width(meter, 'within')).toBe('width: 0%;');
    expect(meter.find('[data-testid="meter-mark"]').attributes('style')).toBe('left: 0%;');
  });

  it('draws no bar without a value, its words alone', () => {
    const meter = mountMeter({ value: null, mark: 30, scale: 30, words: '30 tables' });

    expect(meter.find('[data-testid="meter-bar"]').exists()).toBe(false);
    expect(meter.find('[data-testid="meter-words"]').text()).toBe('30 tables');
  });

  it('reads what the caller puts beside the words after them, parted for a reader', () => {
    const meter = mountMeter(
      { value: 18, mark: 24, scale: 24, words: '18 of 24 checked in' },
      { default: '<a href="/attendance">6 not yet</a>' },
    );

    expect(meter.find('[data-testid="meter-after"]').text()).toBe(', 6 not yet');
    expect(meter.text()).toBe('Saturday: 18 of 24 checked in, 6 not yet');
  });

  it('puts nothing beside the words when the caller gives nothing', () => {
    expect(mountMeter({ value: 1, scale: 2 }).find('[data-testid="meter-after"]').exists()).toBe(
      false,
    );
  });
});
