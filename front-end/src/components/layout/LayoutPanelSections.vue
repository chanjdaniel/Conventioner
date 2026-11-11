<script setup lang="ts">
/**
 * The layout page's "Sections in <location>" card (T257): each of the location's sections with the
 * colour the map draws it in, its tier and how many tables it has on the layout. It is the map's
 * legend, listed from the same sections and colours (`layoutSections`).
 *
 * For someone editing the layout a section's swatch is a button that opens the palette's eight
 * colours under its row, and its row's menu renumbers its tables by where they stand. Tables in
 * no section are counted under the list, with "Select them" for the editor, and while a section
 * has fewer tables than Section Setup had typed for it when the layout began, a note says how many
 * are placed.
 */
import { computed, nextTick, ref, useId } from 'vue';
import type { StartingCount } from '@/assets/types/datatypes';
import RowMenu from '@/components/RowMenu.vue';
import { plural } from '@/utils/historyReaders/shared';
import { sectionPaint, type LayoutSection } from './layoutDrawing';
import { PALETTE_SIZE } from './layoutGeometry';

const props = withDefaults(
  defineProps<{
    locationName: string;
    sections: readonly LayoutSection[];
    /** How many of the layout's tables are in no section. */
    unsectioned?: number;
    /** What Section Setup had for each section when the layout began. */
    startingCounts?: readonly StartingCount[];
    /** Whether the reader may change the layout here: colours, numbers, the selection. */
    editable?: boolean;
  }>(),
  { unsectioned: 0, startingCounts: () => [], editable: false },
);

const emit = defineEmits<{
  /** A colour of the palette, 1 to 8, chosen for a section. */
  color: [sectionId: string, color: number];
  renumber: [sectionId: string];
  selectUnsectioned: [];
}>();

const titleId = useId();
const paletteId = useId();

/** The palette's colours, as `base.css` names them in order. */
const COLOR_NAMES = ['Gold', 'Blue', 'Terracotta', 'Green', 'Violet', 'Teal', 'Rose', 'Olive'];
const palette = Array.from({ length: PALETTE_SIZE }, (_, index) => ({
  color: index + 1,
  name: COLOR_NAMES[index],
  paint: sectionPaint(index + 1),
}));

/** The section whose palette is open. */
const choosing = ref<string | null>(null);
const list = ref<HTMLElement | null>(null);

const swatchOf = (sectionId: string) =>
  [...(list.value?.querySelectorAll<HTMLButtonElement>('[data-swatch-of]') ?? [])].find(
    (button) => button.dataset.swatchOf === sectionId,
  );

async function toggle(sectionId: string) {
  choosing.value = choosing.value === sectionId ? null : sectionId;
  if (!choosing.value) return;
  await nextTick();
  // The colour the section wears, where the eye already is.
  list.value?.querySelector<HTMLButtonElement>('[data-palette] [aria-pressed="true"]')?.focus();
}

/** Close the palette and give the focus back to the swatch that opened it. */
async function close(sectionId: string) {
  choosing.value = null;
  await nextTick();
  swatchOf(sectionId)?.focus();
}

/** Escape on a row whose palette is open closes it, from the palette or from its swatch; the
 * row's own menu keeps its Escape. */
function onRowEscape(event: KeyboardEvent, sectionId: string) {
  if (choosing.value !== sectionId) return;
  if ((event.target as Element).closest('.row-menu')) return;
  event.stopPropagation();
  void close(sectionId);
}

function choose(sectionId: string, color: number) {
  emit('color', sectionId, color);
  void close(sectionId);
}

/** A section's name, as its controls say it: one with none yet is still named to a reader. */
const nameOf = (section: { name: string }) => section.name.trim() || 'Unnamed section';

const MENU = [{ id: 'renumber', label: 'Renumber by position (rows across the page)' }];

/** "Section Setup had Gold row at 13: 9 placed.", for each section still short of its start. */
const short = computed(() =>
  props.sections.flatMap(({ section, tables }) => {
    const started = props.startingCounts.find((one) => one.sectionId === section.id)?.count ?? 0;
    return tables.length < started
      ? [
          {
            id: section.id,
            text: `Section Setup had ${nameOf(section)} at ${started}: ${tables.length} placed.`,
          },
        ]
      : [];
  }),
);
</script>

