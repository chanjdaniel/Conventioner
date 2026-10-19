<script setup lang="ts">
/**
 * The steps of a piece of work, in order, any of them one click away (E33/F01/S01).
 *
 * A list of buttons in a named navigation landmark, the current one marked `aria-current="step"`,
 * so assistive technology hears which step is open as well as where the others are. It decides
 * nothing: the screen holds the current step and moves it on `select`, as it does with its own
 * Back and Next.
 */
import { computed } from 'vue';

export interface Step {
  id: string;
  label: string;
}

const props = defineProps<{
  steps: Step[];
  current: string;
  /** What the steps are of, for the landmark's name: "Application form setup". */
  label: string;
  /** The header's test id; each step is `<testid without its s>-<step id>`. */
  testid: string;
}>();

defineEmits<{ select: [id: string] }>();

const currentIndex = computed(() => props.steps.findIndex((step) => step.id === props.current));
const stepTestid = computed(() => props.testid.replace(/s$/, ''));
</script>

<template>
  <nav class="step-header" :aria-label="label" :data-testid="testid">
    <ol class="step-list">
      <li v-for="(step, index) in steps" :key="step.id" class="step-item">
        <button
          type="button"
          class="step"
          :class="{
            'step--current': index === currentIndex,
            'step--before': index < currentIndex,
          }"
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
/* Pulled back by a step's own padding, so its first number lines up with the card below. */
.step-list {
  margin: 0 0 0 calc(-1 * var(--space-2));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
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

.step {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
}

.step:hover .step-label {
  text-decoration: underline;
}

.step:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1.5px solid var(--mm-border);
  border-radius: 50%;
  background: white;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.step--before {
  color: var(--mm-black);
}

.step--before .step-number {
  border-color: var(--mm-green);
  color: var(--mm-green);
}

.step--current {
  color: var(--mm-black);
  font-weight: 600;
}

.step--current .step-label {
  font-weight: 600;
}

.step--current .step-number {
  border-color: var(--mm-green);
  background: var(--mm-green);
  color: white;
}
</style>
