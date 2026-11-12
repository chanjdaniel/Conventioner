<script setup lang="ts">
/**
 * The layout page's "Keyboard" card (T257): the editor's keys, folded away until asked for. What
 * each key does is `LayoutEditor.vue`'s to do; this card only lists them, group by group, as the
 * hint under the map says the few that matter where the keys are.
 *
 * Past Draft (`settled`) it leaves out the keys that add or remove tables, which do nothing there:
 * Delete, Ctrl+D, Add table's Enter, and the Row of tables and Fill an area groups.
 */
import { computed } from 'vue';

const props = defineProps<{
  /** Whether the market has left Draft, so no table is added or removed. */
  settled?: boolean;
}>();

/** A key, what it does, and whether it adds or removes tables. */
type Key = readonly [string[], string, 'seats'?];

const GROUPS: readonly {
  title: string;
  keys: readonly Key[];
  /** Every key of it adds tables. */
  seats?: true;
  /** Its title once its keys that add tables are left out. */
  settledTitle?: string;
}[] = [
  {
    title: 'On the map',
    keys: [
      [['Arrow keys'], 'Move to the nearest table that way'],
      [['Enter', 'Space'], 'Pick up the table, or the selection it is in'],
      [['Shift+Enter'], 'Select the table, or take it out'],
    ],
  },
  {
    title: 'With tables picked up',
    keys: [
      [['Arrow keys'], 'Move them 10 cm, or 1 m with Shift'],
      [['R'], 'Turn them 90°, or 15° with Shift'],
      [['Enter', 'Space'], 'Drop them'],
      [['Escape'], 'Put them back'],
    ],
  },
  {
    title: 'The selection',
    keys: [
      [['R'], 'Turn it 90°, or 15° with Shift'],
      [['Delete', 'Backspace'], 'Remove it', 'seats'],
      [['Ctrl+D'], 'Duplicate it', 'seats'],
      [['Ctrl+A'], 'Select every table'],
      [['Escape'], 'Select nothing'],
    ],
  },
  {
    title: 'With Row of tables on',
    seats: true,
    keys: [
      [['Arrow keys'], 'Move the crosshair 10 cm, or 1 m with Shift'],
      [['Enter'], 'Lay a point of the row at the crosshair'],
      [['Backspace'], 'Take the last point back, or open a closed shape again'],
      [['C'], 'Close the path into a shape, of three points or more'],
      [['F'], 'Swap the side of the line the tables stand on'],
      [['Ctrl+Enter'], 'Place the row; Enter places a closed shape'],
      [['Escape'], 'Drop the row'],
      [['Shift'], 'While dragging: a straight row'],
    ],
  },
  {
    title: 'With Fill an area on',
    seats: true,
    keys: [
      [['Arrow keys'], 'Move the crosshair 10 cm, or 1 m with Shift'],
      [['Enter'], 'Lay a corner of the area at the crosshair'],
      [['Backspace'], 'Take the last corner back'],
      [['Ctrl+Enter'], 'Close the area, of three corners or more, and ask how to fill it'],
      [['Escape'], 'Drop the area'],
    ],
  },
  {
    title: 'Adding, undo and the view',
    settledTitle: 'Undo and the view',
    keys: [
      [['Enter'], 'With Add table on, place a table at the middle of the view', 'seats'],
      [['Ctrl+Z'], 'Undo'],
      [['Ctrl+Shift+Z', 'Ctrl+Y'], 'Redo'],
      [['+', '-'], 'Zoom in and out'],
      [['0'], 'Fit the floorplan'],
    ],
  },
];

/** The groups and keys that do something now. */
const shown = computed(() =>
  props.settled
    ? GROUPS.filter((group) => !group.seats).map((group) => ({
        ...group,
        title: group.settledTitle ?? group.title,
        keys: group.keys.filter((key) => key[2] !== 'seats'),
      }))
    : GROUPS,
);
</script>

<template>
  <section data-testid="layout-panel-keyboard">
    <details class="keyboard">
      <summary class="keyboard-title" data-testid="layout-keyboard-summary">Keyboard</summary>
      <template v-for="group in shown" :key="group.title">
        <h3 class="keyboard-group">{{ group.title }}</h3>
        <dl class="keyboard-keys">
          <template v-for="[keys, does] in group.keys" :key="does">
            <dt>
              <template v-for="(key, index) in keys" :key="key">
                <span v-if="index"> or </span><kbd>{{ key }}</kbd>
              </template>
            </dt>
            <dd>{{ does }}</dd>
          </template>
        </dl>
      </template>
      <p class="keyboard-note">On a Mac, Command stands in for Ctrl.</p>
    </details>
  </section>
</template>

<style scoped>
.keyboard {
  width: 100%;
}

/* The card's title is the disclosure's summary: as wide as its words, so its halo hugs them. */
.keyboard-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: fit-content;
  min-height: var(--target-min);
  font-size: var(--text-md);
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.keyboard-title::-webkit-details-marker {
  display: none;
}

/* Its own marker, the native one being hidden to keep the title on one baseline. */
.keyboard-title::before {
  content: '▸';
  font-size: var(--text-xs);
  transition: transform 0.12s ease;
}

.keyboard[open] .keyboard-title::before {
  transform: rotate(90deg);
}

.keyboard-group {
  margin: var(--space-3) 0 var(--space-1);
  font-size: var(--text-sm);
  font-weight: 600;
}

/* The keys in one column and what they do beside them, every group's columns the same width. */
.keyboard-keys {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr);
  gap: var(--space-1) var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
}

.keyboard-keys dd {
  margin: 0;
}

.keyboard-keys kbd {
  padding: 0 var(--space-1);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-family: inherit;
  font-size: var(--text-xs);
  white-space: nowrap;
}

.keyboard-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .keyboard-title::before {
    transition: none;
  }
}
</style>
