<script setup lang="ts">
/**
 * The one way a screen takes a file (T205, F11 of the 2026-11-02 walk): the import, the start from
 * a Google Form and the floorplan uploader drop onto this zone, where each had drawn its own and the
 * copies had drifted apart.
 *
 * - A label around a visually hidden file input, so a click anywhere on the zone opens the chooser.
 *   The input is named by the zone's main line and described by its hint.
 * - It says it will take a file while one is over it, and does not flicker as the file crosses its
 *   words: its children take no pointer events, so the zone is the only drop target.
 * - `busy` (the caller is reading a file) disables the input, ignores a drop and mutes the main
 *   line, as a disabled field's words are muted, never dimmed with opacity (T162).
 * - A chosen file clears the input, so the same file chosen again after a refusal is read again.
 * - The input is reachable by Tab, and since it is invisible the zone wears the focus halo for it.
 *
 * It judges no file: it emits the one chosen or dropped, and the caller checks its type and its
 * contents and says any error itself.
 */
import { ref, useId } from 'vue';

const props = defineProps<{
  /** The input's `accept`: what the chooser offers. */
  accept: string;
  /** The zone's main line, which names the input. */
  label: string;
  /** A small line under it saying what files it takes. */
  hint?: string;
  /** True while the caller reads a file: the zone takes no other. */
  busy?: boolean;
  testid: string;
  inputTestid: string;
}>();

const emit = defineEmits<{
  /** The one file chosen or dropped. */
  file: [file: File];
}>();

const id = useId();
const labelId = `${id}-label`;
const hintId = `${id}-hint`;

/** True while a file is over the zone, so the zone can say it will take it. */
const dragging = ref(false);

function onEnter() {
  if (!props.busy) dragging.value = true;
}

function onChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared, so the same file chosen again after a refusal is read again.
  input.value = '';
  if (file) emit('file', file);
}

function onDropped(event: DragEvent) {
  dragging.value = false;
  if (props.busy) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) emit('file', file);
}
</script>

<template>
  <label
    class="file-drop-zone"
    :data-testid="testid"
    :data-dragging="dragging"
    :aria-busy="busy ? 'true' : undefined"
    @dragenter.prevent="onEnter"
    @dragover.prevent="onEnter"
    @dragleave="dragging = false"
    @drop.prevent="onDropped"
  >
    <input
      type="file"
      :accept="accept"
      :disabled="busy"
      :aria-labelledby="labelId"
      :aria-describedby="hint ? hintId : undefined"
      :data-testid="inputTestid"
      @change="onChosen"
    />
    <span :id="labelId" class="file-drop-zone-main">{{ label }}</span>
    <span v-if="hint" :id="hintId" class="file-drop-zone-hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.file-drop-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
  gap: var(--space-2);
  text-align: center;
  padding: var(--space-8) var(--space-6);
  margin-top: var(--space-2);
  border: 2px dashed var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}

.file-drop-zone:hover,
.file-drop-zone[data-dragging='true'] {
  border-color: var(--mm-green);
  background: rgba(54, 130, 111, 0.16);
}

/* The input is invisible, so the zone shows where keyboard focus is. This is the zone marking its
   one control, not a ring around a field's box, which no field draws (E38/F01/S01). */
.file-drop-zone:has(input:focus-visible) {
  box-shadow: var(--focus-halo);
}

/* Reading a file: the zone takes no file and its words go muted, as a disabled field's do, rather
   than dimming with opacity, which took its heading under AA (T162). */
.file-drop-zone[aria-busy='true'] {
  cursor: progress;
}

.file-drop-zone[aria-busy='true']:hover {
  border-color: var(--mm-border);
  background: var(--mm-beige);
}

.file-drop-zone[aria-busy='true'] .file-drop-zone-main {
  color: var(--mm-text-muted-on-beige);
}

/* The input still does the work; it is the zone the organizer sees and drops onto. */
.file-drop-zone input[type='file'] {
  position: absolute;
  inset: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* The zone is one drop target. Without this the label's own children are targets too, so
   crossing onto the text fires `dragleave` and the zone flickers out from under the file. */
.file-drop-zone > * {
  pointer-events: none;
}

.file-drop-zone-main {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  color: var(--mm-black);
}

.file-drop-zone-hint {
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  max-width: 42ch;
  line-height: 1.5;
}
</style>
