<script setup lang="ts" generic="Id extends string">
/**
 * The steps of a piece of work, in order, any of them one click away (E33/F01/S01).
 *
 * A list of buttons in a named navigation landmark, the current one marked `aria-current="step"`,
 * so assistive technology hears which step is open as well as where the others are. It decides
 * nothing: the screen holds the current step and moves it on `select`, as it does with its own
 * Back and Next. Its focus halo is the primitives' (`.step-button` in primitives.css).
 */
import { computed } from 'vue';

const props = defineProps<{
  steps: readonly { id: Id; label: string }[];
  current: Id;
  /** What the steps are of, for the landmark's name: "Application form setup". */
  label: string;
  /** The header's test id. */
  testid: string;
  /** Each step's test id is this, a dash, and the step's id. */
  stepTestid: string;
}>();

defineEmits<{ select: [id: Id] }>();

const currentIndex = computed(() => props.steps.findIndex((step) => step.id === props.current));
</script>

<template>
  <nav class="step-header" :aria-label="label" :data-testid="testid">
    <ol class="step-list">
      <li v-for="(step, index) in steps" :key="step.id" class="step-item">
        <button
          type="button"
          class="step-button"
          :class="{ 'step-button--current': index === currentIndex }"
          :aria-current="index === currentIndex ? 'step' : undefined"
          :data-testid="`${stepTestid}-${step.id}`"
          @click="$emit('select', step.id)"
        >
          <span class="step-number">{{ index + 1 }}</span>
          <span class="step-label">{{ step.label }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.step-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A rule between steps, so the header reads as one sequence rather than four buttons. */
.step-item + .step-item::before {
  content: '';
  display: inline-block;
  width: var(--space-6);
  height: 1px;
  margin-right: var(--space-2);
  vertical-align: middle;
  background: var(--mm-border);
}

.step-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-black);
  font-size: var(--text-sm);
  cursor: pointer;
}

/* The first step starts at the header's edge, so its number lines up with the card below. It was
   pulled back by a negative margin, which left the list 8px outside its header (T79). */
.step-item:first-child .step-button {
  padding-left: 0;
}

.step-button:hover .step-label {
  text-decoration: underline;
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--space-6);
  height: var(--space-6);
  border: 1px solid var(--mm-border);
  border-radius: 50%;
  background: white;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.step-button--current .step-label {
  font-weight: 600;
}

.step-button--current .step-number {
  border-color: var(--mm-green);
  background: var(--mm-green);
  color: white;
}
</style>
