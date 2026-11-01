/**
 * A region that scrolls sideways is a keyboard stop while it scrolls, and only then (T82).
 *
 * The phase rail's spine scrolls inside the rail on a phone, and axe's `scrollable-region-focusable`
 * failed it there: a keyboard user could not scroll to the phases past the window's edge. On a desk
 * it does not scroll, and a tab stop on a list that does nothing is noise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useScrollsSideways } from '@/utils/useScrollsSideways';

/** The callbacks each ResizeObserver was made with, so a test can say "it resized". */
let observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      constructor(public callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sized(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
}

async function harness(items: Ref<string[]> = ref([])) {
  let scrolls!: Ref<boolean>;
  const target = ref<HTMLElement | null>(null);
  const wrapper = mount(
    defineComponent({
      setup() {
        scrolls = useScrollsSideways(target, items);
        return () =>
          h(
            'ol',
            { ref: target },
            items.value.map((item) => h('li', item)),
          );
      },
    }),
  );
  // The element is watched once it is in the page, after the render.
  await nextTick();
  return { wrapper, scrolls: () => scrolls.value, el: () => target.value! };
}

describe('useScrollsSideways', () => {
  it('is false while the content fits', async () => {
    const { el, scrolls } = await harness();
    sized(el(), 300, 300);
    observers[0].callback([], observers[0] as unknown as ResizeObserver);
    await nextTick();
    expect(scrolls()).toBe(false);
  });

  it('is true once the content is wider than the region, and false again when it fits', async () => {
    const { el, scrolls } = await harness();
    sized(el(), 520, 350);
    observers[0].callback([], observers[0] as unknown as ResizeObserver);
    expect(scrolls()).toBe(true);

    sized(el(), 520, 520);
    observers[0].callback([], observers[0] as unknown as ResizeObserver);
    expect(scrolls()).toBe(false);
  });

  it('turns true when the content grows past a region of fixed width, and false when it shrinks back', async () => {
    // Content growing inside a region of fixed width resizes nothing, so no ResizeObserver
    // callback comes: only the content changing can say the region now scrolls. The composable
    // measures on the tick after the render, hence two ticks.
    const items = ref(['Draft', 'Applications']);
    const { el, scrolls } = await harness(items);
    const region = el();
    Object.defineProperty(region, 'clientWidth', { configurable: true, value: 350 });
    Object.defineProperty(region, 'scrollWidth', {
      configurable: true,
      get: () => region.children.length * 120,
    });

    items.value = ['Draft', 'Applications', 'Assignment', 'Published'];
    await nextTick();
    await nextTick();
    expect(scrolls()).toBe(true);

    items.value = ['Draft', 'Applications'];
    await nextTick();
    await nextTick();
    expect(scrolls()).toBe(false);
  });

  it('stops watching when the component goes', async () => {
    const { wrapper } = await harness();
    wrapper.unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});
