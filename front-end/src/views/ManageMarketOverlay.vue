<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  IntakeMode,
  type Market,
  MarketPhase,
  MarketRole,
  type PermissionTableRow,
} from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import { useMarketStore } from '@/stores/market';
import AppDialog from '@/components/AppDialog.vue';
import {
  getRoleDisplayName,
  canManageRoles,
  getRolesForChange,
  GIVEN_ROLES,
} from '@/utils/permissions';
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import {
  WHO_MAY_CHOICES,
  changeConsequence,
  changeLines,
  changeQuestion,
  groupedRows,
  heldRows,
  selfPromotionWarning,
  sourceLine,
  whoMayLabel,
  type PermissionHistoryEntry,
} from '@/utils/permissionTable';
import { getFormattedTimestamp } from '@/utils/utils';

const props = defineProps<{
  manageOpen: boolean;
  market: Market | null;
}>();

const emit = defineEmits<{
  manageClose: [];
}>();

const marketData = ref<Market | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const renameValue = ref('');
const showAddUserForm = ref(false);
const newUserEmail = ref('');
const newUserRole = ref<MarketRole>(MarketRole.Editor);
const addUserError = ref('');
const renameError = ref('');
const deleteConfirming = ref(false);
const deleteError = ref('');
/** A refused change to one person's access, said beneath their row. */
const userError = ref<{ userId: string; message: string } | null>(null);
/** The Permissions section is closed until asked for: every row of the table, and its changes. */
const permissionsOpen = ref(false);
const permissionHistory = ref<PermissionHistoryEntry[]>([]);
const permissionHistoryError = ref('');
/** A row's change waiting on its confirmation, with the select that asked, to put back on Cancel. */
const pendingChange = ref<{
  row: PermissionTableRow;
  role: MarketRole;
  select: HTMLSelectElement;
} | null>(null);
const resetConfirming = ref(false);
/** A refused change to the table, said in the confirmation that sent it. */
const permissionError = ref('');

watch(
  () => [props.manageOpen, props.market] as const,
  async ([open, market]) => {
    if (open && market) {
      marketData.value = market;
      renameValue.value = market.name;
      showAddUserForm.value = false;
      deleteConfirming.value = false;
      errorMessage.value = '';
      userError.value = null;
      addUserError.value = '';
      renameError.value = '';
      deleteError.value = '';
      permissionsOpen.value = false;
      permissionHistory.value = [];
      permissionHistoryError.value = '';
      pendingChange.value = null;
      resetConfirming.value = false;
      permissionError.value = '';
      await fetchMarket();
    } else {
      marketData.value = null;
    }
  },
  { immediate: true },
);

async function fetchMarket(showLoading = true) {
  if (!marketData.value) return;
  if (showLoading) loading.value = true;
  errorMessage.value = '';
  try {
    const response = await api.get(`/markets/${encodeURIComponent(marketData.value.id)}`);
    const m = response.data.market;
    marketData.value = parseMarketFromApi(m);
    renameValue.value = marketData.value.name;
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load market');
  } finally {
    if (showLoading) loading.value = false;
  }
}

function getUserList(): Array<{ userId: string; email: string; role: MarketRole }> {
  if (!marketData.value?.roles) return [];
  return Object.entries(marketData.value.roles).map(([userId, role]) => ({
    userId,
    email: marketData.value!.roleEmails?.[userId] ?? userId,
    role: role as MarketRole,
  }));
}

/** What this caller could change the given role TO. Empty means it is not theirs to change. */
function changeableRoles(role: MarketRole): MarketRole[] {
  return getRolesForChange(marketData.value, role);
}

/**
 * The roles this person may grant, in the order they are offered. Empty for a Viewer or an Editor,
 * who were shown "Add user" and refused with a 403 (bug 37).
 */
const grantableRoles = computed(() =>
  GIVEN_ROLES.filter((role) => canManageRoles(marketData.value, role)),
);

/** Deleting a market is the table's "Delete the market" row, its owner's alone. */
const canDelete = computed(() => mayTake(marketData.value, MarketAction.DeleteMarket));

/** Why this person may not rename the market, the Market Setup row's answer, or null. */
const renameRefusal = computed(() => actionRefusal(marketData.value, MarketAction.ChangeSetup));

