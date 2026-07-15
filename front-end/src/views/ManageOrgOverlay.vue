<script setup lang="ts">
import { ref, watch } from 'vue';
import { type Organization, type OrganizationRoleType } from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';

const props = defineProps<{
  manageOpen: boolean;
  org: Organization | null;
}>();

const emit = defineEmits<{
  manageClose: [];
}>();

const orgData = ref<Organization | null>(null);
const errorMessage = ref('');
const renameValue = ref('');
const renameError = ref('');
const showAddAdminForm = ref(false);
const showAddMemberForm = ref(false);
const newAdminEmail = ref('');
const newMemberEmail = ref('');
const addAdminError = ref('');
const addMemberError = ref('');
const deleteConfirming = ref(false);
const deleteError = ref('');

watch(
  () => [props.manageOpen, props.org] as const,
  ([open, org]) => {
    if (open && org) {
      orgData.value = org;
      renameValue.value = org.name;
      showAddAdminForm.value = false;
      showAddMemberForm.value = false;
      deleteConfirming.value = false;
      errorMessage.value = '';
      renameError.value = '';
      addAdminError.value = '';
      addMemberError.value = '';
      deleteError.value = '';
    } else {
      orgData.value = null;
    }
  },
  { immediate: true },
);

function canManage(): boolean {
  const role = orgData.value?.userRole;
  return role === 'owner' || role === 'admin';
}

function isOwner(): boolean {
  return orgData.value?.userRole === 'owner';
}

async function handleRename() {
  if (!orgData.value || renameValue.value.trim() === orgData.value.name) return;
  renameError.value = '';
  try {
    await api.put(`/organizations/${encodeURIComponent(orgData.value.id)}`, {
      name: renameValue.value.trim(),
    });
    orgData.value = { ...orgData.value, name: renameValue.value.trim() };
  } catch (err) {
    renameError.value = getApiErrorMessage(err, 'Failed to rename');
  }
}

async function handleAddAdmin() {
  if (!orgData.value || !newAdminEmail.value.trim()) return;
  addAdminError.value = '';
  try {
    await api.post(`/organizations/${encodeURIComponent(orgData.value.id)}/admins`, {
      user_email: newAdminEmail.value.trim(),
    });
    showAddAdminForm.value = false;
    newAdminEmail.value = '';
    emit('manageClose');
  } catch (err) {
    addAdminError.value = getApiErrorMessage(err, 'Failed to add admin');
  }
}

async function handleAddMember() {
  if (!orgData.value || !newMemberEmail.value.trim()) return;
  addMemberError.value = '';
  try {
    await api.post(`/organizations/${encodeURIComponent(orgData.value.id)}/members`, {
      user_email: newMemberEmail.value.trim(),
    });
    showAddMemberForm.value = false;
    newMemberEmail.value = '';
    emit('manageClose');
  } catch (err) {
    addMemberError.value = getApiErrorMessage(err, 'Failed to add member');
  }
}

async function handleRemoveUser(userId: string) {
  if (!orgData.value) return;
  try {
    await api.delete(
      `/organizations/${encodeURIComponent(orgData.value.id)}/users/${encodeURIComponent(userId)}`,
    );
    emit('manageClose');
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to remove user');
  }
}

function canRemoveUser(userId: string, role: OrganizationRoleType): boolean {
  if (role === 'owner') return false;
  if (!isOwner()) return role === 'member';
  return true;
}

async function handleDeleteConfirm() {
  if (!orgData.value) return;
  deleteError.value = '';
  try {
    await api.delete(`/organizations/${encodeURIComponent(orgData.value.id)}`);
    emit('manageClose');
  } catch (err) {
    deleteError.value = getApiErrorMessage(err, 'Failed to delete organization');
  }
}

function handleDeleteCancel() {
  deleteConfirming.value = false;
  deleteError.value = '';
}

function handleClose() {
  emit('manageClose');
}
</script>

