<script setup lang="ts">
/**
 * A list of people said in a line (T200), for a place that names them above the work rather than
 * listing them: "12 reviewers: Ana, Ben, Cai and 9 more". One paragraph, so a screen reader reads a
 * sentence and not item after item, and "and 9 more" is the way in to the rest: the screen answers
 * `more` with wherever the whole list is. With `named` or fewer names it says them all and has no
 * button, so a screen keeps its own way to that list for when the button is gone.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    names: readonly string[];
    /** What a name is, as the line counts them. */
    noun: { one: string; many: string };
    /** How many it names before the rest. */
    named?: number;
    testid: string;
  }>(),
  { named: 3 },
);

defineEmits<{ more: [] }>();

const rest = computed(() => Math.max(props.names.length - props.named, 0));

/** The sentence up to the button, or the whole of it when there is none. */
const words = computed(() => {
  const { names, noun } = props;
  if (!names.length) return `No ${noun.many}`;
  const counted = `${names.length} ${names.length === 1 ? noun.one : noun.many}`;
  if (rest.value) return `${counted}: ${names.slice(0, props.named).join(', ')} `;
  const last = names.at(-1);
  return names.length === 1
    ? `${counted}: ${last}`
    : `${counted}: ${names.slice(0, -1).join(', ')} and ${last}`;
});
</script>

<template>
  <p class="name-list" :data-testid="testid">
    {{ words
    }}<button
      v-if="rest"
      type="button"
      class="name-list__more"
      :data-testid="`${testid}-more`"
      @click="$emit('more')"
    >
      and {{ rest }} more
    </button>
  </p>
</template>

<style scoped>
.name-list {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

/* It stays whole on the sentence's last line, and is a target of its own on a phone. */
.name-list__more {
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  padding: 0;
  border: none;
  background: none;
  color: var(--mm-text-link);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
  cursor: pointer;
}
</style>
