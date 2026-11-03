<script setup lang="ts">
/**
 * What a dialog is in this product (E20/F01/S01).
 *
 * Five overlays each hand-rolled a scrim, a window and a close control, and **not one of them
 * contained a form element**. That is the whole of why Enter did nothing in four dialogs while six
 * other places each solved it differently - `@keydown.enter` here, `@keyup.enter` there, two of
 * them with `.prevent`.
 *
 * Four rules, decided in wayfinding ticket 08 and owned here so no dialog has to remember them:
 *
 * 1. **The dialog is a native `<form>` and its confirm button is `type="submit"`.** Enter then runs
 *    the same handler as the button, so it inherits that handler's guard, and a disabled submit
 *    makes Enter inert with no extra code. Six views already get Enter free exactly this way.
 * 2. **Closing never means saved, and saving never closes.** This shell emits `submit` and `close`
 *    as separate things and never turns one into the other; a dialog that should close after
 *    saving closes itself.
 * 3. **A field looks like a field.** Not this component's job directly, but it is why the body is
 *    a plain slot with no input styling of its own to fight `primitives.css`.
 * 4. **Errors sit in the layout, not on top of it.** There is no absolutely positioned error here.
 *    An error belongs beneath the control it describes, which is the body's business; the
 *    `error` prop is for one that is about the submission as a whole and renders in flow above
 *    the actions.
 *
 * A dialog that hosts several independent actions - Manage organization has three - passes no
 * `confirmLabel`, and gets the scrim, window, close, Escape, backdrop and inert behaviour without
 * the single-form footer. Its own forms live in the body.
 *
 * A long dialog asks for `scroll="body"` (T200): its title, close, error and actions stay in view
 * and only its body scrolls, inside a box of its own, so the window keeps its rounded corners and
 * the body its width; a shade at the body's top or bottom edge says there is more that way, and a
 * `tray` slot holds what the dialog has gathered, pinned above the actions. The window scrolling
 * whole stays the default until every dialog is converted (`dialogs.md`, the expand-contract plan).
 */
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useFocusGoesBack } from '@/utils/useFocusGoesBack';
import { useModalRoot } from '@/utils/useModalRoot';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** Test id prefix, so each dialog keeps stable ids: `<testid>-window`, `-close-button`, … */
    testid: string;
    /**
     * The confirm button's label. Its PRESENCE is what makes this dialog a single form with a
     * footer; a dialog of several independent actions leaves it out.
     */
    confirmLabel?: string;
    confirmDisabled?: boolean;
    cancelLabel?: string;
    /** A destructive confirm wears the destructive primitive - archive, delete. */
    destructive?: boolean;
    /**
     * The window's width, a step and never a free width: a percentage per dialog is what the
     * product had. `narrow` (26rem) holds two controls, `wide` (38rem) a list, and `broad` (60rem)
     * a list beside what it gathers, the export dialog's columns and preview.
     */
    size?: 'narrow' | 'wide' | 'broad';
    /** `size="wide"`, until the conversions remove it; a `size` wins over it. */
    wide?: boolean;
    /**
     * What scrolls when the content is taller than the window: the whole `window` (today's), or
     * only the `body`, with the title, close, error, tray and actions pinned.
     */
    scroll?: 'window' | 'body';
    /**
     * A dialog whose body grows as it is used (a field's error appearing as a key is typed) holds
     * its top where it opened, rather than its centre, so nothing under the pointer moves.
     */
    anchored?: boolean;
    /** An error about the submission as a whole. Field errors belong beneath their field. */
    error?: string;
  }>(),
  { cancelLabel: 'Cancel', scroll: 'window' },
);

const emit = defineEmits<{ close: []; submit: [] }>();

const width = computed(() => props.size ?? (props.wide ? 'wide' : 'narrow'));
const pinned = computed(() => props.scroll === 'body');

useEscapeToClose(
  () => props.open,
  () => emit('close'),
);

/** Modal: the page behind it goes out of the tab order, not just out of reach of the mouse. */
const modalRoot = useModalRoot(() => props.open);

const windowEl = ref<HTMLElement | null>(null);

/**
 * Focus moves into the dialog when it opens.
 *
 * Not a nicety: `useInertBehind` marks the page behind, and the button that opened the dialog is
 * on that page - so focus would otherwise sit on an inert element, with nowhere sensible for the
 * first Tab to come from.
 *
 * `:not(:disabled)` is load-bearing. The create-market dialog's first control is the organization
 * select, which is disabled while it fetches, and `focus()` on a disabled element is a silent
 * no-op - so focus stayed on `<body>` and the dialog opened with nothing focused at all. The
 * window itself is the fallback, so focus is inside the dialog even when every control is busy.
 */
const FOCUSABLE =
  'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], button:not(:disabled):not([data-dialog-close])';

/**
 * The control a dialog opens on: its first, never a destructive one. For the same reason a
 * destructive dialog opens on Cancel, a dialog listing people never opens on the first person's
 * Remove, which one stray Enter would take: Manage organization opened on its first admin's.
 */
