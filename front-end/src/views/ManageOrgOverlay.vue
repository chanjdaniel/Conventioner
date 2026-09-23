<script setup lang="ts">
/**
 * Manage organization: the dialog that used to vanish on you (E20/F01/S02).
 *
 * Adding an admin, adding a member and removing a user each succeeded and then emitted
 * `manageClose` - and the PARENT treated close as its refresh signal, so closing was the only
 * thing that re-read the data. Adding two people meant reopening the dialog between them.
 *
 * Closing never means saved, and saving never closes. That needs the two halves separated: this
 * dialog refreshes its own view of the organization, and the list behind it learns about the
 * change through `changed`, an event of its own. `handleRename` in this same file already worked
 * this way and was the model.
 *
 * It refreshes through the user's own organization LIST rather than `GET /organizations/<id>`:
 * the list endpoint is scoped to what the caller belongs to and returns the enriched shape this
 * dialog renders (emails and the caller's role), which the single-organization read does not.
 *
 * Three closes are correct and stay: deleting the organization, the explicit close control, and
 * dismissal by Escape or the backdrop - the last two now owned by `AppDialog`.
 */
import { ref, watch } from 'vue';
import { type Organization, type OrganizationRoleType } from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { fetchOrganizations } from '@/utils/organizations';
import AppDialog from '@/components/AppDialog.vue';
import DeleteOrgDialog from '@/components/DeleteOrgDialog.vue';

const props = defineProps<{
  manageOpen: boolean;
  org: Organization | null;
}>();