async function handleAddUser() {
  if (!marketData.value || !newUserEmail.value.trim()) return;
  addUserError.value = '';
  try {
    await api.post(`/markets/${encodeURIComponent(marketData.value.id)}/roles`, {
      user_email: newUserEmail.value.trim(),
      role: newUserRole.value,
    });
    // The form stays open with an empty field: adding two people in a row is the case E20/F01/S02
    // is named after, and this dialog is the same shape.
    newUserEmail.value = '';
    newUserRole.value = MarketRole.Editor;
    await fetchMarket(false);
  } catch (err) {
    addUserError.value = getApiErrorMessage(err, 'Failed to add user');
  }
}

async function handleRemoveUser(userId: string) {
  if (!marketData.value) return;
  userError.value = null;
  try {
    await api.delete(
      `/markets/${encodeURIComponent(marketData.value.id)}/roles/${encodeURIComponent(userId)}`,
    );
    await fetchMarket(false);
  } catch (err) {
    userError.value = { userId, message: getApiErrorMessage(err, 'Failed to remove user') };
  }
}

/** A refused change puts the select back on the role they still hold, and says why under it. */
async function handleRoleChange(userId: string, held: MarketRole, select: HTMLSelectElement) {
  if (!marketData.value) return;
  userError.value = null;
  try {
    await api.put(
      `/markets/${encodeURIComponent(marketData.value.id)}/roles/${encodeURIComponent(userId)}`,
      { role: select.value as MarketRole },
    );
    await fetchMarket(false);
  } catch (err) {
    select.value = held;
    userError.value = { userId, message: getApiErrorMessage(err, 'Failed to update role') };
  }
}

/**
 * The name is the market's public web address, so it can change only while the market is a draft
 * (E21/F03/S04). Past that, this says why rather than offering a control the server refuses.
 */
const renameAllowed = computed(() => marketData.value?.phase === MarketPhase.Draft);

async function handleRename() {
  if (!marketData.value || renameValue.value.trim() === marketData.value.name) return;
  renameError.value = '';
  try {
    // Its own write, carrying only the name - not the whole market (E21/F03/S04).
    await api.put(`/markets/${encodeURIComponent(marketData.value.id)}/name`, {
      name: renameValue.value.trim(),
    });
    await fetchMarket(false);
    // The open market may be this one: a rename is a write, so the store re-reads it.
    const store = useMarketStore();
    if (store.marketId === marketData.value?.id) void store.refresh();
  } catch (err) {
    // The server's own words: a clash is about the public web address, not only the exact name.
    renameError.value = getApiErrorMessage(err, 'Failed to rename');
  }
}

/**
 * Which of its public pages go with it, in words: a form market's application page from the moment
 * it opens, and a check-in page while it runs or kept as a record once it has (E26/F06/S02).
 */
const publicPages = computed(() => {
  const market = marketData.value;
  if (!market) return '';
  const pages: string[] = [];
  if (market.intakeMode === IntakeMode.Form && market.phase !== MarketPhase.Draft) {
    pages.push('application page');
  }
  const ran = market.phasesReached?.includes(MarketPhase.MarketDays);
  if (market.phase === MarketPhase.MarketDays || (market.phase === MarketPhase.Archived && ran)) {
    pages.push('check-in page');
  }
  if (!pages.length) return '';
  return `Its ${pages.join(' and ')} will stop working for anyone who has the link.`;
});

async function handleDeleteConfirm() {
  if (!marketData.value) return;
  deleteError.value = '';
  try {
    await api.delete(`/markets/${encodeURIComponent(marketData.value.id)}`);
    deleteConfirming.value = false;
    emit('manageClose');
  } catch (err) {
    deleteError.value = getApiErrorMessage(err, 'Failed to delete market');
  }
}

function handleDeleteCancel() {
  deleteConfirming.value = false;
  deleteError.value = '';
}

const permissionTable = computed(() => marketData.value?.permissionTable ?? []);
const permissionGroups = computed(() => groupedRows(permissionTable.value));

/** Changing the table is its own fixed row, the market owner's alone (E39/F01/S03). */
const mayChangeTable = computed(() => mayTake(marketData.value, MarketAction.ChangeTheTable));

/**
 * Why the section is read-only, or null for the owner. An archived market refuses its owner too,
 * and the archived rule's words say so; everyone else is told whose the table is.
 */
