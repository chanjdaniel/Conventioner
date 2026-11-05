<script setup lang="ts">
/**
 * Manage organization's "Default permissions for new markets" (E39/F02/S01): the table each market
 * created in the organization starts with, copied into it, and every change to it. The section is a
 * heading, one line and a button; the rows and changes open in a dialog of their own (T217).
 *
 * Its owner and its admins set each row, or reset them all, after a confirmation saying the change
 * reaches only markets created from now on; its members read it. The rows and the changes are
 * Manage market's Permissions' (`PermissionRows`, `PermissionChanges`), and the words
 * `utils/permissionTable.ts`'s.
 */
import { computed, ref } from 'vue';
import { MarketRole, type Organization, type PermissionTableRow } from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import AppDialog from '@/components/AppDialog.vue';
import PermissionChanges from '@/components/PermissionChanges.vue';
import PermissionRows from '@/components/PermissionRows.vue';
import {
  DEFAULT_REACHES,
  changeConsequence,
  defaultChangeQuestion,
  defaultSourceLine,
  heldRows,
  selfPromotionWarning,
  whoMayLabel,
  type PermissionHistoryEntry,
} from '@/utils/permissionTable';

const props = defineProps<{ org: Organization }>();

const emit = defineEmits<{
  /** The default table a write answered, for the dialog's copy of the organization. */
  changed: [table: PermissionTableRow[]];
}>();

/** Closed until asked for: every row of the table, and its changes. */
const open = ref(false);
const dialog = ref<InstanceType<typeof AppDialog> | null>(null);
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

const table = computed(() => props.org.defaultPermissionTable ?? []);
const held = computed(() => heldRows(table.value));

/** The organization's owner and its admins change it, as the server holds (Daniel, Q22). */
const mayChange = computed(() => props.org.userRole === 'owner' || props.org.userRole === 'admin');

/** Said with the heading, so the section says whether there is anything to look at. */
const summary = computed(() => {
  const count = held.value.length;
  if (!count) return 'Every row is at its built-in default.';
  return `${count} ${count === 1 ? 'row differs' : 'rows differ'} from the built-in defaults.`;
});

/** The rows a reset would return, each from its role now to its default. */
const resetChanges = computed(() =>
  held.value.map((row) => `${row.label}: ${whoMayLabel(row.role)} to ${whoMayLabel(row.default)}`),
);

const orgPath = () => `/organizations/${encodeURIComponent(props.org.id)}`;

async function openDialog() {
  open.value = true;
  await fetchHistory();
}

/** The organization's history narrowed to its default, newest first: read when the dialog opens
 * and after each change. */
async function fetchHistory() {
  historyError.value = '';
  try {
    const response = await api.get(`${orgPath()}/default-permission-history`);
    history.value = response.data.entries ?? [];
  } catch (err) {
    historyError.value = getApiErrorMessage(err, 'The changes could not be loaded.');
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
      `${orgPath()}/default-permissions/${encodeURIComponent(pending.row.id)}`,
      { role: pending.role },
    );
    pendingChange.value = null;
    await afterWrite(response.data.permissionTable);
  } catch (err) {
    writeError.value = getApiErrorMessage(err, 'Who may do this was not changed.');
  }
}

function cancelReset() {
  resetConfirming.value = false;
  writeError.value = '';
}

async function confirmReset() {
  writeError.value = '';
  try {
    const response = await api.delete(`${orgPath()}/default-permissions`);
    resetConfirming.value = false;
    await afterWrite(response.data.permissionTable);
    // The confirmation gives focus back to "Reset to built-in defaults", which is disabled now that
    // nothing is set, and focusing a disabled control does nothing: the dialog takes it in again.
    if (document.activeElement === document.body) await dialog.value?.focusInside();
  } catch (err) {
    writeError.value = getApiErrorMessage(err, 'The defaults were not reset.');
  }
}

