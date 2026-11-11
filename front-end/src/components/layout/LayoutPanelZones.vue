<script setup lang="ts">
/**
 * The layout page's "No-table zones" card (T257): each zone the layout keeps tables off, a stage,
 * a pillar, an exit, with its size; its name in a field, saved as the field is left or Enter is
 * pressed, and Remove. A zone is drawn with the editor's No-table zone tool, and the page then
 * gives its field the focus (`focusZone`), so it is named where it is listed.
 */
import { nextTick, ref, useId } from 'vue';
import type { FloorplanZone } from '@/assets/types/datatypes';
import { metres } from './layoutDrawing';

defineProps<{ zones: readonly FloorplanZone[] }>();

const emit = defineEmits<{ label: [id: string, label: string]; remove: [id: string] }>();

const titleId = useId();
const list = ref<HTMLElement | null>(null);

/** The name a zone is called by in its controls: its own, or its place in the list. */
const nameOf = (zone: FloorplanZone, index: number) => zone.label.trim() || `Zone ${index + 1}`;

function commit(zone: FloorplanZone, event: Event) {
  emit('label', zone.id, (event.target as HTMLInputElement).value);
}

/** Give a zone's name field the focus, once it is drawn. */
async function focusZone(id: string) {
  await nextTick();
  list.value?.querySelector<HTMLInputElement>(`[data-zone-id="${CSS.escape(id)}"]`)?.focus();
}

/** A zone removed takes its controls: the focus goes to the next zone's field, else the card. */
async function remove(zone: FloorplanZone, index: number, zones: readonly FloorplanZone[]) {
  const next = zones[index + 1] ?? zones[index - 1];
  emit('remove', zone.id);
  if (next) await focusZone(next.id);
  else {
    await nextTick();
    list.value?.closest<HTMLElement>('section')?.focus();
  }
}

defineExpose({ focusZone });
</script>

<template>
  <section :aria-labelledby="titleId" tabindex="-1" class="zones" data-testid="layout-panel-zones">
    <h2 :id="titleId" class="zones-title">No-table zones</h2>
    <p v-if="!zones.length" class="zones-none" data-testid="layout-panel-no-zones">
      None yet. Draw one with No-table zone over a stage, a pillar or an exit, and no table is put
      there.
    </p>
    <ul v-else ref="list" class="zones-list">
      <li
        v-for="(zone, index) in zones"
        :key="zone.id"
        class="zones-row"
        data-testid="layout-panel-zone"
      >
        <div class="zones-field">
          <label :for="`${titleId}-${zone.id}`" class="visually-hidden">
            Name of zone {{ index + 1 }}
          </label>
          <input
            :id="`${titleId}-${zone.id}`"
            :value="zone.label"
            class="field"
            type="text"
            autocomplete="off"
            maxlength="100"
            placeholder="Stage, pillar…"
            :data-zone-id="zone.id"
            data-testid="layout-zone-label"
            @change="commit(zone, $event)"
            @keydown.enter.prevent="commit(zone, $event)"
          />
          <span class="zones-size" data-testid="layout-zone-size">
            {{ metres(zone.widthMm) }} by {{ metres(zone.depthMm) }}
          </span>
        </div>
        <button
          type="button"
          class="btn btn--secondary"
          :aria-label="`Remove ${nameOf(zone, index)}`"
          data-testid="layout-zone-remove"
          @click="remove(zone, index, zones)"
        >
          Remove
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.zones:focus {
  outline: none;
}

.zones-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.zones-none {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.zones-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The name over its size, beside Remove. */
.zones-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2);
}

.zones-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.zones-size {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