const tableReadOnlyLine = computed(() => {
  if (mayChangeTable.value) return null;
  if (marketData.value?.phase === MarketPhase.Archived) {
    return actionRefusal(marketData.value, MarketAction.ChangeTheTable);
  }
  return "Only the market's owner changes these.";
});

/** Said while the section is closed, so the dialog says whether there is anything to look at. */
const tableSummary = computed(() => {
  const held = heldRows(permissionTable.value);
  if (!held) return 'Every row is at its built-in default.';
  return `${held} ${held === 1 ? 'row differs' : 'rows differ'} from the built-in defaults.`;
});

/** The rows a reset would return, each from its role now to its default. */
const resetChanges = computed(() =>
  permissionTable.value
    .filter((row) => row.source !== 'built-in')
    .map((row) => `${row.label}: ${whoMayLabel(row.role)} to ${whoMayLabel(row.default)}`),
);

async function togglePermissions() {
  permissionsOpen.value = !permissionsOpen.value;
  if (permissionsOpen.value) await fetchPermissionHistory();
}

/** The market's history narrowed to its table, newest first: read when the section opens and
 * after each change, never on the market read, which every write re-reads. */
async function fetchPermissionHistory() {
  if (!marketData.value) return;
  permissionHistoryError.value = '';
  try {
    const response = await api.get(
      `/markets/${encodeURIComponent(marketData.value.id)}/permission-history`,
    );
    permissionHistory.value = response.data.entries ?? [];
  } catch (err) {
    permissionHistoryError.value = getApiErrorMessage(err, 'Failed to load the changes');
  }
}

/** A choice is asked about before it is sent; choosing the role the row already asks is nothing. */
function askPermissionChange(row: PermissionTableRow, select: HTMLSelectElement) {
  const role = select.value as MarketRole;
  if (role === row.role) return;
  permissionError.value = '';
  pendingChange.value = { row, role, select };
}

/** Cancelling puts the select back on the role the row still asks. */
function cancelPermissionChange() {
  if (pendingChange.value) pendingChange.value.select.value = pendingChange.value.row.role;
  pendingChange.value = null;
  permissionError.value = '';
}

async function confirmPermissionChange() {
  const pending = pendingChange.value;
  if (!marketData.value || !pending) return;
  permissionError.value = '';
  try {
    const response = await api.put(
      `/markets/${encodeURIComponent(marketData.value.id)}/permissions/${encodeURIComponent(pending.row.id)}`,
      { role: pending.role },
    );
    pendingChange.value = null;
    await afterTableChange(response.data.permissionTable);
  } catch (err) {
    permissionError.value = getApiErrorMessage(err, 'Failed to change who may do this');
  }
}

function cancelPermissionsReset() {
  resetConfirming.value = false;
  permissionError.value = '';
}

async function confirmPermissionsReset() {
  if (!marketData.value) return;
  permissionError.value = '';
  try {
    const response = await api.delete(
      `/markets/${encodeURIComponent(marketData.value.id)}/permissions`,
    );
    resetConfirming.value = false;
    await afterTableChange(response.data.permissionTable);
  } catch (err) {
    permissionError.value = getApiErrorMessage(err, 'Failed to reset the table');
  }
}

/**
 * The write answers the table, which the section shows at once; the changes are read again. The
 * open market is re-read if it is this one, as a rename does, and every other screen asks the table
 * at its next read of the market.
 */
async function afterTableChange(table: PermissionTableRow[] | undefined) {
  if (!marketData.value) return;
  if (table) marketData.value = { ...marketData.value, permissionTable: table };
  await fetchPermissionHistory();
  const store = useMarketStore();
  if (store.marketId === marketData.value?.id) void store.refresh();
}

/** Cancelling clears what was typed and any error, so reopening does not hand back a rejected value. */
function closeAddUser() {
  showAddUserForm.value = false;
  newUserEmail.value = '';
  addUserError.value = '';
}
</script>

