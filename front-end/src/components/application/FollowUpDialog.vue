<script setup lang="ts">
/**
 * Marking an application as needing a follow-up (E34/F02/S01).
 *
 * Who will reach out - the reviewer, unless they name someone else with a role on the market,
 * explicit or through its organization - and, if they like, what is needed. That is the vendor's
 * notes, where every surface reads them, so the box opens on the note already there: the reviewer
 * adds to it, and never writes over it unseen.
 * Nothing is sent to the owner.
 */
import { ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';

const props = defineProps<{
  open: boolean;
  applicantEmail: string;
  /** The addresses of everyone with a role on the market, as the market read serves them. */
  people: string[];
  /** The reviewer's own address: the owner unless they choose another. */
  me: string;
  /** The vendor's note as it stands, which the box opens on. */
  note?: string;
  error?: string;
}>();

const emit = defineEmits<{ close: []; confirm: [{ ownerEmail: string; note: string }] }>();

const owner = ref(props.me);
const needed = ref('');

watch(
  () => props.open,
  (opened) => {
    if (!opened) return;
    owner.value = props.people.includes(props.me) ? props.me : (props.people[0] ?? props.me);
    needed.value = props.note ?? '';
  },
  { immediate: true },
);
</script>

<template>
  <AppDialog
    :open="open"
    title="Needs a follow-up"
    testid="follow-up"
    confirm-label="Mark for follow-up"
    :error="error"
    @close="emit('close')"
    @submit="emit('confirm', { ownerEmail: owner, note: needed.trim() })"
  >
    <p class="follow-up-who">{{ applicantEmail }}'s application waits until someone reaches out.</p>
    <label class="follow-up-label" for="follow-up-owner">Who will follow up</label>
    <select
      id="follow-up-owner"
      v-model="owner"
      class="field field--select"
      data-testid="follow-up-owner"
    >
      <option v-for="person in people" :key="person" :value="person">
        {{ person === me ? `${person} (you)` : person }}
      </option>
    </select>
    <label class="follow-up-label" for="follow-up-note"
      >Their notes: what is needed (optional)</label
    >
    <textarea
      id="follow-up-note"
      v-model="needed"
      class="field"
      rows="3"
      data-testid="follow-up-note"
      placeholder="Kept in their notes"
    ></textarea>
  </AppDialog>
</template>

<style scoped>
.follow-up-who {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* The dialog spaces its children; a label sits on the control it names. */
.follow-up-label {
  display: block;
  margin: 0 0 calc(-1 * var(--space-2));
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
