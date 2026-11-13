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
 * the single-form footer. Its own forms live in the body. Its buttons can still be pinned at the
 * foot, through the `actions` slot, without its body becoming a form.
 *
 * The window is a rounded frame that never scrolls and draws no bar, so its corners are round
 * whatever the browser draws. What scrolls is a `ScrollBox`. A short dialog keeps `scroll="window"`,
 * one box over the title and the body. A long one asks for `scroll="body"` (T200): its title, close,
 * error and actions stay in view and only its body scrolls; a `tray` slot holds what the dialog has
 * gathered, pinned above the actions (`dialogs.md`).
 */
import { computed, nextTick, ref, watch, type FunctionalComponent } from 'vue';
import EmailAddress from '@/components/EmailAddress.vue';
import ScrollBox from '@/components/ScrollBox.vue';
import { FOCUSABLE } from '@/utils/focusable';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useFocusGoesBack } from '@/utils/useFocusGoesBack';
import { useModalRoot } from '@/utils/useModalRoot';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /**
     * The heading, and the dialog's accessible name. It is drawn through `EmailAddress`, so an
     * address in it, a person's in a Remove or a role change, breaks only before its "@" or a dot,
     * never just after a hyphen (T283, T315); words with no address draw as plain text.
     */
    title: string;
    /** Test id prefix, so each dialog keeps stable ids: `<testid>-window`, `-close-button`, … */
    testid: string;
    /**
     * The confirm button's label. Its PRESENCE is what makes this dialog a single form; a dialog of
     * several independent actions leaves it out. The footer draws with this or the `actions` slot.
     */
    confirmLabel?: string;
    confirmDisabled?: boolean;
    /**
     * Nothing closes it while this holds: a save in flight, whose refusal a close would hide. Cancel
     * and the close control are drawn disabled, and Escape and the scrim do nothing.
     */
    closeDisabled?: boolean;
    cancelLabel?: string;
    /** A destructive confirm wears the destructive primitive - archive, delete. */
    destructive?: boolean;
    /**
     * The window's width, a step and never a free width: a percentage per dialog is what the
     * product had. `narrow` (26rem) holds two controls, `wide` (38rem) a list, and `broad` (60rem)
     * a list beside what it gathers, the export dialog's order and preview.
     */
    size?: 'narrow' | 'wide' | 'broad';
    /**
     * What scrolls when the content is taller than the window: the title and the body together
     * (`window`, the default, for a short dialog), or only the `body`, with the title, close, error,
     * tray and actions pinned.
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
  { size: 'narrow', cancelLabel: 'Cancel', scroll: 'window' },
);

const emit = defineEmits<{ close: []; submit: [] }>();

/**
 * The body's own submit, bound only when the body is the form: a dialog of several actions is a
 * plain box whose own forms' submits bubble through it, and they are theirs, not the dialog's.
 */
function onSubmit(event: Event) {
  event.preventDefault();
  emit('submit');
}

const pinned = computed(() => props.scroll === 'body');

/** The title and the body with nothing around them, as a pinned dialog has them. */
const Unwrapped: FunctionalComponent = (_props, { slots }) => slots.default?.();

/**
 * What holds the title and the body: one `ScrollBox` over both, unless only the body scrolls. A
 * dialog's field leaves its scroller the stop, since a find field brings none of its rows into view.
 */
const whole = computed(() =>
  pinned.value
    ? {}
    : {
        class: 'dialog-whole',
        testid: `${props.testid}-scroll`,
        shadeTestid: props.testid,
        fieldsLeaveTheStop: true,
      },
);

function close() {
  if (!props.closeDisabled) emit('close');
}

useEscapeToClose(() => props.open, close);

/** Modal: the page behind it goes out of the tab order, not just out of reach of the mouse. */
const modalRoot = useModalRoot(() => props.open);

const windowEl = ref<HTMLElement | null>(null);

/**
 * The control a dialog opens on: its first, never a destructive one. For the same reason a
 * destructive dialog opens on Cancel, a dialog listing people never opens on the first person's
 * Remove, which one stray Enter would take: Manage organization opened on its first admin's. A
 * control that takes something away without looking destructive, a chip's Remove, says so with
 * `data-dialog-not-first`. A scroller's own stop is no control: a dialog opens on one only when it
 * has nothing else (below).
 */
function firstSafeControl(): HTMLElement | null {
  const controls = windowEl.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
  return (
    [...controls].find(
      (control) =>
        !control.classList.contains('btn--destructive') &&
        !control.hasAttribute('data-dialog-not-first') &&
        !control.hasAttribute('data-dialog-close') &&
        !control.hasAttribute('data-scroll-stop'),
    ) ?? null
  );
}

