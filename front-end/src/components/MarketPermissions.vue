<script setup lang="ts">
/**
 * Manage market's Permissions section (E39/F01/S04): who may do what on this market, where each
 * row's role came from, and every change to it.
 *
 * Its owner sets each row, after a confirmation naming who may after it, or resets them all;
 * everyone else who may read the market reads it, with the owner-only line. The words are
 * `utils/permissionTable.ts`'s.
 */
import { computed, ref } from 'vue';
import {
  type Market,
  MarketPhase,
  MarketRole,
  type PermissionTableRow,
} from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { useMarketStore } from '@/stores/market';
import AppDialog from '@/components/AppDialog.vue';
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import {
  WHO_MAY_CHOICES,
  changeConsequence,
  changeLines,
  changeQuestion,
  groupedRows,
  heldRows,
  selfPromotionNote,
  selfPromotionWarning,
  sourceLine,
  whoMayLabel,
  type PermissionHistoryEntry,
} from '@/utils/permissionTable';
import { getFormattedTimestamp } from '@/utils/utils';

const props = defineProps<{ market: Market }>();

const emit = defineEmits<{
  /** The table a write answered, for the dialog's copy of the market. */
  changed: [table: PermissionTableRow[]];
}>();

/** Closed until asked for: every row of the table, and its changes. */
const open = ref(false);
const history = ref<PermissionHistoryEntry[]>([]);
const historyError = ref('');
/** A row's change waiting on its confirmation, with the select that asked, to put back on Cancel. */
const pendingChange = ref<{
  row: PermissionTableRow;
  role: MarketRole;
  select: HTMLSelectElement;
} | null>(null);
const resetConfirming = ref(false);
/** A refused change to the table, said in the confirmation that sent it. */
const writeError = ref('');

const table = computed(() => props.market.permissionTable ?? []);
const groups = computed(() => groupedRows(table.value));
const held = computed(() => heldRows(table.value));

/** Changing the table is its own fixed row, the market owner's alone (E39/F01/S03). */
const mayChange = computed(() => mayTake(props.market, MarketAction.ChangeTheTable));

/**
 * Why the section is read-only, or null for the owner. An archived market refuses its owner too,
 * and the archived rule's words say so; everyone else is told whose the table is.
 */
const readOnlyLine = computed(() => {
  if (mayChange.value) return null;
  if (props.market.phase === MarketPhase.Archived) {
    return actionRefusal(props.market, MarketAction.ChangeTheTable);
  }
  return "Only the market's owner changes these.";
});

/** Said with the heading, so the closed section says whether there is anything to look at. */
const summary = computed(() => {
  const count = held.value.length;
  if (!count) return 'Every row is at its built-in default.';
  return `${count} ${count === 1 ? 'row differs' : 'rows differ'} from the built-in defaults.`;
});

/** The rows a reset would return, each from its role now to its default. */
const resetChanges = computed(() =>
  held.value.map((row) => `${row.label}: ${whoMayLabel(row.role)} to ${whoMayLabel(row.default)}`),
);

const changes = computed(() =>
  history.value.map((entry) => ({ entry, ...changeLines(entry, table.value) })),
);

const marketPath = () => `/markets/${encodeURIComponent(props.market.id)}`;

async function toggle() {
  open.value = !open.value;
  if (open.value) await fetchHistory();
}

/** The market's history narrowed to its table, newest first: read when the section opens and
 * after each change, never on the market read, which every write re-reads. */
async function fetchHistory() {
  historyError.value = '';
  try {
    const response = await api.get(`${marketPath()}/permission-history`);
    history.value = response.data.entries ?? [];
  } catch (err) {
    historyError.value = getApiErrorMessage(err, 'Failed to load the changes');
  }
}

/** A choice is asked about before it is sent; choosing the role the row already asks is nothing. */
function askChange(row: PermissionTableRow, select: HTMLSelectElement) {
  const role = select.value as MarketRole;
  if (role === row.role) return;
  writeError.value = '';
  pendingChange.value = { row, role, select };
}

/** Cancelling puts the select back on the role the row still asks. */
function cancelChange() {
  if (pendingChange.value) pendingChange.value.select.value = pendingChange.value.row.role;
  pendingChange.value = null;
  writeError.value = '';
}

async function confirmChange() {
  const pending = pendingChange.value;
  if (!pending) return;
  writeError.value = '';
  try {
    const response = await api.put(
      `${marketPath()}/permissions/${encodeURIComponent(pending.row.id)}`,
      { role: pending.role },
    );
    pendingChange.value = null;
    await afterWrite(response.data.permissionTable);
  } catch (err) {
    writeError.value = getApiErrorMessage(err, 'Failed to change who may do this');
  }
}

function cancelReset() {
  resetConfirming.value = false;
  writeError.value = '';
}

async function confirmReset() {
  writeError.value = '';
  try {
    const response = await api.delete(`${marketPath()}/permissions`);
    resetConfirming.value = false;
    await afterWrite(response.data.permissionTable);
  } catch (err) {
    writeError.value = getApiErrorMessage(err, 'Failed to reset the table');
  }
}

/**
 * The write answers the table, which the section shows at once; the changes are read again. The
 * open market is re-read if it is this one, as a rename does, and every other screen asks the table
 * at its next read of the market.
 */
async function afterWrite(answered: PermissionTableRow[] | undefined) {
  if (answered) emit('changed', answered);
  await fetchHistory();
  const store = useMarketStore();
  if (store.marketId === props.market.id) void store.refresh();
}
</script>

