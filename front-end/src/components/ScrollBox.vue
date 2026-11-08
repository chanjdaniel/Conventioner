<script setup lang="ts">
/**
 * The one in-app scroller (T217): a box with no bar, by `base.css`'s rule, that shades each edge with
 * more beyond it, so it still says it scrolls, and looks the same whatever bar the browser would draw.
 *
 * A class passed to it lands on the root, which is what a screen sizes and borders; padding belongs
 * in the slot's content, or the shades lie over it rather than at the box's edge, and a child's focus
 * halo needs that padding inside the scroller. It is `docs/design-system.md`'s rule, in one place.
 *
 * With its bar gone a keyboard needs a way in, and Safari gives a scroller no Tab stop of its own: so
 * while it overflows with nothing inside it to take focus it carries `tabindex="0"`, and otherwise
 * none, since a focusable child already takes the arrow keys. A stop holding focus stays one until
 * focus leaves it, or a control arriving inside could drop that focus to `<body>`. A screen that
 * moves focus to the box itself says `focusable`, and the stop stays whatever the box holds. A stop
 * also carries `data-scroll-stop`, which is how a dialog tells it from a control. A `label` makes it
 * a region only while it scrolls or is a stop, so a strip that fits at a desk adds no landmark there.
 *
 * A text entry (a field, a select, a text area) takes focus but keeps the arrow keys, Page Down and
 * Space for itself. In a strip of fields that is enough, as Tab brings each field's column into view;
 * a find field over rows nothing else focuses brings no row into view, so a box that may hold one
 * says `fieldsLeaveTheStop`, and a text entry inside it leaves the box its stop, one Shift+Tab before
 * the field. A dialog's scrollers say it (T223).
 *
 * A combobox's list says `listbox`: its scroller is the listbox its field names, and never a Tab stop,
 * since the field keeps the focus and keys it by `aria-activedescendant`. Its `tabindex="-1"` is what
 * stops a browser making a stop of a scroller by itself, as Chromium does, which took a Tab press
 * into a list that closes as the field is left, and dropped the focus to `<body>`.
 *
 * A strip that scrolls only where its own rule asks, and at a desk would have its child's outer halo
 * clipped for nothing, sets `--scroll-box-overflow: visible` on its root where it does not scroll, and
 * `inherit` under the rule that lets it, to take `base.css`'s value back.
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { FOCUSABLE } from '@/utils/focusable';

const props = withDefaults(
  defineProps<{
    /** Which way it scrolls, and so which edges can be shaded. */
    axis?: 'y' | 'x' | 'both';
    /** The ground the shade lies on: the market bar's is `dark`. */
    tone?: 'light' | 'dark';
    /** `<testid>` on the scroller, `<testid>-shade-top|bottom|left|right` on the shades. */
    testid?: string;
    /** The shades' test id prefix, for a dialog that keeps `<testid>-shade-*` beside `-body`. */
    shadeTestid?: string;
    /** Names the scroller as a region while it scrolls, for a table a keyboard scrolls sideways. */
    label?: string;
    /** Always a Tab stop, for a panel that puts focus on its body as it opens. */
    focusable?: boolean;
    /** A text entry inside does not stand in for the stop, as a find field over rows does not. */
    fieldsLeaveTheStop?: boolean;
    /** The scroller is a combobox's listbox, which its field keys, so it is never a Tab stop. */
    listbox?: { id: string; label: string; multiple?: boolean };
  }>(),
  { axis: 'y', tone: 'light' },
);

const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);

/** Which edges have more beyond them, and whether the keys need a stop on the scroller itself. */
const more = reactive({ top: false, bottom: false, left: false, right: false });
const overflows = ref(false);
const needsStop = ref(false);

const SHADES = ['top', 'bottom', 'left', 'right'] as const;
const shades = computed(() => SHADES.filter((edge) => more[edge]));
const shadePrefix = computed(() => props.shadeTestid ?? props.testid);
const isRegion = computed(() => !!props.label && (props.focusable || overflows.value));
const isStop = computed(() => !props.listbox && (props.focusable || needsStop.value));
const stopIndex = computed(() => (isStop.value ? 0 : props.listbox ? -1 : undefined));

/** What keeps the scroll keys for itself when focused: a text entry, a select, a radio's arrows. */
const TEXT_ENTRY =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type=checkbox], ' +
  '[type=button], [type=submit], [type=reset], [type=image], [type=file], [type=color])';

/**
 * Whether something inside can take the keys: a `display: none` control cannot, nor, with
 * `fieldsLeaveTheStop`, a text entry.
 */
function holdsFocusable(box: HTMLElement): boolean {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].some(
    (element) =>
      !(props.fieldsLeaveTheStop && element.matches(TEXT_ENTRY)) &&
      (element.checkVisibility?.({ checkVisibilityCSS: true }) ?? true),
  );
}