/**
 * Focus on the dialog's first control or, with nothing to focus, on what scrolls: from the window
 * the arrow keys would scroll nothing, so a box with more to show takes it, the one that says so by
 * `ScrollBox`'s `data-scroll-stop`. That stop lands a tick after the box measures; a dialog mounted
 * open has not had that tick yet. Exposed for a parent whose control went away with what it did, a
 * reset whose button is disabled now, so focus never falls to `<body>`.
 */
async function focusInside() {
  const control = firstSafeControl();
  if (control) {
    control.focus();
    return;
  }
  windowEl.value?.focus();
  await nextTick();
  if (document.activeElement !== windowEl.value) return;
  windowEl.value?.querySelector<HTMLElement>('[data-scroll-stop]')?.focus();
}

defineExpose({ focusInside });

/** Focus goes back to what opened the dialog when it closes, by any path. */
useFocusGoesBack(() => props.open);

/**
 * Focus moves into the dialog when it opens.
 *
 * Not a nicety: `useInertBehind` marks the page behind, and the button that opened the dialog is
 * on that page - so focus would otherwise sit on an inert element, with nowhere sensible for the
 * first Tab to come from. The window itself is the fallback, so focus is inside the dialog even when
 * every control is busy.
 */
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
    if (preferred) preferred.focus();
    else await focusInside();
  },
  { immediate: true },
);

/**
 * Focus comes back inside when a hold ends. A save in flight disables what held the focus (the
 * confirm, Cancel), so the browser drops it to `<body>`; a refusal ends the hold with the dialog
 * still open, and focus would stay outside it, where no Tab reaches the dialog. Focus left inside
 * stays where it is, and so does focus in another dialog, one opened over this.
 */
watch(
  () => props.closeDisabled,
  async (held, wasHeld) => {
    if (held || !wasHeld || !props.open) return;
    await nextTick();
    if (!props.open) return;
    const active = document.activeElement;
    const kept =
      active &&
      active !== document.body &&
      (windowEl.value?.contains(active) || active.closest('[role="dialog"]'));
    if (!kept) await focusInside();
  },
);
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
      @click="close"
    ></div>

    <div
      v-if="open"
      ref="windowEl"
      class="dialog-window"
      :class="{
        'dialog-window--wide': size === 'wide',
        'dialog-window--broad': size === 'broad',
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
        :disabled="closeDisabled"
        @click="close"
      >
        &times;
      </button>

      <component :is="pinned ? Unwrapped : ScrollBox" v-bind="whole">
        <div class="dialog-parts">
          <h2 class="dialog-title"><EmailAddress :words="title" /></h2>

          <!--
            The form, when this dialog is one action. `@submit.prevent` and a `type="submit"` confirm
            are the entire Enter contract: nothing here listens for a key. A dialog of several
            actions is a plain box, and hosts its own forms in its body.
          -->
          <component
            :is="confirmLabel ? 'form' : 'div'"
            class="dialog-body"
            :class="{ 'dialog-body--pinned': pinned }"
            v-on="confirmLabel ? { submit: onSubmit } : {}"
          >
            <!-- Only the body scrolls, in a box of its own between the pinned parts. -->
            <ScrollBox
              v-if="pinned"
              class="dialog-body-box"
              :testid="`${testid}-body`"
              :shade-testid="testid"
              fields-leave-the-stop
            >
              <div class="dialog-scrolled" :data-testid="`${testid}-scrolled`">
                <slot />
              </div>
            </ScrollBox>
            <slot v-else />

            <template v-if="$slots.tray">
              <ScrollBox v-if="pinned" class="dialog-tray" :testid="`${testid}-tray`">
                <div class="dialog-tray-parts">
                  <slot name="tray" />
                </div>
              </ScrollBox>
              <div v-else class="dialog-tray dialog-tray-parts" :data-testid="`${testid}-tray`">
                <slot name="tray" />
              </div>
            </template>

            <p v-if="error" class="dialog-error" role="alert" :data-testid="`${testid}-error`">
              {{ error }}
            </p>

            <footer v-if="confirmLabel || $slots.actions" class="dialog-actions">
              <slot name="actions">
                <button
                  type="button"
                  class="btn btn--secondary"
                  :data-testid="`${testid}-cancel-button`"
                  :disabled="closeDisabled"
                  @click="close"
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
 *
 * A rounded frame: it never scrolls, so nothing can square its corners. What is taller than it
 * scrolls in the `ScrollBox` inside it.
 */
