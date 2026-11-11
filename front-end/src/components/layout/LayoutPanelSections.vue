<script setup lang="ts">
/**
 * The layout page's "Sections in <location>" card (T257): each of the location's sections with the
 * colour the map draws it in, its tier and how many tables it has on the layout. It is the map's
 * legend, listed from the same sections and colours (`layoutSections`).
 */
import { useId } from 'vue';
import { plural } from '@/utils/historyReaders/shared';
import type { LayoutSection } from './layoutDrawing';

defineProps<{ locationName: string; sections: readonly LayoutSection[] }>();

const titleId = useId();
</script>

<template>
  <section :aria-labelledby="titleId" data-testid="layout-panel-sections">
    <h2 :id="titleId" class="sections-title">Sections in {{ locationName }}</h2>
    <p v-if="!sections.length" class="sections-none" data-testid="layout-panel-no-sections">
      {{ locationName }} has no sections yet. Name them on Market Setup's Section Setup.
    </p>
    <ul v-else class="sections-list">
      <li
        v-for="{ section, paint, tables } in sections"
        :key="section.id"
        class="sections-row"
        data-testid="layout-panel-section"
      >
        <span
          class="sections-swatch"
          :style="{ background: `var(${paint.fill})`, borderColor: `var(${paint.edge})` }"
          aria-hidden="true"
          data-testid="layout-panel-section-swatch"
        />
        <span class="sections-name">
          {{ section.name }}
          <span class="sections-tier">
            {{ section.tier ? `${section.tier.name} tier` : 'No tier' }}
          </span>
        </span>
        <span class="sections-count">
          {{ plural(tables.length, 'table', 'tables') }}
        </span>
      </li>
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

.sections-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

/* A table of the map in small: the section's tint, edged in its hue. */
.sections-swatch {
  width: var(--space-4);
  height: var(--space-4);
  border: 1.5px solid;
  border-radius: var(--radius-control);
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
</style>