<template>
  <section
    class="section"
    aria-labelledby="manage-market-permissions-heading"
    data-testid="manage-market-permissions"
  >
    <div class="section-head">
      <h3 id="manage-market-permissions-heading">Permissions</h3>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        :aria-expanded="open"
        :aria-controls="open ? 'manage-market-permissions-body' : undefined"
        data-testid="manage-market-permissions-toggle"
        @click="toggle"
      >
        {{ open ? 'Hide' : 'Show' }}
      </button>
    </div>
    <p class="hint" data-testid="manage-market-permissions-summary">
      Who may do what on this market. {{ summary }}
    </p>
    <div v-if="open" id="manage-market-permissions-body" class="body">
      <p v-if="readOnlyLine" class="hint" data-testid="manage-market-permissions-read-only">
        {{ readOnlyLine }}
      </p>
      <div v-for="{ group, rows } in groups" :key="group">
        <h4 class="subheading">{{ group }}</h4>
        <ul class="rows">
          <li
            v-for="row in rows"
            :key="row.id"
            class="row"
            :data-testid="`manage-market-permission-row-${row.id}`"
          >
            <div class="text">
              <span :id="`manage-market-permission-${row.id}`" class="label">{{ row.label }}</span>
              <span class="note" data-testid="manage-market-permission-source">
                {{ row.fixed ? 'Always' : sourceLine(row, history) }}
              </span>
              <span v-if="selfPromotionNote(row.id)" class="note">
                {{ selfPromotionNote(row.id) }}
              </span>
            </div>
            <!-- Named by the row's own words, which a voice user reads off the screen. -->
            <select
              v-if="mayChange && !row.fixed"
              :value="row.role"
              :aria-labelledby="`manage-market-permission-${row.id}`"
              class="field field--select select"
              data-testid="manage-market-permission-select"
              @change="askChange(row, $event.target as HTMLSelectElement)"
            >
              <option v-for="role in WHO_MAY_CHOICES" :key="role" :value="role">
                {{ whoMayLabel(role) }}
              </option>
            </select>
            <span v-else class="chip chip--neutral" data-testid="manage-market-permission-role">
              {{ whoMayLabel(row.role) }}
            </span>
          </li>
        </ul>
      </div>
      <button
        v-if="mayChange"
        type="button"
        class="btn btn--secondary reset"
        :disabled="!resetChanges.length"
        data-testid="manage-market-permissions-reset"
        @click="resetConfirming = true"
      >
        Reset to built-in defaults
      </button>

      <h4 class="subheading">Changes</h4>
      <p v-if="historyError" class="error">{{ historyError }}</p>
      <p v-else-if="!changes.length" class="hint">No changes yet.</p>
      <ol v-else class="rows" data-testid="manage-market-permission-changes">
        <li
          v-for="{ entry, title, rows } in changes"
          :key="entry.id"
          class="change"
          data-testid="manage-market-permission-change"
        >
          <span class="label change-title">{{ title }}</span>
          <span v-for="line in rows" :key="line" class="change-line">{{ line }}</span>
          <span class="note">{{ entry.actor }}, {{ getFormattedTimestamp(entry.at) }}</span>
        </li>
      </ol>
    </div>
  </section>

  <!-- Siblings of Manage market rather than inside its window, as a dialog opened from a dialog
       is (docs/implementation/conventions/dialogs.md). -->
  <Teleport to="body">
    <!-- A row's change is saved on its own, once confirmed in words naming who may after it. -->
    <AppDialog
      :open="!!pendingChange"
      :title="pendingChange ? changeQuestion(pendingChange.row, pendingChange.role) : ''"
      testid="manage-market-permission-confirm"
      confirm-label="Change"
      :error="writeError"
      @close="cancelChange"
      @submit="confirmChange"
    >
      <template v-if="pendingChange">
        <p class="confirm-text" data-testid="manage-market-permission-confirm-change">
          {{ pendingChange.row.label }}: {{ whoMayLabel(pendingChange.row.role) }} to
          {{ whoMayLabel(pendingChange.role) }}.
          {{ changeConsequence(pendingChange.row.role, pendingChange.role) }}
        </p>
        <p
          v-if="selfPromotionWarning(pendingChange.row.id, pendingChange.role)"
          class="confirm-text"
          data-testid="manage-market-permission-confirm-warning"
        >
          {{ selfPromotionWarning(pendingChange.row.id, pendingChange.role) }}
        </p>
      </template>
    </AppDialog>

    <!-- Destructive: it throws away every row the owner set, so it opens on Cancel. -->
    <AppDialog
      :open="resetConfirming"
      title="Reset every row to its built-in default?"
      testid="manage-market-permissions-reset-confirm"
      destructive
      confirm-label="Reset"
      :error="writeError"
      @close="cancelReset"
      @submit="confirmReset"
    >
      <ul class="rows reset-changes" data-testid="manage-market-permissions-reset-changes">
        <li v-for="line in resetChanges" :key="line" class="confirm-text">{{ line }}</li>
      </ul>
    </AppDialog>
  </Teleport>
</template>

<style scoped>
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-1);
}

.section-head h3 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.hint {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
}

.error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.body {
  margin-top: var(--space-2);
}

.subheading {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A compact table rather than a card per row, which would make the dialog unwieldy. */
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

.text {
  flex: 1 1 16rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
}

.label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.note {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.select {
  width: auto;
  flex: 0 0 auto;
}

.reset {
  margin-top: var(--space-3);
}

.change {
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

/* The row an entry is about leads it, so a list of entries does not read as one run of lines. */
.change-title {
  font-weight: 600;
}

.change-line {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.confirm-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.reset-changes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
