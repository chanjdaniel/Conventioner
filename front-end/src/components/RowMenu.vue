<script setup lang="ts">
/**
 * A row's "..." menu (E44/F01/S02): the few actions one line offers, behind one button, so a list
 * of lines does not repeat a row of buttons on each.
 *
 * A menu as the phase rail's "More…" is one (bug 44): a menu button that opens into its items,
 * whose arrow keys walk them, and whose Escape - or a press anywhere else - closes it and hands
 * focus back. A choice closes it and hands focus back first, so a dialog the choice opens returns
 * focus to the button when it closes.
 */
import { nextTick, onUnmounted, ref, useId, watch } from 'vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';

const props = defineProps<{
  /** What the button is named, for whoever cannot see the dots: "Change Friday's amount owed". */
  label: string;
  items: readonly { id: string; label: string; destructive?: boolean }[];
  testid: string;
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
  if (menu && !menu.contains(event.target as Node)) close(false);
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
      :aria-label="label"
      aria-haspopup="menu"
      :aria-controls="menuId"
      :aria-expanded="open"
      :data-testid="`${testid}-button`"
      @click="open = !open"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="3" cy="8" r="1.5" />
        <circle cx="8" cy="8" r="1.5" />
        <circle cx="13" cy="8" r="1.5" />
      </svg>
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
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.row-menu-button svg {
  fill: currentColor;
}

.row-menu-button:hover,
.row-menu-button[aria-expanded='true'] {
  background: var(--mm-beige);
  color: var(--mm-black);
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