<template>
  <AppDialog
    :open="manageOpen"
    title="Manage market"
    testid="manage-market"
    wide
    :error="errorMessage"
    @close="emit('manageClose')"
  >
    <p v-if="marketData" class="market-name">{{ marketData.name }}</p>

    <p v-if="loading" class="empty-state">Loading...</p>
    <div v-else-if="marketData" class="content">
      <section class="section">
        <h3>Users with access</h3>
        <div class="users-list">
          <div v-for="{ userId, email, role } in getUserList()" :key="userId" class="user-entry">
            <div class="user-card">
              <span class="user-email">{{ email }}</span>
              <!--
              A role with nowhere to go is stated, not offered (E20/F01/S03). The owner's own row
              rendered a select whose only option was "Owner" - a control that looks like a
              decision and is not one, which is the same thing S01 settled for the org picker.
            -->
              <span
                v-if="!changeableRoles(role).length"
                class="role-badge"
                :class="`role-${(role as string).toLowerCase()}`"
              >
                {{ getRoleDisplayName(role) }}
              </span>
              <select
                v-else
                :value="role"
                :aria-label="`${email}'s role`"
                class="field field--select role-select"
                data-testid="manage-market-role-select"
                @change="handleRoleChange(userId, role, $event.target as HTMLSelectElement)"
              >
                <option :value="role">{{ getRoleDisplayName(role) }}</option>
                <option v-for="r in changeableRoles(role)" :key="r" :value="r">
                  {{ getRoleDisplayName(r) }}
                </option>
              </select>
              <button
                v-if="canManageRoles(marketData, role)"
                type="button"
                class="btn btn--destructive"
                title="Remove user"
                data-testid="manage-market-remove-user-button"
                @click="handleRemoveUser(userId)"
              >
                Remove
              </button>
            </div>
            <!-- Beneath the row that caused it: a refused change used to be reported at the foot of
                 the dialog, far from the select that made it (bug 43). -->
            <p
              v-if="userError?.userId === userId"
              class="form-error"
              data-testid="manage-market-user-error"
            >
              {{ userError.message }}
            </p>
          </div>
          <p v-if="getUserList().length === 0" class="empty-state">No users with explicit access</p>
        </div>
        <!-- Opens the row it adds; that row carries its own Cancel. The button used to turn into a
             Cancel of its own, left alone above the row it cancelled (bug 43). -->
        <button
          v-if="grantableRoles.length && !showAddUserForm"
          type="button"
          class="btn btn--secondary"
          data-testid="manage-market-add-user-button"
          @click="showAddUserForm = true"
        >
          Add user
        </button>
        <!-- Its own form, so Enter in the field adds the user through the very same handler. -->
        <form v-if="showAddUserForm" class="add-user-form" @submit.prevent="handleAddUser">
          <div class="add-org-row">
            <input
              v-model="newUserEmail"
              type="email"
              placeholder="User email"
              aria-label="Email of the person to add"
              class="field"
              data-testid="manage-market-add-user-input"
            />
            <select
              v-model="newUserRole"
              aria-label="Their role"
              class="field field--select"
              data-testid="manage-market-add-user-select"
            >
              <option v-for="r in grantableRoles" :key="r" :value="r">
                {{ getRoleDisplayName(r) }}
              </option>
            </select>
            <button
              type="submit"
              class="btn btn--primary"
              :disabled="!newUserEmail.trim()"
              data-testid="manage-market-add-user-submit"
            >
              Add
            </button>
            <button
              type="button"
              class="btn btn--secondary"
              data-testid="manage-market-add-user-cancel"
              @click="closeAddUser"
            >
              Cancel
            </button>
          </div>
          <p v-if="addUserError" class="form-error" data-testid="manage-market-add-user-error">
            {{ addUserError }}
          </p>
        </form>
      </section>

      <!-- Who may do what on this market (E39/F01/S04): closed until opened, since the table and
           its changes would double the dialog's length for everyone who came to add a person. -->
      <section
        v-if="permissionTable.length"
        class="section"
        aria-labelledby="manage-market-permissions-heading"
        data-testid="manage-market-permissions"
      >
        <div class="section-head">
          <h3 id="manage-market-permissions-heading">Permissions</h3>
          <button
            type="button"
            class="btn btn--secondary btn--compact"
            :aria-expanded="permissionsOpen"
            aria-controls="manage-market-permissions-body"
            data-testid="manage-market-permissions-toggle"
            @click="togglePermissions"
          >
            {{ permissionsOpen ? 'Hide' : 'Show' }}
          </button>
        </div>
        <p class="form-hint" data-testid="manage-market-permissions-summary">
          Who may do what on this market. {{ tableSummary }}
        </p>
        <div v-if="permissionsOpen" id="manage-market-permissions-body" class="permissions">
          <p
            v-if="tableReadOnlyLine"
            class="form-hint"
            data-testid="manage-market-permissions-read-only"
          >
            {{ tableReadOnlyLine }}
          </p>
          <div v-for="{ group, rows } in permissionGroups" :key="group">
            <h4 class="subheading">{{ group }}</h4>
            <ul class="permission-rows">
              <li
                v-for="row in rows"
                :key="row.id"
                class="permission-row"
                :data-row="row.id"
                data-testid="manage-market-permission-row"
              >
                <div class="permission-text">
                  <span :id="`manage-market-permission-${row.id}`" class="permission-label">
                    {{ row.label }}
                  </span>
                  <span class="permission-note" data-testid="manage-market-permission-source">
                    {{ row.fixed ? 'Always' : sourceLine(row, permissionHistory) }}
                  </span>
                  <span
                    v-if="row.id === MarketAction.ManageEditorsAndViewers"
                    class="permission-note"
                  >
                    At “Viewer and above”, any Viewer can make themself an Editor.
                  </span>
                </div>
                <!-- Named by the row's own words, which a voice user reads off the screen. -->
                <select
                  v-if="mayChangeTable && !row.fixed"
                  :value="row.role"
                  :aria-labelledby="`manage-market-permission-${row.id}`"
                  class="field field--select permission-select"
                  data-testid="manage-market-permission-select"
                  @change="askPermissionChange(row, $event.target as HTMLSelectElement)"
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
            v-if="mayChangeTable"
            type="button"
            class="btn btn--secondary permissions-reset"
            :disabled="!resetChanges.length"
            data-testid="manage-market-permissions-reset"
            @click="resetConfirming = true"
          >
            Reset to built-in defaults
          </button>

          <h4 class="subheading">Changes</h4>
          <p v-if="permissionHistoryError" class="form-error">{{ permissionHistoryError }}</p>
          <p v-else-if="!permissionHistory.length" class="empty-state">No changes yet.</p>
          <ol v-else class="permission-changes" data-testid="manage-market-permission-changes">
            <li
              v-for="entry in permissionHistory"
              :key="entry.id"
              class="permission-change"
              data-testid="manage-market-permission-change"
            >
              <span class="permission-label">{{ changeLines(entry, permissionTable).title }}</span>
              <span
                v-for="line in changeLines(entry, permissionTable).rows"
                :key="line"
                class="permission-change-line"
              >
                {{ line }}
              </span>
              <span class="permission-note">
                {{ entry.actor }}, {{ getFormattedTimestamp(entry.at) }}
              </span>
            </li>
          </ol>
        </div>
      </section>

      <!-- One organization, fixed when the market was created (E21/F03/S05). This was a list,
           "Organizations with access", with Add and Remove - but there is only ever one, "Add"
           REPLACED it (moving the market, who can see it, and whose deletion deletes it), and it
           fell back to the typed text as an id when no organization of that name existed. -->
      <section class="section">
        <h3>Organization</h3>
        <p class="org-line" data-testid="manage-market-organization">
          <template v-if="marketData.organizationName">
            Belongs to <strong>{{ marketData.organizationName }}</strong
            >. Its members can view it.
          </template>
          <template v-else>Belongs to no organization you can see.</template>
        </p>
      </section>

      <section class="section">
        <h3>Rename market</h3>
        <!-- Renaming is the Market Setup row's: whoever may not change the setup is told why (bug 37). -->
        <p v-if="renameRefusal" class="form-hint" data-testid="manage-market-rename-refused">
          {{ renameRefusal }}
        </p>
        <p v-else-if="!renameAllowed" class="form-hint" data-testid="manage-market-rename-fixed">
          This market's public web address comes from its name, and it has already been shared, so
          its name can no longer change.
        </p>
        <form v-else class="rename-row" @submit.prevent="handleRename">
          <input
            v-model="renameValue"
            class="field"
            aria-label="Market name"
            data-testid="manage-market-rename-input"
          />
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="!renameValue.trim() || renameValue.trim() === marketData.name"
            data-testid="manage-market-rename-save-button"
          >
            Save
          </button>
        </form>
        <p v-if="renameError" class="form-error" data-testid="manage-market-rename-error">
          {{ renameError }}
        </p>
      </section>

      <section v-if="canDelete" class="section danger-section">
        <h3>Delete market</h3>
        <button
          type="button"
          class="btn btn--destructive"
          data-testid="manage-market-delete-button"
          @click="deleteConfirming = true"
        >
          Delete market
        </button>
      </section>
    </div>
  </AppDialog>

  <!--
    The product's destructive dialog, as archiving and deleting an organization are (bug 43): it
    names what goes, and opens on Cancel. It was an inline "Are you sure?" with Confirm before
    Cancel and focus left on the page, so one stray Enter was the whole irreversible action.
  -->
  <AppDialog
    :open="manageOpen && deleteConfirming && !!marketData"
    :title="`Delete ${marketData?.name ?? 'this market'}?`"
    testid="manage-market-delete"
    destructive
    confirm-label="Delete market"
    :error="deleteError"
    @close="handleDeleteCancel"
    @submit="handleDeleteConfirm"
  >
    <p class="confirm-text" data-testid="manage-market-delete-consequence">
      This deletes the market with its applications, its assignments, its check-in records and the
      record of who changed what. It cannot be undone.
    </p>
    <p v-if="publicPages" class="confirm-text" data-testid="manage-market-delete-public">
      {{ publicPages }}
    </p>
  </AppDialog>

  <!-- A row's change is saved on its own, once confirmed in words naming who may after it. -->
  <AppDialog
    :open="manageOpen && !!pendingChange"
    :title="pendingChange ? changeQuestion(pendingChange.row, pendingChange.role) : ''"
    testid="manage-market-permission-confirm"
    confirm-label="Change"
    :error="permissionError"
    @close="cancelPermissionChange"
    @submit="confirmPermissionChange"
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

  <AppDialog
    :open="manageOpen && resetConfirming"
    title="Reset every row to its built-in default?"
    testid="manage-market-permissions-reset-confirm"
    confirm-label="Reset"
    :error="permissionError"
    @close="cancelPermissionsReset"
    @submit="confirmPermissionsReset"
  >
    <ul class="reset-changes" data-testid="manage-market-permissions-reset-changes">
      <li v-for="line in resetChanges" :key="line" class="confirm-text">{{ line }}</li>
    </ul>
  </AppDialog>