<template>
  <section :aria-labelledby="titleId" data-testid="layout-panel-sections">
    <h2 :id="titleId" class="sections-title">Sections in {{ locationName }}</h2>
    <p v-if="!sections.length" class="sections-none" data-testid="layout-panel-no-sections">
      {{ locationName }} has no sections yet. Name them on Market Setup's Section Setup.
    </p>
    <ul v-else ref="list" class="sections-list">
      <li
        v-for="{ section, color, paint, tables } in sections"
        :key="section.id"
        class="sections-row"
        data-testid="layout-panel-section"
        @keydown.esc="onRowEscape($event, section.id)"
      >
        <button
          v-if="editable"
          type="button"
          class="sections-swatch-button"
          :aria-label="`${nameOf(section)}'s colour`"
          :aria-expanded="choosing === section.id"
          :aria-controls="choosing === section.id ? paletteId : undefined"
          :data-swatch-of="section.id"
          data-testid="layout-panel-section-colour"
          @click="toggle(section.id)"
        >
          <span
            class="sections-swatch"
            :style="{ background: `var(${paint.fill})`, borderColor: `var(${paint.edge})` }"
            data-testid="layout-panel-section-swatch"
          />
        </button>
        <span
          v-else
          class="sections-swatch"
          :style="{ background: `var(${paint.fill})`, borderColor: `var(${paint.edge})` }"
          aria-hidden="true"
          data-testid="layout-panel-section-swatch"
        />
        <span class="sections-name">
          {{ nameOf(section) }}
          <span class="sections-tier">
            {{ section.tier ? `${section.tier.name} tier` : 'No tier' }}
          </span>
        </span>
        <span class="sections-count" data-testid="layout-panel-section-count">
          {{ plural(tables.length, 'table', 'tables') }}
        </span>
        <RowMenu
          v-if="editable"
          :label="`${nameOf(section)}'s tables`"
          :items="MENU"
          :testid="`layout-panel-section-menu-${section.id}`"
          @select="emit('renumber', section.id)"
        />
        <div
          v-if="editable && choosing === section.id"
          :id="paletteId"
          class="sections-palette"
          role="group"
          :aria-label="`${nameOf(section)}'s colour`"
          data-palette
          data-testid="layout-panel-palette"
        >
          <button
            v-for="choice in palette"
            :key="choice.color"
            type="button"
            class="sections-swatch-button"
            :aria-label="choice.name"
            :aria-pressed="choice.color === color"
            :data-testid="`layout-panel-colour-${choice.color}`"
            @click="choose(section.id, choice.color)"
          >
            <span
              class="sections-swatch"
              :class="{ 'sections-swatch--chosen': choice.color === color }"
              :style="{
                background: `var(${choice.paint.fill})`,
                borderColor: `var(${choice.paint.edge})`,
              }"
            />
          </button>
        </div>
      </li>
    </ul>
    <p v-if="unsectioned > 0" class="sections-loose" data-testid="layout-panel-no-section">
      <span
        class="sections-swatch sections-swatch--none"
        aria-hidden="true"
        data-testid="layout-panel-no-section-swatch"
      />
      <span class="sections-loose-text">
        {{ unsectioned === 1 ? '1 table is' : `${unsectioned} tables are` }} in no section
      </span>
      <button
        v-if="editable"
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="layout-panel-select-no-section"
        @click="emit('selectUnsectioned')"
      >
        Select them
      </button>
    </p>
    <ul v-if="editable && short.length" class="sections-short" data-testid="layout-panel-starting">
      <li v-for="note in short" :key="note.id">{{ note.text }}</li>
    </ul>
  </section>
</template>

<style scoped>
.sections-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.sections-none {
  margin: 0;
  font-size: var(--text-sm);
}

.sections-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The swatch, the name over its tier, the count, and the row's menu where there is one. */
.sections-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

/* A table of the map in small: the section's tint, edged in its hue. */
.sections-swatch {
  display: block;
  width: var(--space-4);
  height: var(--space-4);
  border: 1.5px solid;
  border-radius: var(--radius-control);
}

/* The swatch as a button: a target round the same small table. */
.sections-swatch-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  cursor: pointer;
}

.sections-swatch-button:hover,
.sections-swatch-button[aria-expanded='true'] {
  background: var(--mm-beige);
}

/* The palette lies under its section's row, across the card. */
.sections-palette {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* The colour the section wears: its swatch edged twice as heavily. */
.sections-swatch--chosen {
  border-width: 3px;
}

.sections-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.sections-tier {
  display: block;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.sections-count {
  white-space: nowrap;
}

.sections-loose {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  font-size: var(--text-sm);
}

.sections-loose-text {
  flex: 1 1 auto;
}

.sections-swatch--none {
  flex: 0 0 auto;
  background: var(--layout-no-section-fill);
  border-color: var(--layout-no-section-edge);
}

.sections-short {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
