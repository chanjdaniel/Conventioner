<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { type Market, MarketPhase, MarketRole } from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import { useMarketStore } from '@/stores/market';
import AppDialog from '@/components/AppDialog.vue';
import {
  getRoleDisplayName,
  canManageRoles,
  canChangeRole,
  getRolesForChange,
} from '@/utils/permissions';

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
const showAddOrgForm = ref(false);
const newOrgName = ref('');
const addOrgError = ref('');
const userOrgs = ref<Array<{ id: string; name: string }>>([]);
const renameError = ref('');
const deleteConfirming = ref(false);
const deleteError = ref('');

const addableRoles = [MarketRole.Admin, MarketRole.Editor, MarketRole.Viewer];

watch(
  () => [props.manageOpen, props.market] as const,
  async ([open, market]) => {
    if (open && market) {
      marketData.value = market;
      renameValue.value = market.name;
      showAddUserForm.value = false;
      showAddOrgForm.value = false;
      deleteConfirming.value = false;
      errorMessage.value = '';
      addUserError.value = '';
      addOrgError.value = '';
      renameError.value = '';
      deleteError.value = '';
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

function getOrganizationList(): string[] {
  if (!marketData.value?.organizationName) return [];
  return [marketData.value.organizationName];
}

function getAvailableOrgsForAdd(): Array<{ id: string; name: string }> {
  const currentId = marketData.value?.organizationId;
  return userOrgs.value.filter((org) => org.id !== currentId);
}

async function fetchUserOrgs() {
  try {
    const response = await api.get('/organizations');
    userOrgs.value = response.data.organizations || [];
  } catch {
    userOrgs.value = [];
  }
}

/** What this caller could change the given role TO. Empty means it is not theirs to change. */
function changeableRoles(role: MarketRole): MarketRole[] {
  const userRole = marketData.value?.userRole;
  if (!userRole || !canChangeRole(userRole, role)) return [];
  return getRolesForChange(role, userRole);
}

function canRemoveUser(targetRole: MarketRole): boolean {
  if (targetRole === MarketRole.Owner) return false;
  const userRole = marketData.value?.userRole;
  if (!userRole) return false;
  return canManageRoles(userRole, targetRole);
}

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
  try {
    await api.delete(
      `/markets/${encodeURIComponent(marketData.value.id)}/roles/${encodeURIComponent(userId)}`,
    );
    await fetchMarket(false);
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to remove user');
  }
}

async function handleRoleChange(userId: string, newRole: MarketRole) {
  if (!marketData.value) return;
  try {
    await api.put(
      `/markets/${encodeURIComponent(marketData.value.id)}/roles/${encodeURIComponent(userId)}`,
      { role: newRole },
    );
    await fetchMarket(false);
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to update role');
  }
}

async function handleAddOrg() {
  if (!marketData.value || !newOrgName.value.trim()) return;
  addOrgError.value = '';
  try {
    const org = userOrgs.value.find((o) => o.name === newOrgName.value.trim());
    const orgId = org?.id ?? newOrgName.value.trim();
    const updated = { ...marketData.value, organizationId: orgId };
    await api.put(`/markets/${encodeURIComponent(marketData.value.id)}`, updated);
    marketData.value = {
      ...marketData.value,
      organizationId: orgId,
      organizationName: org?.name ?? newOrgName.value.trim(),
    };
    showAddOrgForm.value = false;
    newOrgName.value = '';
    await fetchMarket(false);
  } catch (err) {
    addOrgError.value = getApiErrorMessage(err, 'Failed to add organization');
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

async function handleDeleteConfirm() {
  if (!marketData.value) return;
  deleteError.value = '';
  try {
    await api.delete(`/markets/${encodeURIComponent(marketData.value.id)}`);
    emit('manageClose');
  } catch (err) {
    deleteError.value = getApiErrorMessage(err, 'Failed to delete market');
  }
}

function handleDeleteCancel() {
  deleteConfirming.value = false;
  deleteError.value = '';
}

/**
 * The add toggles double as Cancel, so they must not stay green once they say it - a primary fill
 * is this product's word for "the thing to do here" (E20/F01/S03). Cancelling clears what was
 * typed and any error, so reopening does not hand back a rejected value.
 */
function toggleAddUser() {
  showAddUserForm.value = !showAddUserForm.value;
  if (!showAddUserForm.value) {
    newUserEmail.value = '';
    addUserError.value = '';
  }
}

function toggleAddOrg() {
  showAddOrgForm.value = !showAddOrgForm.value;
  if (showAddOrgForm.value) {
    fetchUserOrgs();
    return;
  }
  newOrgName.value = '';
  addOrgError.value = '';
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
          <div v-for="{ userId, email, role } in getUserList()" :key="userId" class="user-card">
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
              class="field field--select role-select"
              data-testid="manage-market-role-select"
              @change="
                handleRoleChange(userId, ($event.target as HTMLSelectElement).value as MarketRole)
              "
            >
              <option :value="role">{{ getRoleDisplayName(role) }}</option>
              <option v-for="r in changeableRoles(role)" :key="r" :value="r">
                {{ getRoleDisplayName(r) }}
              </option>
            </select>
            <button
              v-if="canRemoveUser(role)"
              type="button"
              class="btn btn--compact btn--destructive"
              title="Remove user"
              data-testid="manage-market-remove-user-button"
              @click="handleRemoveUser(userId)"
            >
              Remove
            </button>
          </div>
          <p v-if="getUserList().length === 0" class="empty-state">No users with explicit access</p>
        </div>
        <button
          type="button"
          class="btn btn--compact"
          :class="showAddUserForm ? 'btn--secondary' : 'btn--primary'"
          data-testid="manage-market-add-user-button"
          @click="toggleAddUser()"
        >
          {{ showAddUserForm ? 'Cancel' : 'Add user' }}
        </button>
        <!-- Its own form, so Enter in the field adds the user through the very same handler. -->
        <form v-if="showAddUserForm" class="add-user-form" @submit.prevent="handleAddUser">
          <div class="add-org-row">
            <input
              v-model="newUserEmail"
              type="email"
              placeholder="User email"
              class="field"
              data-testid="manage-market-add-user-input"
            />
            <select
              v-model="newUserRole"
              class="field field--select"
              data-testid="manage-market-add-user-select"
            >
              <option v-for="r in addableRoles" :key="r" :value="r">
                {{ getRoleDisplayName(r) }}
              </option>
            </select>
            <button
              type="submit"
              class="btn btn--compact btn--primary"
              :disabled="!newUserEmail.trim()"
              data-testid="manage-market-add-user-submit"
            >
              Add
            </button>
          </div>
          <p v-if="addUserError" class="form-error" data-testid="manage-market-add-user-error">
            {{ addUserError }}
          </p>
        </form>
      </section>

      <section class="section">
        <h3>Organizations with access</h3>
        <div class="users-list">
          <div v-for="orgName in getOrganizationList()" :key="orgName" class="user-card">
            <span class="user-email">{{ orgName }}</span>
            <span class="role-badge role-viewer">Viewer</span>
          </div>
          <p v-if="getOrganizationList().length === 0" class="empty-state">
            No organizations with access
          </p>
        </div>
        <button
          type="button"
          class="btn btn--compact"
          :class="showAddOrgForm ? 'btn--secondary' : 'btn--primary'"
          data-testid="manage-market-add-org-button"
          @click="toggleAddOrg()"
        >
          {{ showAddOrgForm ? 'Cancel' : 'Add organization' }}
        </button>
        <form v-if="showAddOrgForm" class="add-user-form" @submit.prevent="handleAddOrg">
          <div class="add-org-row">
            <select
              v-model="newOrgName"
              class="field field--select"
              :disabled="getAvailableOrgsForAdd().length === 0"
              data-testid="manage-market-add-org-select"
            >
              <option value="">Select organization</option>
              <option v-for="org in getAvailableOrgsForAdd()" :key="org.name" :value="org.name">
                {{ org.name }}
              </option>
            </select>
            <button
              type="submit"
              class="btn btn--compact btn--primary"
              :disabled="!newOrgName.trim()"
              data-testid="manage-market-add-org-submit"
            >
              Add
            </button>
          </div>
          <p
            v-if="getAvailableOrgsForAdd().length === 0 && getOrganizationList().length > 0"
            class="form-hint"
          >
            All your organizations already have access
          </p>
          <p v-else-if="getAvailableOrgsForAdd().length === 0" class="form-hint">
            Create an organization first
          </p>
          <p v-if="addOrgError" class="form-error">{{ addOrgError }}</p>
        </form>
      </section>

      <section class="section">
        <h3>Rename market</h3>
        <p v-if="!renameAllowed" class="form-hint" data-testid="manage-market-rename-fixed">
          This market's public web address comes from its name, and it has already been shared, so
          its name can no longer change.
        </p>
        <form v-else class="rename-row" @submit.prevent="handleRename">
          <input v-model="renameValue" class="field" data-testid="manage-market-rename-input" />
          <button
            type="submit"
            class="btn btn--compact btn--primary"
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

      <section class="section danger-section">
        <h3>Delete market</h3>
        <div v-if="!deleteConfirming">
          <button
            type="button"
            class="btn btn--compact btn--destructive"
            data-testid="manage-market-delete-button"
            @click="deleteConfirming = true"
          >
            Delete market
          </button>
        </div>
        <div v-else class="delete-confirm">
          <p class="confirm-text">Are you sure? This cannot be undone.</p>
          <div class="confirm-buttons">
            <button
              type="button"
              class="btn btn--compact btn--destructive"
              data-testid="manage-market-delete-confirm-button"
              @click="handleDeleteConfirm"
            >
              Confirm
            </button>
            <button
              type="button"
              class="btn btn--compact btn--secondary"
              data-testid="manage-market-delete-cancel-button"
              @click="handleDeleteCancel"
            >
              Cancel
            </button>
          </div>
          <p v-if="deleteError" class="form-error">{{ deleteError }}</p>
        </div>
      </section>
    </div>
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

.role-owner {
  background: rgba(26, 111, 139, 0.14);
  color: var(--mm-blue);
}

.role-admin {
  background: rgba(54, 130, 111, 0.16);
  color: var(--mm-text-green);
}

.role-editor,
.role-viewer {
  background: rgba(54, 130, 111, 0.16);
  color: var(--mm-green);
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

.delete-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.confirm-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.confirm-buttons {
  display: flex;
  gap: var(--space-2);
}
</style>
