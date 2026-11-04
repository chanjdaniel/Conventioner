<script setup lang="ts">
/**
 * A list of people said in a line (T200), for a place that names them above the work rather than
 * listing them: "12 reviewers: Ana, Ben, Cai and 9 more". One paragraph, so a screen reader reads a
 * sentence and not item after item, and "and 9 more" is the way in to the rest: the screen answers
 * `more` with wherever the whole list is. With `named` or fewer names it says them all and has no
 * button, so a screen keeps its own way to that list for when the button is gone. A screen draws a
 * name its own way with the `name` slot, an address and what it says of them, and ends the sentence
 * with the `end` slot, after the button.
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

/** What the rest are, so the button says so on its own, reached by Tab. */
const restNoun = computed(() => (rest.value === 1 ? props.noun.one : props.noun.many));

/** The sentence up to its first name, or the whole of it when there is none. */
const lead = computed(() => {
  const { names, noun } = props;
  if (!names.length) return `No ${noun.many}`;
  return `${names.length} ${names.length === 1 ? noun.one : noun.many}: `;
});

const said = computed(() => props.names.slice(0, props.named));

/** What follows the name at this place in the sentence. */
function after(place: number): string {
  const last = said.value.length - 1;
  if (place === last) return rest.value ? ' ' : '';
  return !rest.value && place === last - 1 ? ' and ' : ', ';
}
</script>

<template>
  <p class="name-list" :data-testid="testid">
    {{ lead
    }}<template v-for="(name, place) in said" :key="place"
      ><slot name="name" :text="name" :index="place">{{ name }}</slot
      >{{ after(place) }}</template
    ><button
      v-if="rest"
      type="button"
      class="name-list__more"
      :data-testid="`${testid}-more`"
      @click="$emit('more')"
    >
      and {{ rest }} more <span class="visually-hidden">{{ restNoun }}</span></button
    ><slot name="end" />
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