.dialog-window {
  position: relative;
  z-index: 1;
  width: min(100% - 2 * var(--space-4), 26rem);
  max-height: calc(100vh - 2 * var(--space-6));
  overflow: hidden;

  display: flex;
  flex-direction: column;

  background: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.dialog-whole {
  flex: 1 1 auto;
}

.dialog-parts {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-6);
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
  overflow-wrap: anywhere;
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
 * `scroll="body"`: its parts stack edge to edge, and each pinned part brings its own inset. As tall
 * as its content needs, up to 80% of the window. `dvh`, since a phone's browser bar would otherwise
 * cover the pinned actions of a dialog as tall as the window.
 */
.dialog-window--body {
  max-height: 80dvh;
}

/* The same cap with its top held, over the anchored window's own. */
.dialog-container--anchored .dialog-window--body {
  max-height: 80dvh;
}

.dialog-window--body > .dialog-parts {
  flex: 1 1 auto;
  min-height: 0;
  gap: 0;
  padding: 0;
}

.dialog-window--body > .dialog-parts > .dialog-title {
  flex: none;
  padding: var(--space-6) var(--space-12) var(--space-2) var(--space-6);
}

/* The parts between the title and the window's foot: 16px apart, as `.dialog-parts`' gap sets them
   when the dialog scrolls whole, made of each part's 8px above and below; the foot's 16px more makes
   the window's 24px inset. */
.dialog-body--pinned {
  flex: 1 1 auto;
  min-height: 0;
  gap: 0;
}

.dialog-body--pinned > :last-child:not(.dialog-body-box) {
  margin-bottom: var(--space-4);
}

.dialog-body-box {
  flex: 1 1 auto;
}

/* With nothing pinned beneath it, the body runs to the window's foot, so its shade ends at the
   frame rather than above a blank band, and its own end holds the window's 24px inset. */
.dialog-body-box:last-child .dialog-scrolled {
  padding-bottom: var(--space-6);
}

/* Its block padding is room for a control's focus halo at the body's top and bottom edge. */
.dialog-scrolled {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-2) var(--space-6);
}

/* What the dialog has gathered, set off from the body by a rule. */
.dialog-tray {
  min-width: 0;
  border-top: 1px solid var(--mm-border);
}

.dialog-tray-parts {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding-top: var(--space-3);
}

/* Pinned, it keeps its height up to its cap, the body giving way, and scrolls inside itself past
   the cap. */
.dialog-body--pinned > .dialog-tray {
  flex: none;
  max-height: 40dvh;
}

.dialog-body--pinned .dialog-tray-parts {
  padding: var(--space-3) var(--space-6) var(--space-2);
}

.dialog-body--pinned > .dialog-error,
.dialog-body--pinned > .dialog-actions {
  flex: none;
  padding: var(--space-2) var(--space-6);
}

/* Where `--target-min` makes the close 44px wide, a long title wraps 8px short of it. */
@media (width <= 640px) {
  .dialog-title {
    padding-right: calc(var(--space-8) + var(--space-2));
  }

  .dialog-window--body > .dialog-parts > .dialog-title {
    padding-right: calc(var(--space-12) + var(--space-4));
  }
}

/* A phone, or a window split so short that 80% of it would leave the body nothing: a dialog whose
   body scrolls is as tall as the window less the gutter, so its pinned parts never crowd it. */
@media (width <= 640px), (height <= 640px) {
  .dialog-window--body {
    height: calc(100dvh - 2 * var(--space-6));
    max-height: calc(100dvh - 2 * var(--space-6));
  }

  .dialog-container--anchored .dialog-window--body {
    height: calc(100dvh - var(--space-12) - var(--space-6));
    max-height: calc(100dvh - var(--space-12) - var(--space-6));
  }
}

/* Over what scrolls beneath it when the window scrolls whole, its own ground keeping a row's words
   from running through it; a `ScrollBox`'s shade comes later in the same layer and lies over it. */
.dialog-close {
  min-width: var(--target-min);
  min-height: var(--target-min);
  position: absolute;
  z-index: 1;
  top: var(--space-2);
  right: var(--space-3);
  background: white;
  border: 1px solid transparent;
  font-size: var(--text-xl);
  line-height: 1;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- less the border's width, not spacing: the box stays the size it was with no line */
  padding: calc(var(--space-hairline) - 1px) calc(var(--space-2) - 1px);
  color: var(--mm-text-muted);
  cursor: pointer;
}

.dialog-close:hover:not(:disabled) {
  color: var(--mm-black);
}

/* The one disabled state, and its line is why a transparent one stands at rest. */
.dialog-close:disabled {
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  border-color: var(--mm-border);
  cursor: not-allowed;
}
</style>
