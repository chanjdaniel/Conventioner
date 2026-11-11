<script setup lang="ts">
/**
 * The layout page's "Table types" card (T257): the market's types, each with its size and how many
 * of the market's tables are of it. For someone editing the layout, "Add a type" and each type's
 * Edit open a dialog of its name, width and depth (`LayoutTypeDialog.vue`); Remove takes a type no
 * table uses, and says how many use one it will not take; "Use saved types" adds a saved set's
 * types the market lacks by name, and "Save these types" saves them under a name.
 *
 * Every change is a write of the whole list (`save`), which the page sends once the layout's own
 * pending change has landed; the dialogs hold through it and write its refusal into themselves.
 */
import { computed, nextTick, ref, useId } from 'vue';
import type { TableTypeObject } from '@/assets/types/datatypes';
import RowMenu from '@/components/RowMenu.vue';
import { getApiErrorMessage } from '@/utils/api';
import { plural } from '@/utils/historyReaders/shared';
import LayoutSavedTypesDialog from './LayoutSavedTypesDialog.vue';
import LayoutSaveTypesDialog from './LayoutSaveTypesDialog.vue';
import LayoutTypeDialog from './LayoutTypeDialog.vue';
import {
  LayoutNotSaved,
  MAX_TABLE_TYPES,
  sizeInWords,
  typeInUse,
  withSavedTypes,
  type SavedTypes,
} from './layoutTypes';

const props = withDefaults(
  defineProps<{
    tableTypes: readonly TableTypeObject[];
    /** How many of the market's tables are of each type, by its id. */
    counts: ReadonlyMap<string, number>;
    editable?: boolean;
    /** Write the market's types, all of them. */
    save?: (types: TableTypeObject[]) => Promise<void>;
    /** The saved sets of types this person may use. */
    listSaved?: () => Promise<SavedTypes[]>;
    /** Save the market's types under a name. */
    saveAs?: (name: string) => Promise<void>;
  }>(),
  {
    editable: false,
    save: async () => {},
    listSaved: async () => [],
    saveAs: async () => {},
  },
);

const titleId = useId();
const FAILED = 'The table types could not be saved. Try again in a moment.';

/** What a write that did not land says: the layout's own save's sentence, or the server's. */
const failure = (err: unknown) =>
  err instanceof LayoutNotSaved ? err.message : getApiErrorMessage(err, FAILED);

const countOf = (type: TableTypeObject) => props.counts.get(type.id) ?? 0;

/** What the card last said: a refusal (`alert`) or what was done (`status`). */
const said = ref<{ words: string; refused: boolean } | null>(null);

const card = ref<HTMLElement | null>(null);
/** The type dialog: closed, adding (null), or editing a type. */
const editing = ref<TableTypeObject | null | undefined>(undefined);
const usingSaved = ref(false);
const savingAs = ref(false);
const busy = ref(false);
const dialogError = ref('');

/** The types but the one edited, whose names it may not take. */
const others = computed(() => props.tableTypes.filter((type) => type.id !== editing.value?.id));
const full = computed(() => props.tableTypes.length >= MAX_TABLE_TYPES);

function open(dialog: 'add' | 'saved' | 'save', type?: TableTypeObject) {
  said.value = null;
  dialogError.value = '';
  if (dialog === 'add') editing.value = type ?? null;
  else if (dialog === 'saved') usingSaved.value = true;
  else savingAs.value = true;
}

function closeAll() {
  editing.value = undefined;
  usingSaved.value = false;
  savingAs.value = false;
}

/** Run a write with the dialog held; closed when it lands, its refusal written in when not. */
async function held(write: () => Promise<void>, done: string) {
  busy.value = true;
  dialogError.value = '';
  try {
    await write();
    closeAll();
    said.value = { words: done, refused: false };
  } catch (err: unknown) {
    dialogError.value = failure(err);
  } finally {
    busy.value = false;
  }
}

function submitType(type: TableTypeObject) {
  const known = props.tableTypes.some((one) => one.id === type.id);
  const next = known
    ? props.tableTypes.map((one) => (one.id === type.id ? type : one))
    : [...props.tableTypes, type];
  void held(() => props.save(next), known ? `Saved ${type.name}.` : `Added ${type.name}.`);
}

