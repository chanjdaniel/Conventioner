<script setup lang="ts">
/**
 * What a vendor needs beyond their table, and what the organizer knows and did about it (E31/F04).
 *
 * One disclosure wherever a vendor is looked at - the review card, the Vendors panel, the door -
 * marked in its summary when there is anything inside, and showing each kind under its own label:
 * their request (their words, read-only here, markable handled), your note (one shared text,
 * written by EDITOR and up) and what came from your sheet (replaced by each import). Two kinds,
 * never one field with two authors (map ticket 03).
 */
import { computed, ref, watch } from 'vue';
import { getApiErrorMessage } from '@/utils/api';
import { getFormattedTimestamp } from '@/utils/utils';
import {
  hasNotes,
  markRequestHandled,
  requestOutstanding,
  saveVendorNote,
  type VendorNoteEntry,
} from '@/utils/vendorNotes';

const props = withDefaults(
  defineProps<{
    marketId: string;
    email: string;
    entry?: VendorNoteEntry;
    /** EDITOR and up, on a market that is not archived: the market's `readOnlyReason` is null. */
    canWrite: boolean;
    /** The review card shows the request among the answers already. */
    showRequest?: boolean;
    /** Drawn only for a vendor with something noted: the door's list is eighty rows long. */
    onlyWhenNoted?: boolean;
    open?: boolean;
    testid: string;
  }>(),
  { entry: undefined, showRequest: true, onlyWhenNoted: false, open: false },
);

const emit = defineEmits<{ changed: [] }>();

const request = computed(() => (props.showRequest ? (props.entry?.request ?? '') : ''));
const outstanding = computed(() => props.showRequest && requestOutstanding(props.entry));
const anything = computed(() => hasNotes(props.entry));

const draft = ref(props.entry?.note ?? '');
watch(
  () => props.entry?.note,
  (note) => {
    draft.value = note ?? '';
  },
);
const dirty = computed(() => draft.value.trim() !== (props.entry?.note ?? ''));
const busy = ref(false);
const error = ref('');

async function run(write: () => Promise<void>, failure: string): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await write();
    emit('changed');
  } catch (err) {
    error.value = getApiErrorMessage(err, failure);
  } finally {
    busy.value = false;
  }
}

function save(): Promise<void> {
  return run(
    () => saveVendorNote(props.marketId, props.email, draft.value),
    'The note did not save.',
  );
}

function setHandled(event: Event): Promise<void> {
  const handled = (event.target as HTMLInputElement).checked;
  return run(
    () => markRequestHandled(props.marketId, props.email, handled),
    'That did not save. Try again.',
  );
}

const noteId = computed(() => `${props.testid}-note-${props.email}`);
</script>

<template>
  <details
    v-if="anything || (canWrite && !onlyWhenNoted)"
    class="vendor-notes"
    :open="open"
    :data-testid="testid"
    :data-has-notes="anything"
  >
    <summary class="vendor-notes-summary" :data-testid="`${testid}-summary`">
      Notes
      <span
        v-if="request"
        class="chip"
        :class="outstanding ? 'chip--attention' : 'chip--positive'"
        :data-testid="`${testid}-request-marker`"
        >{{ outstanding ? 'Request' : 'Request handled' }}</span
      >
      <span v-if="entry?.note" class="chip chip--neutral">Note</span>
      <span v-if="entry?.fromSheet" class="chip chip--neutral">From your sheet</span>
    </summary>

    <div class="vendor-notes-body">
      <section v-if="request" class="vendor-notes-kind" :data-testid="`${testid}-request`">
        <h4 class="vendor-notes-label">Their request</h4>
        <p class="vendor-notes-text">{{ request }}</p>
        <label v-if="canWrite" class="vendor-notes-handled">
          <input
            type="checkbox"
            :checked="!!entry?.requestHandledAt"
            :disabled="busy"
            :data-testid="`${testid}-handled`"
            @change="setHandled"
          />
          Handled
        </label>
        <p v-else-if="entry?.requestHandledAt" class="vendor-notes-meta">Handled</p>
      </section>

      <section class="vendor-notes-kind" :data-testid="`${testid}-note`">
        <h4 class="vendor-notes-label">
          <label v-if="canWrite" :for="noteId">Your note</label>
          <template v-else>Your note</template>
        </h4>
        <template v-if="canWrite">
          <textarea
            :id="noteId"
            v-model="draft"
            class="field field--textarea"
            rows="2"
            :disabled="busy"
            :data-testid="`${testid}-note-input`"
          />
          <button
            type="button"
            class="btn btn--secondary btn--compact vendor-notes-save"
            :disabled="busy || !dirty"
            :data-testid="`${testid}-note-save`"
            @click="save"
          >
            Save note
          </button>
        </template>
        <p v-else class="vendor-notes-text">{{ entry?.note || 'None yet.' }}</p>
        <p v-if="entry?.note && entry.noteEditedBy" class="vendor-notes-meta">
          {{ entry.noteEditedBy }}, {{ getFormattedTimestamp(entry.noteEditedAt) }}
        </p>
      </section>

      <section v-if="entry?.fromSheet" class="vendor-notes-kind" :data-testid="`${testid}-sheet`">
        <h4 class="vendor-notes-label">From your sheet</h4>
        <p class="vendor-notes-text">{{ entry.fromSheet }}</p>
      </section>

      <p v-if="error" class="vendor-notes-error" role="alert">{{ error }}</p>
    </div>
  </details>
</template>

<style scoped>
.vendor-notes {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.vendor-notes-summary {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  color: var(--mm-text-link);
  font-weight: 600;
}

.vendor-notes-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.vendor-notes-kind {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* Muted, in the shade that holds AA on the review card's beige as well as on white. */
.vendor-notes-label {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted-on-beige);
}

.vendor-notes-text {
  margin: 0;
  white-space: pre-wrap;
}

.vendor-notes-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
}

.vendor-notes-handled {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.vendor-notes-save {
  align-self: flex-start;
}

.vendor-notes-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