<template>
  <div class="container" :style="{ visibility: manageOpen ? 'visible' : 'hidden' }">
    <div
      class="background"
      @click="handleClose"
      :style="{ opacity: manageOpen ? '100%' : '0%' }"
      data-testid="manage-org-overlay-background"
    />
    <div v-if="manageOpen && org" class="window">
      <div class="header">
        <h2>Manage organization</h2>
        <p v-if="orgData" class="org-name">{{ orgData.name }}</p>
        <p v-if="errorMessage" class="error-state">{{ errorMessage }}</p>
      </div>
      <div v-if="orgData" class="content">
        <section class="section">
          <h3>Owner</h3>
          <div class="user-card">
            <span class="user-email">{{ orgData.ownerEmail || 'Unknown' }}</span>
            <span class="role-badge role-owner">Owner</span>
          </div>
        </section>

        <section v-if="canManage()" class="section">
          <h3>Admins</h3>
          <div class="users-list">
            <div
              v-for="(email, idx) in orgData.adminEmails || []"
              :key="orgData.admins?.[idx] ?? idx"
              class="user-card"
            >
              <span class="user-email">{{ email }}</span>
              <span class="role-badge role-admin">Admin</span>
              <button
                v-if="isOwner() && canRemoveUser(orgData.admins![idx], 'admin')"
                class="remove-button"
                @click="handleRemoveUser(orgData.admins![idx])"
                title="Remove admin"
                data-testid="manage-org-remove-user-button"
              >
                Remove
              </button>
            </div>
            <p v-if="!orgData.adminEmails?.length && !showAddAdminForm" class="empty-state">
              No admins
            </p>
          </div>
          <button
            v-if="isOwner()"
            class="add-user-button"
            @click="showAddAdminForm = !showAddAdminForm"
            data-testid="manage-org-add-admin-button"
          >
            {{ showAddAdminForm ? 'Cancel' : 'Add admin' }}
          </button>
          <div v-if="showAddAdminForm" class="add-user-form">
            <div class="add-org-row">
              <input
                v-model="newAdminEmail"
                type="email"
                placeholder="User email"
                class="form-input"
                data-testid="manage-org-add-admin-input"
              />
              <button
                class="submit-button"
                @click="handleAddAdmin"
                data-testid="manage-org-add-admin-submit"
              >
                Add
              </button>
            </div>
            <p v-if="addAdminError" class="form-error">{{ addAdminError }}</p>
          </div>
        </section>

        <section v-if="canManage()" class="section">
          <h3>Members</h3>
          <div class="users-list">
            <div
              v-for="(email, idx) in orgData.memberEmails || []"
              :key="orgData.members?.[idx] ?? idx"
              class="user-card"
            >
              <span class="user-email">{{ email }}</span>
              <span class="role-badge role-member">Member</span>
              <button
                v-if="canRemoveUser(orgData.members![idx], 'member')"
                class="remove-button"
                @click="handleRemoveUser(orgData.members![idx])"
                title="Remove member"
                data-testid="manage-org-remove-member-button"
              >
                Remove
              </button>
            </div>
            <p v-if="!orgData.memberEmails?.length && !showAddMemberForm" class="empty-state">
              No members
            </p>
          </div>
          <button
            class="add-user-button"
            @click="showAddMemberForm = !showAddMemberForm"
            data-testid="manage-org-add-member-button"
          >
            {{ showAddMemberForm ? 'Cancel' : 'Add member' }}
          </button>
          <div v-if="showAddMemberForm" class="add-user-form">
            <div class="add-org-row">
              <input
                v-model="newMemberEmail"
                type="email"
                placeholder="User email"
                class="form-input"
                data-testid="manage-org-add-member-input"
              />
              <button
                class="submit-button"
                @click="handleAddMember"
                data-testid="manage-org-add-member-submit"
              >
                Add
              </button>
            </div>
            <p v-if="addMemberError" class="form-error">{{ addMemberError }}</p>
          </div>
        </section>

        <section v-if="canManage()" class="section">
          <h3>Rename organization</h3>
          <div class="rename-row">
            <input
              v-model="renameValue"
              class="form-input rename-input"
              data-testid="manage-org-rename-input"
            />
            <button
              class="save-button"
              @click="handleRename"
              data-testid="manage-org-rename-save-button"
            >
              Save
            </button>
          </div>
          <p v-if="renameError" class="form-error">{{ renameError }}</p>
        </section>

        <section v-if="isOwner()" class="section danger-section">
          <h3>Delete organization</h3>
          <div v-if="!deleteConfirming">
            <button
              class="delete-button"
              @click="deleteConfirming = true"
              data-testid="manage-org-delete-button"
            >
              Delete organization
            </button>
          </div>
          <div v-else class="delete-confirm">
            <p class="confirm-text">Are you sure? This cannot be undone.</p>
            <div class="confirm-buttons">
              <button
                class="confirm-delete-button"
                @click="handleDeleteConfirm"
                data-testid="manage-org-delete-confirm-button"
              >
                Confirm
              </button>
              <button
                class="cancel-button"
                @click="handleDeleteCancel"
                data-testid="manage-org-delete-cancel-button"
              >
                Cancel
              </button>
            </div>
            <p v-if="deleteError" class="form-error">{{ deleteError }}</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
}

