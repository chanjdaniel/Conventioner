<script setup lang="ts">
/**
 * What a side panel is (T200): a modal that slides in from a side of the window, its title and close
 * pinned at its top and only its body scrolling. A proposal for now, with the vendor drawer and the
 * navigation drawer each drawing their own (`dev/library`'s `proposals` entry): no screen mounts it.
 *
 * Modal the way `AppDialog` is, through the same composables: Escape and the scrim close it, focus
 * moves in and goes back, and the page behind is inert. It never closes itself: it emits `close`, and
 * the screen that holds `open` closes it. A dialog it opens is mounted beside it, never inside it
 * (`dialogs.md`).
 *
 * Focus moves in to the body, the one thing here the keys can scroll: from the head they would scroll
 * the page behind. So one stray Enter takes nothing, and a panel does not open scrolled down to its
 * first control. The close button lies one Shift+Tab behind.
 *
 * Its content goes as it closes, as a dialog's window does, which drops focus to `<body>` so
 * `useFocusGoesBack` can return it. So the emptied panel is what slides out, as the vendor drawer's
 * does today.
 */
import { nextTick, ref, watch } from 'vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useFocusGoesBack } from '@/utils/useFocusGoesBack';
import { useModalRoot } from '@/utils/useModalRoot';
import ScrollBox from '@/components/ScrollBox.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** Test id prefix: `<testid>-window`, `-title`, `-close-button`, `-background`, `-body`. */
    testid: string;
    side?: 'right' | 'left';
    /** A step and never a free width, as a dialog's: `narrow` (20rem) or `wide` (30rem). */
    width?: 'narrow' | 'wide';
  }>(),
  { side: 'right', width: 'narrow' },
);

const emit = defineEmits<{ close: [] }>();

useEscapeToClose(
  () => props.open,
  () => emit('close'),
);

const modalRoot = useModalRoot(() => props.open);

/** Takes the opener as the panel opens, so focus moves in after a `nextTick`, below. */
useFocusGoesBack(() => props.open);

const body = ref<InstanceType<typeof ScrollBox> | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    body.value?.scroller?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <div ref="modalRoot" class="side-panel" :class="{ 'side-panel--open': open }">
    <div
      class="side-panel__scrim"
      :data-testid="`${testid}-background`"
      @click="emit('close')"
    ></div>

    <aside
      class="side-panel__window"
      :class="[`side-panel__window--${side}`, `side-panel__window--${width}`]"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      :aria-hidden="open ? undefined : 'true'"
      :data-testid="`${testid}-window`"
      tabindex="-1"
    >
      <template v-if="open">
        <header class="side-panel__head">
          <h2 class="side-panel__title" :data-testid="`${testid}-title`">{{ title }}</h2>
          <button
            type="button"
            class="side-panel__close"
            aria-label="Close"
            :data-testid="`${testid}-close-button`"
            @click="emit('close')"
          >
            &times;
          </button>
        </header>
        <ScrollBox
          ref="body"
          class="side-panel__body"
          :testid="`${testid}-body`"
          :shadeTestid="testid"
          focusable
        >
          <div class="side-panel__content">
            <slot />
          </div>
        </ScrollBox>
      </template>
    </aside>
  </div>
</template>

<style scoped>
/*
 * Hidden at once as far as a pointer goes, and in sight until the panel has slid out. It shows at
 * once on opening, with no transition to wait out: a `visibility` transition would still read as
 * hidden when focus moves in, and an element that is hidden takes no focus.
 */
.side-panel {
  position: fixed;
  inset: 0;
  z-index: 60;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
  transition: visibility 0s linear 0.25s;
}

.side-panel--open {
  visibility: visible;
  pointer-events: auto;
  transition-delay: 0s;
}

.side-panel__scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.25s ease-in-out;
}

.side-panel--open .side-panel__scrim {
  opacity: 1;
}

/* The scrim always shows beside it, a gutter a thumb can press, however narrow the window. */
.side-panel__window {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: white;
  box-shadow: var(--shadow-card);
  transition: transform 0.25s ease-in-out;
}

.side-panel__window--narrow {
  width: min(100% - var(--space-8), 20rem);
}

.side-panel__window--wide {
  width: min(100% - var(--space-8), 30rem);
}

.side-panel__window--right {
  right: 0;
  border-radius: var(--radius-card) 0 0 var(--radius-card);
  transform: translateX(100%);
}

.side-panel__window--left {
  left: 0;
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  transform: translateX(-100%);
}

.side-panel--open .side-panel__window {
  transform: none;
}

.side-panel__head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.side-panel__title {
  min-width: 0;
  margin: 0;
  padding-top: var(--space-2);
  font-size: var(--text-lg);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.side-panel__close {
  flex: none;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: var(--space-hairline) var(--space-2);
  background: none;
  border: none;
  font-size: var(--text-xl);
  line-height: 1;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.side-panel__close:hover {
  color: var(--mm-black);
}

.side-panel__body {
  flex: 1 1 auto;
}

.side-panel__content {
  padding: var(--space-4) var(--space-6) var(--space-6);
}
</style>