const emit = defineEmits<{
  manageClose: [];
  /** Something about this organization changed. Distinct from close, which means only closed. */
  changed: [];
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

/**
 * Re-read this organization so the dialog shows what it just did.
 *
 * A membership change answers with a message and no document, so there is nothing to merge; and
 * guessing the new membership locally would be a second copy of the server's rules about who may
 * hold which role.
 */
async function refreshOrg(): Promise<void> {
  const id = orgData.value?.id;
  if (!id) return;
  try {
    const mine = await fetchOrganizations();
    const found = mine.find((candidate) => candidate.id === id);
    if (found) orgData.value = found;
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Saved, but could not re-read the organization');
  }
}

/** Saved: show it here, and tell the list behind. Neither of those is closing. */
async function saved(): Promise<void> {
  await refreshOrg();
  emit('changed');
}

/**
 * The same control opens the form and cancels it, so it must not stay green once it says Cancel -
 * a primary fill is the product's word for "the thing to do here", and cancelling is not.
 *
 * Cancelling clears what was typed and any error: reopening should not hand back a rejected
 * address as though it were still being considered.
 */
function toggleAddAdmin() {
  showAddAdminForm.value = !showAddAdminForm.value;
  if (!showAddAdminForm.value) {
    newAdminEmail.value = '';
    addAdminError.value = '';
  }
}

function toggleAddMember() {
  showAddMemberForm.value = !showAddMemberForm.value;
  if (!showAddMemberForm.value) {
    newMemberEmail.value = '';
    addMemberError.value = '';
  }
}

async function handleRename() {
  if (!orgData.value || renameValue.value.trim() === orgData.value.name) return;
  renameError.value = '';
  try {
    await api.put(`/organizations/${encodeURIComponent(orgData.value.id)}`, {
      name: renameValue.value.trim(),
    });
    orgData.value = { ...orgData.value, name: renameValue.value.trim() };
    emit('changed');
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
    // The form stays open with an empty field: adding two people in a row is the case this story
    // is named after. A failure leaves the typed address exactly where it was.
    newAdminEmail.value = '';
    await saved();
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
    newMemberEmail.value = '';
    await saved();
  } catch (err) {
    addMemberError.value = getApiErrorMessage(err, 'Failed to add member');
  }
}

async function handleRemoveUser(userId: string) {
  if (!orgData.value) return;
  errorMessage.value = '';
  try {
    await api.delete(
      `/organizations/${encodeURIComponent(orgData.value.id)}/users/${encodeURIComponent(userId)}`,
    );
    await saved();
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to remove user');
  }
}

function canRemoveUser(userId: string, role: OrganizationRoleType): boolean {
  if (role === 'owner') return false;
  if (!isOwner()) return role === 'member';
  return true;
}

/**
 * One of the three correct closes: the thing being managed no longer exists.
 *
 * The confirmation is its own dialog now (E20/F04/S01), because what it has to say is not a
 * sentence: deleting an organization destroys its drafts and archived markets, and an archived
 * market is still publicly served and holds the record of a market that ran. "Are you sure? This
 * cannot be undone." was true and useless.
 */
function handleDeleted() {
  emit('changed');
  emit('manageClose');
}
</script>

<template>
  <AppDialog
    :open="manageOpen"
    title="Manage organization"
    testid="manage-org"
    wide
    :error="errorMessage"
    @close="emit('manageClose')"
  >
    <template v-if="orgData">
      <p class="org-name">{{ orgData.name }}</p>

      <div class="content">
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
              <span class="user-email" data-testid="manage-org-admin-email">{{ email }}</span>
              <span class="role-badge role-admin">Admin</span>
              <button
                v-if="isOwner() && canRemoveUser(orgData.admins![idx], 'admin')"
                type="button"
                class="btn btn--compact btn--destructive"
                title="Remove admin"
                data-testid="manage-org-remove-user-button"
                @click="handleRemoveUser(orgData.admins![idx])"
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
            type="button"
            class="btn btn--compact"
            :class="showAddAdminForm ? 'btn--secondary' : 'btn--primary'"
            data-testid="manage-org-add-admin-button"
            @click="toggleAddAdmin()"
          >
            {{ showAddAdminForm ? 'Cancel' : 'Add admin' }}
          </button>
          <!-- Its own form, so Enter in the field adds the admin through the very same handler. -->
          <form v-if="showAddAdminForm" class="add-user-form" @submit.prevent="handleAddAdmin">
            <div class="add-org-row">
              <input
                v-model="newAdminEmail"
                type="email"
                placeholder="User email"
                class="field"
                data-testid="manage-org-add-admin-input"
              />
              <button
                type="submit"
                class="btn btn--compact btn--primary"
                :disabled="!newAdminEmail.trim()"
                data-testid="manage-org-add-admin-submit"
              >
                Add
              </button>
            </div>
            <p v-if="addAdminError" class="form-error" data-testid="manage-org-add-admin-error">
              {{ addAdminError }}
            </p>
          </form>
        </section>

        <section v-if="canManage()" class="section">
          <h3>Members</h3>
          <div class="users-list">
            <div
              v-for="(email, idx) in orgData.memberEmails || []"
              :key="orgData.members?.[idx] ?? idx"
              class="user-card"
            >
              <span class="user-email" data-testid="manage-org-member-email">{{ email }}</span>
              <span class="role-badge role-member">Member</span>
              <button
                v-if="canRemoveUser(orgData.members![idx], 'member')"
                type="button"
                class="btn btn--compact btn--destructive"
                title="Remove member"
                data-testid="manage-org-remove-member-button"
                @click="handleRemoveUser(orgData.members![idx])"
              >
                Remove
              </button>
            </div>
            <p v-if="!orgData.memberEmails?.length && !showAddMemberForm" class="empty-state">
              No members
            </p>
          </div>
          <button
            type="button"
            class="btn btn--compact"
            :class="showAddMemberForm ? 'btn--secondary' : 'btn--primary'"
            data-testid="manage-org-add-member-button"
            @click="toggleAddMember()"
          >
            {{ showAddMemberForm ? 'Cancel' : 'Add member' }}
          </button>
          <form v-if="showAddMemberForm" class="add-user-form" @submit.prevent="handleAddMember">
            <div class="add-org-row">
              <input
                v-model="newMemberEmail"
                type="email"
                placeholder="User email"
                class="field"
                data-testid="manage-org-add-member-input"
              />
              <button
                type="submit"
                class="btn btn--compact btn--primary"
                :disabled="!newMemberEmail.trim()"
                data-testid="manage-org-add-member-submit"
              >
                Add
              </button>
            </div>
            <p v-if="addMemberError" class="form-error" data-testid="manage-org-add-member-error">
              {{ addMemberError }}
            </p>
          </form>
        </section>

        <section v-if="canManage()" class="section">
          <h3>Rename organization</h3>
          <form class="rename-row" @submit.prevent="handleRename">
            <input v-model="renameValue" class="field" data-testid="manage-org-rename-input" />
            <button
              type="submit"
              class="btn btn--compact btn--primary"
              :disabled="!renameValue.trim() || renameValue.trim() === orgData.name"
              data-testid="manage-org-rename-save-button"
            >
              Save
            </button>
          </form>
          <p v-if="renameError" class="form-error">{{ renameError }}</p>
        </section>

        <section v-if="isOwner()" class="section danger-section">
          <h3>Delete organization</h3>
          <button
            type="button"
            class="btn btn--compact btn--destructive"
            data-testid="manage-org-delete-button"
            @click="deleteConfirming = true"
          >
            Delete organization
          </button>
        </section>
      </div>
    </template>
  </AppDialog>

  <DeleteOrgDialog
    v-if="orgData"
    :open="deleteConfirming"
    :org-id="orgData.id"
    :org-name="orgData.name"
    @close="deleteConfirming = false"
    @deleted="handleDeleted()"
  />
</template>

<style scoped>
/* The scrim, window, close control and width belong to `AppDialog`; the buttons and fields to
   `primitives.css`. What is left here is this dialog's own list of people. */
.org-name {
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

.role-owner {
  background: rgba(26, 111, 139, 0.14);
  color: var(--mm-blue);
}

.role-admin {
  background: rgba(54, 130, 111, 0.16);
  color: var(--mm-text-green);
}

.role-member {
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

.danger-section {
  padding-top: var(--space-4);
  border-top: 1px solid var(--mm-border);
}
</style>
