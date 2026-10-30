<script setup lang="ts">
/**
 * Manage market's Permissions section (E39/F01/S04): who may do what on this market, where each
 * row's role came from, and every change to it.
 *
 * Its owner sets each row, after a confirmation naming who may after it, resets them all, or
 * copies its organization's default again (E39/F02/S01); everyone else who may read the market
 * reads it, with the owner-only line. The words are `utils/permissionTable.ts`'s, and the rows and
 * changes `PermissionRows`' and `PermissionChanges`'.
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
import PermissionChanges from '@/components/PermissionChanges.vue';
import PermissionRows from '@/components/PermissionRows.vue';
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import {
  changeConsequence,
  changeQuestion,
  heldRows,
  selfPromotionWarning,
  sourceLine,
  whoMayLabel,
  type PermissionHistoryEntry,
} from '@/utils/permissionTable';

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
const copyConfirming = ref(false);
const toggleEl = ref<HTMLButtonElement | null>(null);
/** A refused change to the table, said in the confirmation that sent it. */
const writeError = ref('');

const table = computed(() => props.market.permissionTable ?? []);
const held = computed(() => heldRows(table.value));

/**
 * The changes are the market's history narrowed to the table, so they are read and shown only to
 * someone the history's row lets in: an owner may raise it above a role that still sees the table.
 */
const readsHistory = computed(() => mayTake(props.market, MarketAction.ReadHistory));

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

/**
 * A market of an organization may take its organization's default again: a copy at creation never
 * follows a later change to it (E39/F02/S01).
 */
const mayCopy = computed(() => mayChange.value && !!props.market.organizationId);

const marketPath = () => `/markets/${encodeURIComponent(props.market.id)}`;

async function toggle() {
  open.value = !open.value;
  if (open.value) await fetchHistory();
}

/** The market's history narrowed to its table, newest first: read when the section opens and
 * after each change, never on the market read, which every write re-reads. */
async function fetchHistory() {
  historyError.value = '';
  if (!readsHistory.value) return;
  try {
    const response = await api.get(`${marketPath()}/permission-history`);
    history.value = response.data.entries ?? [];
  } catch (err) {
    historyError.value = getApiErrorMessage(err, 'Failed to load the changes');
  }
}

/** A choice is asked about before it is sent. */
function askChange(row: PermissionTableRow, role: MarketRole, select: HTMLSelectElement) {
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
    // The dialog gives focus back to "Reset to built-in defaults", which is disabled now that
    // nothing is held, and focusing a disabled control does nothing: the section's toggle takes it.
    if (document.activeElement === document.body) toggleEl.value?.focus();
  } catch (err) {
    writeError.value = getApiErrorMessage(err, 'Failed to reset the table');
  }
}

function cancelCopy() {
  copyConfirming.value = false;
  writeError.value = '';
}

async function confirmCopy() {
  writeError.value = '';
  try {
    const response = await api.post(`${marketPath()}/permissions/organization-default`);
    copyConfirming.value = false;
    await afterWrite(response.data.permissionTable);
  } catch (err) {
    writeError.value = getApiErrorMessage(err, "Failed to copy the organization's defaults");
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
        ref="toggleEl"
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
      <PermissionRows
        :table="table"
        :editable="mayChange"
        :source-of="(row) => sourceLine(row, history)"
        testid="manage-market-permission"
        @ask="askChange"
      />
      <div v-if="mayChange" class="actions">
        <button
          type="button"
          class="btn btn--secondary"
          :disabled="!resetChanges.length"
          data-testid="manage-market-permissions-reset"
          @click="resetConfirming = true"
        >
          Reset to built-in defaults
        </button>
        <button
          v-if="mayCopy"
          type="button"
          class="btn btn--secondary"
          data-testid="manage-market-permissions-copy"
          @click="copyConfirming = true"
        >
          Copy the organization's defaults again
        </button>
      </div>

      <PermissionChanges
        v-if="readsHistory"
        :entries="history"
        :table="table"
        :error="historyError"
        testid="manage-market-permission"
      />
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

    <!-- Destructive as the reset is: every row the owner set gives way to the organization's. -->
    <AppDialog
      :open="copyConfirming"
      title="Copy the organization's defaults again?"
      testid="manage-market-permissions-copy-confirm"
      destructive
      confirm-label="Copy"
      :error="writeError"
      @close="cancelCopy"
      @submit="confirmCopy"
    >
      <p class="confirm-text">
        Every row takes the organization's default for new markets as it is now, and a row it does
        not set returns to its built-in default. Rows changed on this market are replaced.
      </p>
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

.body {
  margin-top: var(--space-2);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
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