function firstSafeControl(): HTMLElement | null {
  const controls = windowEl.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
  return [...controls].find((control) => !control.classList.contains('btn--destructive')) ?? null;
}

/** Focus goes back to what opened the dialog when it closes, by any path. */
useFocusGoesBack(() => props.open);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    /*
     * A DESTRUCTIVE dialog opens on Cancel, deliberately. Its confirm is irreversible - archiving
     * takes a live check-in URL off the air - and a dialog that opens with that button focused
     * turns one stray Enter into the whole action. Cancel is a `type="button"`, so Enter there
     * cancels rather than submitting, and the idiom is intact: Enter still does what the focused
     * control says.
     *
     * DOM order already put Cancel first; this makes it a decision rather than something that
     * would change quietly the next time the footer is reordered.
     */
    const preferred = props.destructive
      ? windowEl.value?.querySelector<HTMLElement>(`[data-testid="${props.testid}-cancel-button"]`)
      : null;
    const focusable = preferred ?? firstSafeControl();
    (focusable ?? windowEl.value)?.focus();
  },
  { immediate: true },
);

/*
 * The edge shades of a body that scrolls: each drawn only while there is more that way. Measured
 * as the body scrolls, and as it or its content is resized, since content growing inside a body
 * already at its cap resizes nothing but the content. A pixel of slack, since a zoomed browser
 * stops a scroll a fraction short of the end.
 */
const scroller = ref<HTMLElement | null>(null);
const scrolled = ref<HTMLElement | null>(null);
const shade = reactive({ top: false, bottom: false });

function measure() {
  const el = scroller.value;
  shade.top = !!el && el.scrollTop > 0;
  shade.bottom = !!el && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

let observer: ResizeObserver | null = null;

watch(
  [scroller, scrolled],
  ([box, content]) => {
    observer?.disconnect();
    observer = null;
    measure();
    if (!box || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver(measure);
    observer.observe(box);
    if (content) observer.observe(content);
  },
  { flush: 'post' },
);

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div
    ref="modalRoot"
    class="dialog-container"
    :class="{ 'dialog-container--anchored': anchored }"
    :style="{ visibility: open ? 'visible' : 'hidden' }"
  >
    <div
      class="dialog-scrim"
      :style="{ opacity: open ? '100%' : '0%' }"
      :data-testid="`${testid}-background`"
      @click="emit('close')"
    ></div>

    <div
      v-if="open"
      ref="windowEl"
      class="dialog-window"
      :class="{
        'dialog-window--wide': width === 'wide',
        'dialog-window--broad': width === 'broad',
        'dialog-window--body': pinned,
      }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      :data-testid="`${testid}-window`"
      tabindex="-1"
    >
      <button
        type="button"
        class="dialog-close"
        aria-label="Close"
        data-dialog-close
        :data-testid="`${testid}-close-button`"
        @click="emit('close')"
      >
        &times;
      </button>

      <h2 class="dialog-title">{{ title }}</h2>

      <!--
        The form, when this dialog is one action. `@submit.prevent` and a `type="submit"` confirm
        are the entire Enter contract: nothing here listens for a key. A dialog of several actions
        is a plain box, and hosts its own forms in its body.
      -->
      <component
        :is="confirmLabel ? 'form' : 'div'"
        class="dialog-body"
        :class="{ 'dialog-body--pinned': pinned }"
        @submit.prevent="emit('submit')"
      >
        <!--
          Only the body scrolls, in a box of its own between the pinned parts, so its scroll bar
          never reaches the window's rounded corners; the shades lie over its edges and take no
          pointer.
        -->
        <div v-if="pinned" class="dialog-scroll">
          <div
            ref="scroller"
            class="dialog-scroller"
            :data-testid="`${testid}-body`"
            @scroll="measure"
          >
            <div ref="scrolled" class="dialog-scrolled">
              <slot />
            </div>
          </div>
          <div
            v-if="shade.top"
            class="dialog-shade dialog-shade--top"
            aria-hidden="true"
            :data-testid="`${testid}-shade-top`"
          ></div>
          <div
            v-if="shade.bottom"
            class="dialog-shade dialog-shade--bottom"
            aria-hidden="true"
            :data-testid="`${testid}-shade-bottom`"
          ></div>
        </div>
        <slot v-else />

        <div v-if="$slots.tray" class="dialog-tray" :data-testid="`${testid}-tray`">
          <slot name="tray" />
        </div>

        <p v-if="error" class="dialog-error" :data-testid="`${testid}-error`">{{ error }}</p>

        <footer v-if="confirmLabel" class="dialog-actions">
          <slot name="actions">
            <button
              type="button"
              class="btn btn--secondary"
              :data-testid="`${testid}-cancel-button`"
              @click="emit('close')"
            >
              {{ cancelLabel }}
            </button>
            <button
              type="submit"
              class="btn"
              :class="destructive ? 'btn--destructive' : 'btn--primary'"
              :disabled="confirmDisabled"
              :data-testid="`${testid}-submit-button`"
            >
              {{ confirmLabel }}
            </button>
          </slot>
        </footer>
      </component>
    </div>
  </div>
</template>

<style scoped>
.dialog-container {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
}

.dialog-container--anchored {
  align-items: flex-start;
  padding-top: var(--space-12);
}

.dialog-container--anchored .dialog-window {
  max-height: calc(100vh - var(--space-12) - var(--space-6));
}

.dialog-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0%;
  transition: opacity 0.15s ease-in-out;
  z-index: 0;
}

