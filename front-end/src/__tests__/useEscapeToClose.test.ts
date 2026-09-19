/**
 * Six overlays depend on this composable, and the bug it fixes was that none of them closed on
 * Escape. The listener being bound only while open is the part worth pinning: a page holding
 * several overlays must not close them all at once.
 */
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useEscapeToClose } from '@/utils/useEscapeToClose';

function harness(open = ref(false)) {
  const close = vi.fn();
  const Host = defineComponent({
    setup() {
      useEscapeToClose(open, close);
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { open, close, wrapper };
}

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('useEscapeToClose', () => {
  it('closes an open overlay', () => {
    const { close, wrapper } = harness(ref(true));
    pressEscape();
    expect(close).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('ignores Escape while closed, so a closed overlay does not steal the key', () => {
    const { close, wrapper } = harness(ref(false));
    pressEscape();
    expect(close).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('starts listening when the overlay opens and stops when it closes', async () => {
    const open = ref(false);
    const { close, wrapper } = harness(open);

    open.value = true;
    await wrapper.vm.$nextTick();
    pressEscape();
    expect(close).toHaveBeenCalledTimes(1);

    open.value = false;
    await wrapper.vm.$nextTick();
    pressEscape();
    expect(close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('ignores every other key', () => {
    const { close, wrapper } = harness(ref(true));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(close).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('stops listening once the component is gone', () => {
    const { close, wrapper } = harness(ref(true));
    wrapper.unmount();
    pressEscape();
    expect(close).not.toHaveBeenCalled();
  });
});
