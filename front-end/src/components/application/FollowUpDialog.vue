<script setup lang="ts">
/**
 * Marking an application as needing a follow-up (E34/F02/S01).
 *
 * Who will reach out - the reviewer, unless they name someone else with a role on the market,
 * explicit or through its organization, found by typing part of their address (T204) - and, if they
 * like, what is needed. Words in the field that choose no one hold the button back, so a follow-up
 * never goes to someone the field does not name. What is needed is the vendor's notes, where every
 * surface reads them, so the box opens on the note already there: the reviewer
 * adds to it, and never writes over it unseen. The box is offered only to someone the table lets
 * write vendor notes: a chosen Viewer marks the follow-up without it (E38/F07/S03).
 * Nothing is sent to the owner.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import SearchPicker from '@/components/SearchPicker.vue';
import { PEOPLE_CAP, findsPerson, personOption } from '@/utils/personChoice';

const props = defineProps<{
  open: boolean;
  applicantEmail: string;
  /** The addresses of everyone with a role on the market, as the market read serves them. */
  people: string[];
  /** The reviewer's own address: the owner unless they choose another. */
  me: string;
  /** The vendor's note as it stands, which the box opens on. */
  note?: string;
  /** Whether this person may write the vendor's notes: the box is offered only then. */
  writesNotes: boolean;
  error?: string;
}>();

/** What is needed rides along only when the box was offered. */
const emit = defineEmits<{ close: []; confirm: [{ ownerEmail: string; note?: string }] }>();

const owner = ref(props.me);
const needed = ref('');

/** The reviewer is offered when the read offers no one, so the field names what would be sent. */
const groups = computed(() => [
  { options: (props.people.length ? props.people : [props.me]).map(personOption) },
]);

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
    :confirm-disabled="!owner"
    :error="error"
    @close="emit('close')"
    @submit="
      emit(
        'confirm',
        writesNotes ? { ownerEmail: owner, note: needed.trim() } : { ownerEmail: owner },
      )
    "
  >
    <p class="follow-up-who">{{ applicantEmail }}'s application waits until someone reaches out.</p>
    <SearchPicker
      v-model="owner"
      class="follow-up-owner"
      :groups="groups"
      :finds="findsPerson"
      :cap="PEOPLE_CAP"
      label="Who will follow up"
      placeholder="Type an address…"
      testid="follow-up-owner"
    />
    <template v-if="writesNotes">
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
    </template>
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

/* The picker's label reads as the box's below it does, as far above its field. */
.follow-up-owner :deep(.field-label) {
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
