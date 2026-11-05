<script setup lang="ts">
/**
 * A list the server pages (T224): the rows it has, the next page as their end comes into view, and
 * what it says at that end while a page is on its way or has failed. It knows nothing of what the
 * rows are, which are its default slot, or of how a page is read, which the screen does on `more`.
 *
 * - `box="own"` stands the rows in a `ScrollBox` of bounded height, whose maximum leaves a short list
 *   only as tall as it is. A scroll past its end carries on to the scroller around it, so nobody is
 *   held inside it on a phone.
 * - `box="parent"` has no scroller: the rows stand in the flow of one around it, a dialog's body or
 *   the drawer's, so no scroller stands inside another with nothing beside it.
 * - The sentinel lies over the last rows, so the next page is on its way before the reader reaches
 *   the end, and so a focused last control, whose `scroll-margin` leaves a thin line beneath it just
 *   out of view, still brings it. The observer has the default root, which clips by every scroller
 *   on the way up, so it serves both modes and a closed `v-show` section asks for nothing.
 * - An observer does not fire while its target simply stays in view, so a page too short to fill the
 *   box would stall: the sentinel is observed again whenever the rows or what is on its way change,
 *   which fires once at once.
 * - Try again takes its own button away, so the focus waits on the rows and then goes to the first
 *   control of what landed, as `ListFrame`'s "Show N more" hands it on, or back to Try again should
 *   the page fail again. A reader who has moved it meanwhile keeps it where they put it.
 *
 * `ListFrame` is the other list: its rows are already read whole, so it can find among them and count
 * them, and a list the server pages can do neither (`docs/design-system.md`).
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ReadFailed from '@/components/ReadFailed.vue';
import ScrollBox from '@/components/ScrollBox.vue';
import { FOCUSABLE } from '@/utils/focusable';

const props = withDefaults(
  defineProps<{
    /** More can come. */
    hasMore: boolean;
    /** A page is on its way. */
    loading?: boolean;
    /** Why the last page failed; empty otherwise. */
    error?: string;
    /** Its own scroller, or the one around it. */
    box?: 'own' | 'parent';
    /** Names the box as a region while it scrolls. */
    label?: string;
    /** `<testid>-box` on the box and its shades, `<testid>-sentinel`, `<testid>-loading`, and
     * `ReadFailed`'s two under `<testid>`. */
    testid: string;
  }>(),
  { loading: false, error: '', box: 'own', label: undefined },
);

const emit = defineEmits<{
  /** Asks for the next page: its end came into view, or Try again was pressed. */
  more: [];
}>();

defineSlots<{ default: () => unknown }>();

const rows = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);
const failed = ref<HTMLElement | null>(null);

const asksAtTheEnd = computed(() => props.hasMore && !props.error);

const boxProps = computed(() =>
  props.box === 'own'
    ? { axis: 'y', label: props.label, testid: `${props.testid}-box` }
    : { 'data-testid': `${props.testid}-box` },
);

let view: IntersectionObserver | null = null;
let changes: MutationObserver | null = null;

function observeSentinel() {
  view?.disconnect();
  if (sentinel.value) view?.observe(sentinel.value);
}

onMounted(() => {
  // A test's DOM has no observer, as `ScrollBox` finds with `ResizeObserver`.
  if (typeof IntersectionObserver !== 'undefined') {
    view = new IntersectionObserver((seen) => {
      if (seen.at(-1)?.isIntersecting && !props.loading) emit('more');
    });
  }
  observeSentinel();
  changes = new MutationObserver(observeSentinel);
  changes.observe(rows.value!, { childList: true, subtree: true });
});

onUnmounted(() => {
  view?.disconnect();
  changes?.disconnect();
});

// A page can land with no new row, which only this sees, and the rows' own change is `changes`.
watch(() => props.loading, observeSentinel, { flush: 'post' });

function controls(): HTMLElement[] {
  return [...(rows.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
    (control) => control.checkVisibility?.({ checkVisibilityCSS: true }) ?? true,
  );
}

/** The controls there were as Try again was pressed; none while nobody is waiting on it. */
let triedFrom: Set<HTMLElement> | null = null;

function tryAgain() {
  triedFrom = new Set(controls());
  rows.value?.focus({ preventScroll: true });
  emit('more');
}

watch(
  () => props.loading,
  (onItsWay) => {
    if (onItsWay || !triedFrom) return;
    const before = triedFrom;
    triedFrom = null;
    if (document.activeElement !== rows.value) return;
    if (props.error) failed.value?.querySelector('button')?.focus();
    else
      controls()
        .find((control) => !before.has(control))
        ?.focus();
  },
  { flush: 'post' },
);
</script>

<template>
  <component
    :is="box === 'own' ? ScrollBox : 'div'"
    class="paged-list"
    :class="`paged-list--${box}`"
    v-bind="boxProps"
  >
    <div class="paged-list__content">
      <!-- Not a Tab stop: what Try again's focus waits on, inside the scroller so the keys reach it. -->
      <div ref="rows" class="paged-list__rows" tabindex="-1">
        <slot />
        <div
          v-if="asksAtTheEnd"
          ref="sentinel"
          class="paged-list__sentinel"
          aria-hidden="true"
          :data-testid="`${testid}-sentinel`"
        ></div>
      </div>
      <!-- There before it speaks, so a reader hears the words arrive. -->
      <p class="paged-list__loading" role="status" :data-testid="`${testid}-loading`">
        <template v-if="loading">Loading…</template>
      </p>
      <div v-if="error" ref="failed">
        <ReadFailed :name="testid" :message="error" @retry="tryAgain" />
      </div>
    </div>
  </component>
</template>

<style scoped>
.paged-list {
  min-width: 0;
}

/* A maximum, so a short list is only as tall as it is. Its corners clip the shades, as a table's do. */
.paged-list--own {
  max-height: min(28rem, 60dvh);
  overflow: hidden;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

/* `ScrollBox` stops a scroll at its end, so a dialog's own body never moves the page behind it. This
   box stands inside such a body, and a reader on a phone must be able to scroll on past it. */
.paged-list--own :deep(.scroll-box__scroller) {
  overscroll-behavior-y: auto;
}

/* The padding is the content's, as `ScrollBox` asks: the shades lie at the box's edge, and a control's
   focus halo has room inside it. */
.paged-list--own .paged-list__content {
  padding: var(--space-2) var(--space-3);
}

.paged-list__rows {
  position: relative;
}

/* Over the last rows and never past them, so it adds nothing to what scrolls. About two or three
   entries of reach; it takes no pointer, so what it lies over still answers. */
.paged-list__sentinel {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 12rem;
  max-height: 100%;
  pointer-events: none;
}

.paged-list__loading {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.paged-list__loading:not(:empty) {
  padding-top: var(--space-2);
}

.paged-list__content :deep(.read-failed) {
  margin: var(--space-2) 0 0;
}

/* On paper nothing scrolls, and all of what was read prints. */
@media print {
  .paged-list--own {
    max-height: none;
  }
}
</style>
