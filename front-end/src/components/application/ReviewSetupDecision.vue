<script setup lang="ts">
/**
 * One of Review setup's decisions as a draft must take it before Review (T206): what a reviewer
 * reads first, and the automatic rejections.
 *
 * While the decision is open it says so, and what waits on it, and offers its "none" as one button
 * to someone who may change the form; a "none" chosen reads back as the decision. The section's own
 * controls sit below, so marking an answer or adding a rule replaces the "none". Whether the
 * decision is open is the caller's to say, from the blocker the market read serves, so this never
 * disagrees with the guard.
 */
defineProps<{
  /** The prefix of every `data-testid` here: `<testid>-undecided`, `-none`, `-none-chosen`. */
  testid: string;
  /** Not decided, as the market read serves it: the notice shows. */
  undecided: boolean;
  /** What waits on the decision, as a sentence ("Opening applications waits on this."). */
  waitsOn: string;
  /** Whether to offer the "none" button: undecided, and this person may change the form. */
  noneOffered: boolean;
  /** The "none" button's words ("Nothing leads the card"). */
  noneLabel: string;
  /** The organizer chose "none": the read-back shows. */
  noneChosen: boolean;
  /** The "none" in words, as the decision it is. */
  readBack: string;
}>();

const emit = defineEmits<{ (event: 'choose-none'): void }>();
</script>

<template>
  <div v-if="undecided || noneChosen" class="decision">
    <p v-if="undecided" class="decision-undecided" :data-testid="`${testid}-undecided`">
      Not decided yet. {{ waitsOn }}
    </p>
    <button
      v-if="undecided && noneOffered"
      type="button"
      class="btn btn--secondary"
      :data-testid="`${testid}-none`"
      @click="emit('choose-none')"
    >
      {{ noneLabel }}
    </button>
    <p v-if="noneChosen" class="decision-chosen" :data-testid="`${testid}-none-chosen`">
      {{ readBack }}
    </p>
  </div>
</template>

<style scoped>
.decision {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

/* The attention block the rules' lock is drawn in (`rejections-locked`): a state of the page that
   asks for something, not an error. */
.decision-undecided {
  align-self: stretch;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-yellow-on-tint);
}

.decision-chosen {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.4;
  color: var(--mm-black);
}
</style>