function useSaved(saved: SavedTypes) {
  const next = withSavedTypes(props.tableTypes, saved);
  const added = next.length - props.tableTypes.length;
  if (!added) {
    dialogError.value = `This market has every type ${saved.name} holds.`;
    return;
  }
  if (next.length > MAX_TABLE_TYPES) {
    dialogError.value = `A market keeps at most ${MAX_TABLE_TYPES} table types.`;
    return;
  }
  void held(() => props.save(next), `Added ${plural(added, 'type', 'types')} from ${saved.name}.`);
}

function saveUnderName(name: string) {
  void held(() => props.saveAs(name), `Saved these types as ${name}.`);
}

/** Remove a type no table uses; of one that tables use, say how many and keep it. The focus,
 * which was in the type's menu, goes to "Add a type". */
async function remove(type: TableTypeObject) {
  said.value = null;
  const count = countOf(type);
  if (count) {
    said.value = { words: typeInUse(count, type.name), refused: true };
    return;
  }
  busy.value = true;
  try {
    await props.save(props.tableTypes.filter((one) => one.id !== type.id));
    said.value = { words: `Removed ${type.name}.`, refused: false };
  } catch (err: unknown) {
    said.value = { words: failure(err), refused: true };
  } finally {
    busy.value = false;
  }
  // Once the buttons can be pressed again.
  await nextTick();
  card.value?.querySelector<HTMLButtonElement>('[data-testid="layout-types-add"]')?.focus();
}

const MENU = [
  { id: 'edit', label: 'Edit' },
  { id: 'remove', label: 'Remove', destructive: true },
];

function onMenu(type: TableTypeObject, item: string) {
  if (item === 'edit') open('add', type);
  else void remove(type);
}
</script>

<template>
  <section ref="card" :aria-labelledby="titleId" data-testid="layout-panel-types">
    <h2 :id="titleId" class="types-title">Table types</h2>
    <p v-if="!tableTypes.length" class="types-none">This market has no table types yet.</p>
    <ul v-else class="types-list">
      <li v-for="type in tableTypes" :key="type.id" class="types-row" data-testid="layout-type-row">
        <span class="types-name">
          {{ type.name }}
          <span class="types-size" data-testid="layout-type-size">{{ sizeInWords(type) }}</span>
        </span>
        <span class="types-count" data-testid="layout-type-count">
          {{ plural(countOf(type), 'table', 'tables') }}
        </span>
        <RowMenu
          v-if="editable"
          :label="`Edit or remove ${type.name}`"
          :items="MENU"
          :testid="`layout-type-menu-${type.id}`"
          @select="onMenu(type, $event)"
        />
      </li>
    </ul>
    <p
      v-if="said"
      class="types-said"
      :class="{ 'types-said--refused': said.refused }"
      :role="said.refused ? 'alert' : 'status'"
      data-testid="layout-types-said"
    >
      {{ said.words }}
    </p>
    <div v-if="editable" class="types-actions">
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        :disabled="busy || full"
        data-testid="layout-types-add"
        @click="open('add')"
      >
        Add a type
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        :disabled="busy || full"
        data-testid="layout-types-use-saved"
        @click="open('saved')"
      >
        Use saved types
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        :disabled="busy || !tableTypes.length"
        data-testid="layout-types-save"
        @click="open('save')"
      >
        Save these types
      </button>
    </div>

    <LayoutTypeDialog
      :open="editing !== undefined"
      :type="editing ?? null"
      :others="others"
      :busy="busy"
      :error="dialogError"
      @close="closeAll"
      @submit="submitType"
    />
    <LayoutSavedTypesDialog
      :open="usingSaved"
      :list="listSaved"
      :busy="busy"
      :error="dialogError"
      @close="closeAll"
      @use="useSaved"
    />
    <LayoutSaveTypesDialog
      :open="savingAs"
      :count="tableTypes.length"
      :busy="busy"
      :error="dialogError"
      @close="closeAll"
      @save="saveUnderName"
    />
  </section>
</template>

<style scoped>
.types-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.types-none {
  margin: 0;
  font-size: var(--text-sm);
}

.types-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The name over its size, the count, and the row's menu where there is one. */
.types-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
}

.types-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.types-size {
  display: block;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.types-count {
  white-space: nowrap;
}

.types-said {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.types-said--refused {
  color: var(--mm-text-red-on-tint);
}

.types-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
