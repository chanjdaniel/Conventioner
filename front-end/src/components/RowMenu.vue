<script setup lang="ts">
/**
 * A row's "..." menu (E44/F01/S02): the few actions one line offers, behind one button, so a list
 * of lines does not repeat a row of buttons on each.
 *
 * A menu as the phase rail's "More…" is one (bug 44): a menu button that opens into its items,
 * whose arrow keys walk them, and whose Escape - or a press anywhere else - closes it and hands
 * focus back. A choice closes it and hands focus back first, so a dialog the choice opens returns
 * focus to the button when it closes.
 *
 * The `trigger` slot puts words on the button in place of the dots (the app bar's account menu,
 * T209), with the same keys, presses and focus: the words then name the button, as a control's
 * words do, and `label` names the open menu alone.
 *
 * `disabled` makes the dots the one disabled state (`.btn:disabled`'s beige inside a
 * `--mm-border` line), for a row whose actions may not be taken now; the line is carried at rest,
 * transparent, so nothing moves when it appears.
 */
import { nextTick, onUnmounted, ref, useId, watch } from 'vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';

const props = defineProps<{
  /**
   * What the menu is named, and the button too for whoever cannot see the dots: "Change Friday's
   * amount owed". A button with words in the `trigger` slot is named by those.
   */
  label: string;
  items: readonly { id: string; label: string; destructive?: boolean }[];
  testid: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ select: [id: string] }>();

const open = ref(false);
const button = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLElement | null>(null);

function close(returnFocus: boolean) {
  open.value = false;
  if (returnFocus) void nextTick(() => button.value?.focus());
}
useEscapeToClose(open, () => close(true));

function menuItems(): HTMLButtonElement[] {
  return Array.from(list.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

watch(open, (opened) => {
  if (opened) void nextTick(() => menuItems()[0]?.focus());
});

function onKey(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    close(false);
    return;
  }
  const all = menuItems();
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  const last = all.length - 1;
  const to =
    event.key === 'ArrowDown'
      ? (at + 1) % all.length
      : event.key === 'ArrowUp'
        ? (at + last) % all.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null;
  if (to === null) return;
  event.preventDefault();
  all[to]?.focus();
}

function onPointerDown(event: PointerEvent) {
  const menu = button.value?.parentElement;
  if (!menu || menu.contains(event.target as Node)) return;
  close(false);
  // The press moves focus after this event: to what it landed on, if that takes focus, and nowhere
  // if not. Nowhere is where the focused item leaves it as it goes, so the button takes it back.
  // A thumb's drag ends in `pointercancel` instead and moves no focus, so nothing waits on after it.
  const pressEnded = new AbortController();
  document.addEventListener(
    'pointerup',
    () => {
      pressEnded.abort();
      if (document.activeElement === document.body) button.value?.focus({ preventScroll: true });
    },
    { signal: pressEnded.signal },
  );
  document.addEventListener('pointercancel', () => pressEnded.abort(), {
    signal: pressEnded.signal,
  });
}
watch(open, (opened) => {
  if (opened) document.addEventListener('pointerdown', onPointerDown);
  else document.removeEventListener('pointerdown', onPointerDown);
});
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown));

function choose(id: string) {
  button.value?.focus();
  open.value = false;
  emit('select', id);
}

const menuId = `${props.testid}-${useId()}-menu`;
</script>

<template>
  <div class="row-menu">
    <button
      ref="button"
      type="button"
      class="row-menu-button"
      :class="{ 'row-menu-button--words': $slots.trigger }"
      :aria-label="$slots.trigger ? undefined : label"
      aria-haspopup="menu"
      :aria-controls="menuId"
      :aria-expanded="open"
      :disabled="disabled"
      :data-testid="`${testid}-button`"
      @click="open = !open"
    >
      <slot name="trigger">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </slot>
    </button>
    <div
      v-if="open"
      :id="menuId"
      ref="list"
      class="row-menu-list"
      role="menu"
      :aria-label="label"
      :data-testid="testid"
      @keydown="onKey"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        role="menuitem"
        tabindex="-1"
        class="row-menu-item"
        :class="{ 'row-menu-item--destructive': item.destructive }"
        :data-testid="`${testid}-${item.id}`"
        @click="choose(item.id)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.row-menu {
  position: relative;
  flex-shrink: 0;
}

.row-menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.row-menu-button svg {
  fill: currentColor;
}

/* Words on the button: its row's ink, the words' room, and as wide as its parent lets it be. */
.row-menu-button--words {
  display: flex;
  gap: var(--space-1);
  max-width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  /* No line at rest, so the words' box keeps its size: only the dots are ever disabled, and the
     contrast sweep fails a disabled box that draws no line. */
  border: none;
  color: var(--mm-black);
  font-size: var(--text-sm);
}

.row-menu-button:hover:not(:disabled),
.row-menu-button[aria-expanded='true'] {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.row-menu-button:disabled {
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  border-color: var(--mm-border);
  cursor: not-allowed;
}

.row-menu-list {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 20;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.row-menu-item {
  min-height: var(--target-min);
  border: none;
  background: white;
  padding: var(--space-2) var(--space-3);
  text-align: left;
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
  white-space: nowrap;
}

.row-menu-item:hover,
.row-menu-item:focus-visible {
  background: var(--mm-beige);
}

.row-menu-item--destructive {
  color: var(--mm-red);
}
</style>