.background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0%;
  transition:
    opacity 0.15s ease-in-out,
    visibility 0.15s ease-in-out;
  z-index: 0;
}

.window {
  position: relative;
  width: 70%;
  max-width: 600px;
  max-height: 85%;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 12px;
  z-index: 1;
  padding: 0;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.header {
  padding: 32px 40px 24px;
  border-bottom: 1px solid var(--mm-grey);
}

.header h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--mm-black);
  font-family: 'Outfit Regular', sans-serif;
}

.org-name {
  margin: 8px 0 0;
  color: #666;
  font-size: 14px;
}

.error-state {
  margin-top: 12px;
  color: #d32f2f;
  font-size: 14px;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 40px 32px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.section h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: var(--mm-black);
  font-family: 'Outfit Regular', sans-serif;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1.5px solid var(--mm-grey);
  border-radius: 8px;
  background: #fafafa;
}

.user-email {
  flex: 1;
  font-size: 14px;
  color: var(--mm-black);
}

.role-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  font-size: 12px;
}

.role-owner {
  background: #e3f2fd;
  color: #1976d2;
}

.role-admin {
  background: #f3e5f5;
  color: #7b1fa2;
}

.role-member {
  background: #e8f5e9;
  color: #388e3c;
}

.remove-button {
  padding: 4px 12px;
  font-size: 12px;
  background: transparent;
  color: #d32f2f;
  border: 1px solid #d32f2f;
  border-radius: 4px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.remove-button:hover {
  background: rgba(211, 47, 47, 0.08);
}

.empty-state {
  color: #666;
  font-size: 14px;
  margin: 0;
}

.add-user-button {
  padding: 8px 16px;
  font-size: 14px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.add-user-button:hover {
  background: #3a9a82;
}

.add-user-form {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-org-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.form-input {
  flex: 1;
  padding: 8px 12px;
  border: 1.5px solid var(--mm-grey);
  border-radius: 6px;
  font-size: 14px;
  font-family: 'Outfit Regular', sans-serif;
  min-width: 180px;
}

.submit-button {
  padding: 8px 16px;
  font-size: 14px;
  background: var(--mm-black);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.submit-button:hover {
  opacity: 0.9;
}

.rename-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.rename-input {
  flex: 1;
}

.save-button {
  padding: 8px 20px;
  font-size: 14px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.save-button:hover {
  background: #3a9a82;
}

.form-error {
  margin: 8px 0 0;
  color: #d32f2f;
  font-size: 13px;
}

.danger-section {
  padding-top: 20px;
  border-top: 1px solid var(--mm-grey);
}

.delete-button {
  padding: 8px 20px;
  font-size: 14px;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.delete-button:hover {
  background: #b71c1c;
}

.delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confirm-text {
  margin: 0;
  font-size: 14px;
  color: var(--mm-black);
}

.confirm-buttons {
  display: flex;
  gap: 10px;
}

.confirm-delete-button {
  padding: 8px 20px;
  font-size: 14px;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.confirm-delete-button:hover {
  background: #b71c1c;
}

.cancel-button {
  padding: 8px 20px;
  font-size: 14px;
  background: #666;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.cancel-button:hover {
  background: #555;
}

.content::-webkit-scrollbar {
  width: 8px;
}

.content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.content::-webkit-scrollbar-thumb {
  background: var(--mm-grey);
  border-radius: 4px;
}
</style>
