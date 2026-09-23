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
 */
import { nextTick, ref, watch } from 'vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
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
    /** An error about the submission as a whole. Field errors belong beneath their field. */
    error?: string;
  }>(),
  { cancelLabel: 'Cancel' },
);

const emit = defineEmits<{ close: []; submit: [] }>();

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

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    const focusable = windowEl.value?.querySelector<HTMLElement>(FOCUSABLE);
    (focusable ?? windowEl.value)?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <div
    ref="modalRoot"
    class="dialog-container"
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
        are the entire Enter contract: nothing here listens for a key.
      -->
      <form v-if="confirmLabel" class="dialog-body" @submit.prevent="emit('submit')">
        <slot />

        <p v-if="error" class="dialog-error" :data-testid="`${testid}-error`">{{ error }}</p>

        <footer class="dialog-actions">
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
      </form>

      <div v-else class="dialog-body">
        <slot />
        <p v-if="error" class="dialog-error" :data-testid="`${testid}-error`">{{ error }}</p>
      </div>
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

.dialog-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0%;
  transition: opacity 0.15s ease-in-out;
  z-index: 0;
}

/*
 * Sized by content within a readable band, not by a percentage of the viewport. `width: 25%` gave
 * the create-market dialog 480px on a wide screen and 320px on a laptop, for the same two controls.
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

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

/* In flow, beneath what it is about - never at a coordinate measured against one arrangement. */
.dialog-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.dialog-close {
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