</template>

<style scoped>
/* The scrim, window, close control and width belong to `AppDialog`; the buttons and fields to
   `primitives.css`. What is left is this dialog's own list of people and organizations. */
.market-name {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.section h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.user-entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.user-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
}

.user-email {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.role-badge {
  display: inline-block;
  padding: var(--space-hairline) var(--space-2);
  border-radius: var(--radius-control);
  font-weight: 400;
  font-size: var(--text-xs);
  white-space: nowrap;
}

/* A role the caller may change is a select, not a badge pretending to be one. It used to be a
   badge wrapping a transparent select and a hand-drawn chevron, which is three things saying one. */
.role-select {
  width: auto;
  flex: 0 0 auto;
}

/* Opaque chip grounds, so a badge reads the same on a dialog's beige as on white (T79). */
.role-owner {
  background: var(--mm-chip-informational);
  color: var(--mm-blue);
}

.role-admin {
  background: var(--mm-chip-positive);
  color: var(--mm-text-green);
}

.role-editor,
.role-viewer {
  background: var(--mm-chip-positive);
  color: var(--mm-text-green);
}

.empty-state {
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
  margin: 0;
}

.add-user-form {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.org-line {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.add-org-row,
.rename-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.form-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.form-hint {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
}

.danger-section {
  padding-top: var(--space-4);
  border-top: 1px solid var(--mm-border);
}

.confirm-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-1);
}

.section .section-head h3 {
  margin: 0;
}

.subheading {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.permissions {
  margin-top: var(--space-2);
}

.permission-rows,
.permission-changes,
.reset-changes {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A compact table rather than a card per row, which would make the dialog unwieldy. */
.permission-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

.permission-text {
  flex: 1 1 16rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
}

.permission-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.permission-note {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.permission-select {
  width: auto;
  flex: 0 0 auto;
}

.permissions-reset {
  margin-top: var(--space-3);
}

.permission-change {
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

/* The row an entry is about leads it, so a list of entries does not read as one run of lines. */
.permission-change > .permission-label {
  font-weight: 600;
}

.permission-change-line {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.reset-changes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
