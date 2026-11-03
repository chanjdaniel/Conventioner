<script setup lang="ts">
/**
 * A checkbox per person, as today's reviewer chooser draws one (C5), with each person's name,
 * address and role on a line that wraps: the long content the dialog entry scrolls. It draws no
 * scroller of its own, so the dialog it is in is what scrolls.
 */
import { getRoleDisplayName } from '@/utils/permissions';
import type { LibraryFixture } from '../fixture';

defineProps<{ people: LibraryFixture['people']; legend: string; testid: string }>();

/** The person ids ticked. */
const ticked = defineModel<string[]>({ required: true });

function toggle(id: string, on: boolean) {
  ticked.value = on ? [...ticked.value, id] : ticked.value.filter((other) => other !== id);
}
</script>

<template>
  <fieldset class="people-checklist" :data-testid="testid">
    <legend class="field-label">{{ legend }}</legend>
    <ul class="people-checklist__list">
      <li v-for="person in people" :key="person.id">
        <label class="people-checklist__choice" :data-testid="`${testid}-row`">
          <input
            type="checkbox"
            :value="person.id"
            :checked="ticked.includes(person.id)"
            @change="toggle(person.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="people-checklist__words">
            <span class="people-checklist__name">{{ person.name }}</span>
            <span class="people-checklist__email">{{ person.email }}</span>
            <span class="people-checklist__role">{{ getRoleDisplayName(person.role) }}</span>
          </span>
        </label>
      </li>
    </ul>
  </fieldset>
</template>

<style scoped>
.people-checklist {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.people-checklist legend {
  padding: 0;
}

.people-checklist__list {
  margin: var(--space-1) 0 0;
  padding: 0;
  list-style: none;
}

/* The label is the target, the box inside it: 32px at a desk, a thumb's 44px on a phone. */
.people-checklist__choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: max(2rem, var(--target-min));
  padding-block: var(--space-1);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.people-checklist__words {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-2);
  min-width: 0;
}

.people-checklist__email {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--mm-text-muted);
}

.people-checklist__role {
  color: var(--mm-text-muted);
}
</style>