/** A pixel of slack at the far edges, since a zoomed browser stops a scroll a fraction short. */
function measure() {
  const box = scroller.value;
  if (!box) return;
  const down = props.axis !== 'x';
  const across = props.axis !== 'y';
  more.top = down && box.scrollTop > 0;
  more.bottom = down && box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  more.left = across && box.scrollLeft > 0;
  more.right = across && box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
  overflows.value = more.top || more.bottom || more.left || more.right;
  needsStop.value =
    document.activeElement === box ||
    (overflows.value && !!content.value && !holdsFocusable(content.value));
}

/*
 * Measured as it scrolls, and as it or its content is resized, since content growing inside a box
 * already at its cap resizes nothing but the content. A control can come or go with no change of
 * size, a row's words swapped for a button, and that moves the Tab stop alone.
 */
let resizes: ResizeObserver | null = null;
let changes: MutationObserver | null = null;

onMounted(() => {
  const box = scroller.value!;
  const inner = content.value!;
  measure();
  if (typeof ResizeObserver !== 'undefined') {
    resizes = new ResizeObserver(measure);
    resizes.observe(box);
    resizes.observe(inner);
  }
  changes = new MutationObserver(measure);
  changes.observe(inner, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'tabindex', 'href', 'hidden', 'contenteditable'],
  });
});

onUnmounted(() => {
  resizes?.disconnect();
  changes?.disconnect();
});

defineExpose({ scroller });
</script>

<template>
  <div class="scroll-box" :class="{ 'scroll-box--dark': tone === 'dark' }" data-scroll-box>
    <div
      ref="scroller"
      class="scroll-box__scroller"
      :class="`scroll-box__scroller--${axis}`"
      :data-testid="testid"
      :id="listbox?.id"
      :role="listbox ? 'listbox' : isRegion ? 'region' : undefined"
      :aria-label="listbox?.label ?? (isRegion ? label : undefined)"
      :aria-multiselectable="listbox?.multiple ? 'true' : undefined"
      :tabindex="stopIndex"
      :data-scroll-stop="isStop ? '' : undefined"
      @scroll="measure"
      @blur="measure"
    >
      <div ref="content" class="scroll-box__content">
        <slot />
      </div>
    </div>
    <div
      v-for="edge in shades"
      :key="edge"
      class="scroll-box__shade"
      :class="`scroll-box__shade--${edge}`"
      aria-hidden="true"
      :data-testid="shadePrefix ? `${shadePrefix}-shade-${edge}` : undefined"
    ></div>
  </div>
</template>

<style scoped>
.scroll-box {
  --scroll-box-shade: var(--edge-shade);

  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.scroll-box--dark {
  --scroll-box-shade: var(--edge-shade-on-dark);
}

/* Relative, or something absolute inside it, a chip's `.visually-hidden` words, answers to the box
   around it, neither scrolling nor clipped with it, and can run past a window's foot. */
.scroll-box__scroller {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.scroll-box__scroller--y {
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.scroll-box__scroller--x {
  overflow: var(--scroll-box-overflow);
}

.scroll-box__scroller--both {
  overflow: auto;
  overscroll-behavior-y: contain;
}

/* A box that clips what lies past its edge cuts an outer halo off, so a Tab stop wears the inset one. */
.scroll-box__scroller:focus-visible {
  border-radius: var(--radius-control);
  box-shadow: var(--focus-halo-inset);
}

/* Its own formatting context, so its height holds its children's margins and the observer sees them;
   sideways as wide as what it holds cannot give up, or a table outgrowing it would resize nothing:
   not `max-content`, or a table whose cells can wrap would run one line wide rather than fit. */
.scroll-box__content {
  display: flow-root;
  min-width: 0;
}

.scroll-box__scroller--x > .scroll-box__content,
.scroll-box__scroller--both > .scroll-box__content {
  width: fit-content;
  min-width: 100%;
}

/* Above whatever scrolls beneath it, and taking no pointer, so what it lies over still answers. */
.scroll-box__shade {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.scroll-box__shade--top,
.scroll-box__shade--bottom {
  inset-inline: 0;
  height: var(--edge-shade-depth);
}

.scroll-box__shade--left,
.scroll-box__shade--right {
  inset-block: 0;
  width: var(--edge-shade-depth);
}

.scroll-box__shade--top {
  top: 0;
  background: linear-gradient(to bottom, var(--scroll-box-shade), transparent);
}

.scroll-box__shade--bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--scroll-box-shade), transparent);
}

.scroll-box__shade--left {
  left: 0;
  background: linear-gradient(to right, var(--scroll-box-shade), transparent);
}

.scroll-box__shade--right {
  right: 0;
  background: linear-gradient(to left, var(--scroll-box-shade), transparent);
}

/* On paper nothing scrolls: all of it prints, with no sign that there is more. */
@media print {
  /* Over a screen's class on the root, which may clip its border's corners. */
  .scroll-box {
    overflow: visible !important;
  }

  .scroll-box__scroller {
    overflow: visible;
  }

  /* As wide as the page, not as wide as what it holds, so a table that can wrap fits it. */
  .scroll-box__scroller--x > .scroll-box__content,
  .scroll-box__scroller--both > .scroll-box__content {
    width: auto;
  }

  .scroll-box__shade {
    display: none;
  }
}
</style>
