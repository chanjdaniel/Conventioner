<script setup lang="ts">
/**
 * "Use saved types" (T257): the sets of table types the person saved, and their organization's,
 * one to choose; "Use these types" adds each of its types the market has none of by that name.
 * It lists them itself when it opens (`list`), and says so while they are on their way, when there
 * are none, and when they could not be had. The list grows with every set saved, so only its body
 * scrolls, the title and the actions pinned.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { getApiErrorMessage } from '@/utils/api';
import { plural } from '@/utils/historyReaders/shared';
import { sizeInWords, type SavedTypes } from './layoutTypes';

const props = defineProps<{
  open: boolean;
  /** The saved sets of types this person may use. */
  list: () => Promise<SavedTypes[]>;
  busy?: boolean;
  error?: string;
}>();

const emit = defineEmits<{ close: []; use: [saved: SavedTypes] }>();

const NOT_LISTED = 'The saved types could not be listed. Try again in a moment.';

const saved = ref<SavedTypes[] | null>(null);
const listError = ref('');
const chosen = ref('');

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    saved.value = null;
    listError.value = '';
    chosen.value = '';
    try {
      const listed = await props.list();
      if (!props.open) return;
      saved.value = listed;
      chosen.value = listed[0]?.id ?? '';
    } catch (err: unknown) {
      listError.value = getApiErrorMessage(err, NOT_LISTED);
    }
  },
  { immediate: true },
);

const choice = computed(() => saved.value?.find((one) => one.id === chosen.value) ?? null);

/** A set's types in words: "Standard 6 ft (183 x 76 cm), Square 4 ft (122 x 122 cm)". */
const typesOf = (one: SavedTypes) =>
  one.tableTypes.map((type) => `${type.name} (${sizeInWords(type)})`).join(', ') || 'No types';

function use() {
  if (props.busy || !choice.value) return;
  emit('use', choice.value);
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Use saved types"
    testid="layout-saved-types"
    size="wide"
    scroll="body"
    :confirm-label="busy ? 'Adding…' : 'Use these types'"
    :confirm-disabled="busy || !choice"
    :close-disabled="busy"
    :error="error || listError"
    @close="emit('close')"
    @submit="use"
  >
    <p v-if="saved === null && !listError" class="saved-note" data-testid="layout-saved-loading">
      Listing the saved types…
    </p>
    <p v-else-if="saved && !saved.length" class="saved-note" data-testid="layout-saved-none">
      No table types are saved yet. Save this market's with "Save these types" to use them in
      another.
    </p>
    <fieldset v-else-if="saved" class="saved-list" :disabled="busy">
      <legend class="field-label">Saved types</legend>
      <p class="saved-note">The types this market has none of by name are added.</p>
      <label
        v-for="one in saved"
        :key="one.id"
        class="saved-choice"
        data-testid="layout-saved-choice"
      >
        <input v-model="chosen" type="radio" name="layout-saved-types" :value="one.id" />
        <span class="saved-text">
          <span class="saved-name">{{ one.name }}</span>
          <span class="saved-types">
            {{ plural(one.tableTypes.length, 'type', 'types') }}: {{ typesOf(one) }}
          </span>
        </span>
      </label>
    </fieldset>
  </AppDialog>
</template>

<style scoped>
.saved-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.saved-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.saved-list legend {
  padding: 0;
}

.saved-choice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: var(--target-min);
  padding: var(--space-2) 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.saved-choice input {
  margin-top: var(--space-1);
}

.saved-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.saved-name {
  font-weight: 600;
}

.saved-types {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}
</style>