/*
 * Three widths, 26rem, 38rem when `wide` and 60rem when `broad`, never wider than the window less a
 * gutter at each side; never a percentage of the viewport. `width: 25%` gave the create-market
 * dialog 480px on a wide screen and 320px on a laptop, for the same two controls.
 */
.dialog-window {
  position: relative;
  z-index: 1;
  width: min(100% - 2 * var(--space-4), 26rem);
  max-height: calc(100vh - 2 * var(--space-6));
  overflow-y: auto;
  padding: var(--space-6);

  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  background: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.dialog-window--wide {
  width: min(100% - 2 * var(--space-4), 38rem);
}

.dialog-window--broad {
  width: min(100% - 2 * var(--space-4), 60rem);
}

.dialog-title {
  margin: 0;
  padding-right: var(--space-6);
  font-size: var(--text-lg);
  color: var(--mm-black);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Wraps when its buttons are wider than the window, as on a phone: a row that cannot wrap ran out
   past the window's left edge, where nothing scrolls to it. */
.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

/* In flow, beneath what it is about - never at a coordinate measured against one arrangement. */
.dialog-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

/*
 * `scroll="body"`: the window no longer scrolls, its parts stack edge to edge, and each pinned part
 * brings its own inset, so the scroll bar is the body's, between the title and the actions, and
 * never cuts the window's corners. `dvh`, since a phone's browser bar would otherwise cover the
 * pinned actions of a dialog as tall as the window.
 */
.dialog-window--body {
  max-height: calc(100dvh - 2 * var(--space-6));
  overflow: hidden;
  padding: 0;
  gap: 0;
}

.dialog-container--anchored .dialog-window--body {
  max-height: calc(100dvh - var(--space-12) - var(--space-6));
}

.dialog-window--body > .dialog-title {
  flex: none;
  padding: var(--space-6) calc(var(--space-6) + var(--space-6)) var(--space-2) var(--space-6);
}

/* The parts between the title and the window's foot: 16px apart, as the window's gap sets them
   when it scrolls whole, made of each part's 8px above and below; the foot's 16px more makes the
   window's 24px inset. */
.dialog-body--pinned {
  flex: 1 1 auto;
  min-height: 0;
  gap: 0;
  padding-bottom: var(--space-4);
}

.dialog-scroll {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* Its block padding is room for a control's focus halo at the body's top and bottom edge. */
.dialog-scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-2) var(--space-6);
}

/* A body with nothing to focus is a keyboard stop of the browser's own; the window clips any halo
   drawn outside it. */
.dialog-scroller:focus-visible {
  box-shadow: var(--focus-halo-inset);
}

.dialog-scrolled {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.dialog-shade {
  position: absolute;
  inset-inline: 0;
  height: var(--edge-shade-depth);
  pointer-events: none;
}

.dialog-shade--top {
  top: 0;
  background: linear-gradient(to bottom, var(--edge-shade), transparent);
}

.dialog-shade--bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--edge-shade), transparent);
}

/* What the dialog has gathered, set off from the body by a rule. */
.dialog-tray {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--mm-border);
}

/* Pinned, it keeps its height up to its cap, the body giving way, and scrolls inside itself past
   the cap. */
.dialog-body--pinned > .dialog-tray {
  flex: none;
  max-height: 40dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-3) var(--space-6) var(--space-2);
}

.dialog-body--pinned > .dialog-error,
.dialog-body--pinned > .dialog-actions {
  flex: none;
  padding: var(--space-2) var(--space-6);
}

/* A phone: a dialog whose body scrolls is as tall as the window less the gutter, so its pinned
   parts never crowd the body to nothing. */
@media (width <= 640px) {
  .dialog-window--body {
    height: calc(100dvh - 2 * var(--space-6));
  }

  .dialog-container--anchored .dialog-window--body {
    height: calc(100dvh - var(--space-12) - var(--space-6));
  }
}

.dialog-close {
  min-width: var(--target-min);
  min-height: var(--target-min);
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
  background: none;
  border: none;
  font-size: var(--text-xl);
  line-height: 1;
  padding: var(--space-hairline) var(--space-2);
  color: var(--mm-text-muted);
  cursor: pointer;
}

.dialog-close:hover {
  color: var(--mm-black);
}
</style>