/** The write answers the table, which the dialog shows at once; the changes are read again. */
async function afterWrite(answered: PermissionTableRow[] | undefined) {
  if (answered) emit('changed', answered);
  await fetchHistory();
}
</script>

<template>
  <section
    class="section"
    aria-labelledby="manage-org-permissions-heading"
    data-testid="manage-org-permissions"
  >
    <div class="section-head">
      <h3 id="manage-org-permissions-heading">Default permissions for new markets</h3>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="manage-org-permissions-open"
        @click="openDialog"
      >
        Show
      </button>
    </div>
    <p class="hint" data-testid="manage-org-permissions-summary">
      Each market created in this organization starts with these. {{ summary }}
    </p>
  </section>

  <!-- Siblings of Manage organization rather than inside its window, as a dialog opened from a
       dialog is (docs/implementation/conventions/dialogs.md). -->
  <Teleport to="body">
    <!-- First, so the confirmations it opens paint above it. Its rows and changes scroll beneath a
         title that stays, and whoever may change the table reaches Reset from any row. -->
    <AppDialog
      ref="dialog"
      :open="open"
      title="Default permissions for new markets"
      testid="manage-org-permissions"
      size="wide"
      scroll="body"
      @close="open = false"
    >
      <!-- One box, or the body's gap would come between each group as well as its own margins. -->
      <div>
        <p v-if="!mayChange" class="hint" data-testid="manage-org-permissions-read-only">
          Only the organization's owner and its admins change these.
        </p>
        <PermissionRows
          :table="table"
          :editable="mayChange"
          :source-of="(row) => defaultSourceLine(row, history)"
          testid="manage-org-permission"
          @ask="askChange"
        />
        <PermissionChanges
          :entries="history"
          :table="table"
          :error="historyError"
          testid="manage-org-permission"
        />
      </div>
      <template v-if="mayChange" #actions>
        <button
          type="button"
          class="btn btn--secondary"
          :disabled="!resetChanges.length"
          data-testid="manage-org-permissions-reset"
          @click="resetConfirming = true"
        >
          Reset to built-in defaults
        </button>
      </template>
    </AppDialog>

    <!-- A row's change is saved on its own, once confirmed in words saying what it reaches. -->
    <AppDialog
      :open="!!pendingChange"
      :title="pendingChange ? defaultChangeQuestion(pendingChange.row) : ''"
      testid="manage-org-permission-confirm"
      confirm-label="Change"
      :error="writeError"
      @close="cancelChange"
      @submit="confirmChange"
    >
      <template v-if="pendingChange">
        <p class="confirm-text" data-testid="manage-org-permission-confirm-change">
          {{ pendingChange.row.label }}: {{ whoMayLabel(pendingChange.row.role) }} to
          {{ whoMayLabel(pendingChange.role) }}.
          {{ changeConsequence(pendingChange.row.role, pendingChange.role) }}
        </p>
        <p
          v-if="selfPromotionWarning(pendingChange.row.id, pendingChange.role)"
          class="confirm-text"
          data-testid="manage-org-permission-confirm-warning"
        >
          {{ selfPromotionWarning(pendingChange.row.id, pendingChange.role) }}
        </p>
        <p class="confirm-text" data-testid="manage-org-permission-confirm-reach">
          {{ DEFAULT_REACHES }}
        </p>
      </template>
    </AppDialog>

    <!-- Destructive: it throws away every row the organization set, so it opens on Cancel. -->
    <AppDialog
      :open="resetConfirming"
      title="Reset every row for new markets to its built-in default?"
      testid="manage-org-permissions-reset-confirm"
      scroll="body"
      destructive
      confirm-label="Reset"
      :error="writeError"
      @close="cancelReset"
      @submit="confirmReset"
    >
      <ul class="rows reset-changes" data-testid="manage-org-permissions-reset-changes">
        <li v-for="line in resetChanges" :key="line" class="confirm-text">{{ line }}</li>
      </ul>
      <p class="confirm-text">{{ DEFAULT_REACHES }}</p>
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

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
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
