// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import LayoutCalibration from '@/components/layout/LayoutCalibration.vue';

/**
 * A layout's scale can be set with no pointer (T257 ticket 02): the image is one Tab stop, the
 * arrow keys move a crosshair from its centre, Enter sets each end of the line, and the length is
 * typed with its unit.
 */
function mountIt(props: Record<string, unknown> = {}) {
  return mount(LayoutCalibration, {
    props: {
      imageUrl: 'blob:hall',
      imageWidth: 800,
      imageHeight: 600,
      locationName: 'Upper Hall',
      ...props,
    },
    attachTo: document.body,
  });
}

async function press(
  wrapper: ReturnType<typeof mountIt>,
  key: string,
  times = 1,
  shiftKey = false,
) {
  const map = wrapper.get('[data-testid="layout-calibration-map"]');
  for (let i = 0; i < times; i++) await map.trigger('keydown', { key, shiftKey });
}

describe('calibrating by keyboard', () => {
  it('is one Tab stop named for its location', () => {
    const map = mountIt().get('[data-testid="layout-calibration-map"]');

    expect(map.attributes('tabindex')).toBe('0');
    expect(map.attributes('aria-label')).toBe("Upper Hall's floorplan");
  });

  it('draws the line from the centre with the arrows and Enter, and sets the scale', async () => {
    const wrapper = mountIt();
    await wrapper.get('[data-testid="layout-calibration-map"]').trigger('focus');

    await press(wrapper, 'ArrowLeft', 6, true); // 80 px a press: the left edge, held there
    await press(wrapper, 'Enter');
    expect(wrapper.text()).toContain('First end set. Move to the other end and press Enter.');
    await press(wrapper, 'ArrowRight', 10, true); // the right edge
    await press(wrapper, 'Enter');
    expect(wrapper.text()).toContain('Line drawn. Type its length.');
    await wrapper.get('[data-testid="layout-calibration-length"]').setValue('30');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('set')).toEqual([
      [{ start: [0, 300], end: [800, 300], lengthMm: 30000 }],
    ]);
  });

  it('takes the length in the unit chosen', async () => {
    const wrapper = mountIt({ start: [0, 0], end: [800, 0] });

    await wrapper.get('[data-testid="layout-calibration-length"]').setValue('100');
    await wrapper.get('[data-testid="layout-calibration-unit"]').setValue('ft');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('set')?.[0][0]).toMatchObject({ lengthMm: 30480 });
  });

  it('lets go of a first end with Escape', async () => {
    const wrapper = mountIt();

    await press(wrapper, 'Enter');
    await press(wrapper, 'Escape');

    expect(wrapper.find('[data-testid="layout-calibration-line"]').exists()).toBe(false);
  });

  it('refuses to set a scale with no line, or no length, as an alert', async () => {
    const wrapper = mountIt();

    await wrapper.get('[data-testid="layout-calibration-length"]').setValue('30');
    await wrapper.get('form').trigger('submit');
    const error = wrapper.get('[data-testid="layout-calibration-error"]');
    expect(error.text()).toBe('Draw a line across something whose length you know first.');
    expect(error.attributes('role')).toBe('alert');

    const drawn = mountIt({ start: [0, 0], end: [800, 0] });
    await drawn.get('form').trigger('submit');
    expect(drawn.get('[data-testid="layout-calibration-error"]').text()).toBe(
      "Type the line's length as a number.",
    );
    expect(drawn.emitted('set')).toBeUndefined();
  });

  it('starts a recalibration from the line stored, in metres', () => {
    const wrapper = mountIt({
      start: [10, 20],
      end: [610, 20],
      lengthMm: 24000,
      cancellable: true,
    });

    expect(
      (wrapper.get('[data-testid="layout-calibration-length"]').element as HTMLInputElement).value,
    ).toBe('24');
    expect(wrapper.get('[data-testid="layout-calibration-line"]').attributes('x2')).toBe('610');
    expect(wrapper.find('[data-testid="layout-calibration-cancel"]').exists()).toBe(true);
  });
});
