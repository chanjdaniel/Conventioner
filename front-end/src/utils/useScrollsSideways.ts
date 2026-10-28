import { nextTick, onUnmounted, ref, watch, type Ref, type WatchSource } from 'vue';

/**
 * Whether an element's content is wider than the element, so that it scrolls sideways (T82).
 *
 * A region that scrolls has to be reachable from a keyboard (axe's `scrollable-region-focusable`),
 * and one that does not scroll should not be a tab stop: the phase rail's spine scrolls on a phone
 * and fits on a desk. It is measured when the element is resized and, since content growing inside
 * a region of fixed width resizes nothing, whenever `content` changes.
 */
export function useScrollsSideways(
  target: Ref<HTMLElement | null>,
  content?: WatchSource,
): Ref<boolean> {
  const scrolls = ref(false);
  let observer: ResizeObserver | null = null;

  function measure() {
    const el = target.value;
    scrolls.value = !!el && el.scrollWidth > el.clientWidth;
  }

  watch(
    target,
    (el) => {
      observer?.disconnect();
      observer = null;
      if (!el) return;
      observer = new ResizeObserver(measure);
      observer.observe(el);
      measure();
    },
    { immediate: true, flush: 'post' },
  );

  if (content) watch(content, () => nextTick(measure));

  onUnmounted(() => observer?.disconnect());

  return scrolls;
}
