<script setup lang="ts">
import { ref, watch } from 'vue';
import { type Market, MarketRole } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { getRoleDisplayName, canManageRoles, canChangeRole, getRolesForChange } from '@/utils/permissions';

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
    { immediate: true }
);

async function fetchMarket(showLoading = true) {
    if (!marketData.value) return;
    if (showLoading) loading.value = true;
    errorMessage.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        const response = await api.get(`/markets/${encodeURIComponent(marketData.value.id)}`, {
            headers: { 'X-Owner-Email': userEmail },
        });
        const m = response.data.market;
        marketData.value = parseMarketFromApi(m);
        renameValue.value = marketData.value.name;
    } catch (err: any) {
        errorMessage.value = err.response?.data?.error || 'Failed to load market';
    } finally {
        if (showLoading) loading.value = false;
    }
}

function parseMarketFromApi(market: any): Market {
    const userRoleRaw = market.userRole ?? market.user_role;
    const creationDate = market.creationDate ?? market.creation_date;
    const rolesRaw = market.roles || {};
    const roles: Record<string, MarketRole> = {};
    for (const [userId, role] of Object.entries(rolesRaw)) {
        const r = String(role).toLowerCase();
        if (r === 'owner' || r === 'admin' || r === 'editor' || r === 'viewer') {
            roles[userId] = r as MarketRole;
        }
    }
    const roleEmails = market.roleEmails ?? market.role_emails ?? {};
    return {
        id: market.id,
        name: market.name,
        creationDate: creationDate,
        roles,
        roleEmails,
        organizationId: market.organizationId ?? market.organization_id ?? undefined,
        organizationName: market.organizationName ?? market.organization_name ?? market.organization,
        theme: market.theme,
        userRole: userRoleRaw ? (userRoleRaw as MarketRole) : undefined,
        setupObject: {
            colNames: market.setupObject?.colNames || [],
            colValues: market.setupObject?.colValues || [],
            colInclude: market.setupObject?.colInclude || [],
            enumPriorityOrder: market.setupObject?.enumPriorityOrder || [],
            priority: market.setupObject?.priority || [],
            marketDates: market.setupObject?.marketDates || [],
            tiers: market.setupObject?.tiers || [],
            locations: market.setupObject?.locations || [],
            sections: market.setupObject?.sections || [],
            assignmentOptions: {
                maxAssignmentsPerVendor: market.setupObject?.assignmentOptions?.maxAssignmentsPerVendor ?? null,
                maxHalfTableProportionPerSection: market.setupObject?.assignmentOptions?.maxHalfTableProportionPerSection ?? null,
            },
        },
        modificationList: market.modificationList || [],
        assignmentObject: market.assignmentObject || {
            vendorAssignments: [],
            assignmentDate: '',
            totalVendorsAssigned: 0,
            totalTablesAssigned: 0,
            assignmentStatistics: null,
        },
    };
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
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        const response = await api.get('/organizations', {
            headers: { 'X-Owner-Email': userEmail },
        });
        userOrgs.value = response.data.organizations || [];
    } catch {
        userOrgs.value = [];
    }
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
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        await api.post(
            `/markets/${encodeURIComponent(marketData.value.name)}/roles`,
            { user_email: newUserEmail.value.trim(), role: newUserRole.value },
            { headers: { 'X-Owner-Email': userEmail } }
        );
        showAddUserForm.value = false;
        newUserEmail.value = '';
        newUserRole.value = MarketRole.Editor;
        await fetchMarket(false);
    } catch (err: any) {
        addUserError.value = err.response?.data?.error || 'Failed to add user';
    }
}

async function handleRemoveUser(userId: string) {
    if (!marketData.value) return;
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        await api.delete(
            `/markets/${encodeURIComponent(marketData.value.id)}/roles/${encodeURIComponent(userId)}`,
            { headers: { 'X-Owner-Email': userEmail } }
        );
        await fetchMarket(false);
    } catch (err: any) {
        errorMessage.value = err.response?.data?.error || 'Failed to remove user';
    }
}

async function handleRoleChange(userId: string, newRole: MarketRole) {
    if (!marketData.value) return;
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        await api.put(
            `/markets/${encodeURIComponent(marketData.value.id)}/roles/${encodeURIComponent(userId)}`,
            { role: newRole },
            { headers: { 'X-Owner-Email': userEmail } }
        );
        await fetchMarket(false);
    } catch (err: any) {
        errorMessage.value = err.response?.data?.error || 'Failed to update role';
    }
}

async function handleAddOrg() {
    if (!marketData.value || !newOrgName.value.trim()) return;
    addOrgError.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        const org = userOrgs.value.find((o) => o.name === newOrgName.value.trim());
        const orgId = org?.id ?? newOrgName.value.trim();
        const updated = { ...marketData.value, organizationId: orgId };
        await api.put(`/markets/${encodeURIComponent(marketData.value.id)}`, updated, {
            headers: { 'X-Owner-Email': userEmail },
        });
        marketData.value = { ...marketData.value, organizationId: orgId, organizationName: org?.name ?? newOrgName.value.trim() };
        showAddOrgForm.value = false;
        newOrgName.value = '';
        await fetchMarket(false);
    } catch (err: any) {
        addOrgError.value = err.response?.data?.error || 'Failed to add organization';
    }
}

async function handleRemoveOrg() {
    if (!marketData.value) return;
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        const updated = { ...marketData.value, organizationId: null };
        await api.put(`/markets/${encodeURIComponent(marketData.value.id)}`, updated, {
            headers: { 'X-Owner-Email': userEmail },
        });
        marketData.value = { ...marketData.value, organizationId: undefined, organizationName: undefined };
        await fetchMarket(false);
    } catch (err: any) {
        errorMessage.value = err.response?.data?.error || 'Failed to remove organization';
    }
}

function canRemoveOrg(): boolean {
    const userRole = marketData.value?.userRole;
    if (!userRole) return false;
    return userRole === MarketRole.Owner || userRole === MarketRole.Admin;
}

async function handleRename() {
    if (!marketData.value || renameValue.value.trim() === marketData.value.name) return;
    renameError.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        const updated = { ...marketData.value, name: renameValue.value.trim() };
        await api.put(`/markets/${encodeURIComponent(marketData.value.id)}`, updated, {
            headers: { 'X-Owner-Email': userEmail },
        });
        marketData.value = { ...marketData.value, name: renameValue.value.trim() };
    } catch (err: any) {
        const msg = err.response?.data?.error || '';
        renameError.value = msg.toLowerCase().includes('already exists') ? 'A market with this name already exists' : msg || 'Failed to rename';
    }
}

async function handleDeleteConfirm() {
    if (!marketData.value) return;
    deleteError.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
        await api.delete(`/markets/${encodeURIComponent(marketData.value.id)}`, {
            headers: { 'X-Owner-Email': userEmail },
        });
        emit('manageClose');
    } catch (err: any) {
        deleteError.value = err.response?.data?.error || 'Failed to delete market';
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
        <div class="background" @click="handleClose" :style="{ opacity: manageOpen ? '100%' : '0%' }" />
        <div v-if="manageOpen && market" class="window">
            <div class="header">
                <h2>Manage market</h2>
                <p v-if="marketData" class="market-name">{{ marketData.name }}</p>
                <p v-if="errorMessage" class="error-state">{{ errorMessage }}</p>
            </div>
            <div v-if="loading" class="loading-state">Loading...</div>
            <div v-else-if="marketData" class="content">
                <section class="section">
                    <h3>Users with access</h3>
                    <div class="users-list">
                        <div
                            v-for="{ userId, email, role } in getUserList()"
                            :key="userId"
                            class="user-card"
                        >
                            <span class="user-email">{{ email }}</span>
                            <span
                                v-if="!marketData?.userRole || !canChangeRole(marketData.userRole, role)"
                                class="role-badge"
                                :class="`role-${(role as string).toLowerCase()}`"
                            >
                                {{ getRoleDisplayName(role) }}
                            </span>
                            <span
                                v-else
                                class="role-badge role-badge-dropdown"
                                :class="`role-${(role as string).toLowerCase()}`"
                            >
                                <select
                                    :value="role"
                                    class="role-select"
                                    @change="handleRoleChange(userId, ($event.target as HTMLSelectElement).value as MarketRole)"
                                >
                                    <option :value="role">{{ getRoleDisplayName(role) }}</option>
                                    <option
                                        v-for="r in getRolesForChange(role, marketData!.userRole!)"
                                        :key="r"
                                        :value="r"
                                    >
                                        {{ getRoleDisplayName(r) }}
                                    </option>
                                </select>
                                <span class="role-chevron">▼</span>
                            </span>
                            <button
                                v-if="canRemoveUser(role)"
                                class="remove-button"
                                @click="handleRemoveUser(userId)"
                                title="Remove user"
                            >
                                Remove
                            </button>
                        </div>
                        <p v-if="getUserList().length === 0" class="empty-state">No users with explicit access</p>
                    </div>
                    <button class="add-user-button" @click="showAddUserForm = !showAddUserForm">
                        {{ showAddUserForm ? 'Cancel' : 'Add user' }}
                    </button>
                    <div v-if="showAddUserForm" class="add-user-form">
                        <div class="add-org-row">
                            <input
                                v-model="newUserEmail"
                                type="email"
                                placeholder="User email"
                                class="form-input"
                            />
                            <select v-model="newUserRole" class="form-select">
                                <option v-for="r in addableRoles" :key="r" :value="r">
                                    {{ getRoleDisplayName(r) }}
                                </option>
                            </select>
                            <button class="submit-button" @click="handleAddUser">Add</button>
                        </div>
                        <p v-if="addUserError" class="form-error">{{ addUserError }}</p>
                    </div>
                </section>

                <section class="section">
                    <h3>Organizations with access</h3>
                    <div class="users-list">
                        <div
                            v-for="orgName in getOrganizationList()"
                            :key="orgName"
                            class="user-card"
                        >
                            <span class="user-email">{{ orgName }}</span>
                            <span class="role-badge role-viewer">Viewer</span>
                            <button
                                v-if="canRemoveOrg()"
                                class="remove-button"
                                @click="handleRemoveOrg()"
                                title="Remove organization"
                            >
                                Remove
                            </button>
                        </div>
                        <p v-if="getOrganizationList().length === 0" class="empty-state">No organizations with access</p>
                    </div>
                    <button
                        class="add-user-button"
                        @click="showAddOrgForm = !showAddOrgForm; if (showAddOrgForm) fetchUserOrgs()"
                    >
                        {{ showAddOrgForm ? 'Cancel' : 'Add organization' }}
                    </button>
                    <div v-if="showAddOrgForm" class="add-user-form">
                        <div class="add-org-row">
                            <select
                                v-model="newOrgName"
                                class="form-select"
                                :disabled="getAvailableOrgsForAdd().length === 0"
                            >
                                <option value="">Select organization</option>
                                <option
                                    v-for="org in getAvailableOrgsForAdd()"
                                    :key="org.name"
                                    :value="org.name"
                                >
                                    {{ org.name }}
                                </option>
                            </select>
                            <button
                                class="submit-button"
                                @click="handleAddOrg"
                                :disabled="!newOrgName.trim()"
                            >
                                Add
                            </button>
                        </div>
                        <p v-if="getAvailableOrgsForAdd().length === 0 && getOrganizationList().length > 0" class="form-hint">All your organizations already have access</p>
                        <p v-else-if="getAvailableOrgsForAdd().length === 0" class="form-hint">Create an organization first</p>
                        <p v-if="addOrgError" class="form-error">{{ addOrgError }}</p>
                    </div>
                </section>

                <section class="section">
                    <h3>Rename market</h3>
                    <div class="rename-row">
                        <input v-model="renameValue" class="form-input rename-input" />
                        <button class="save-button" @click="handleRename">Save</button>
                    </div>
                    <p v-if="renameError" class="form-error">{{ renameError }}</p>
                </section>

                <section class="section danger-section">
                    <h3>Delete market</h3>
                    <div v-if="!deleteConfirming">
                        <button class="delete-button" @click="deleteConfirming = true">
                            Delete market
                        </button>
                    </div>
                    <div v-else class="delete-confirm">
                        <p class="confirm-text">Are you sure? This cannot be undone.</p>
                        <div class="confirm-buttons">
                            <button class="confirm-delete-button" @click="handleDeleteConfirm">
                                Confirm
                            </button>
                            <button class="cancel-button" @click="handleDeleteCancel">Cancel</button>
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
    transition: opacity 0.15s ease-in-out, visibility 0.15s ease-in-out;
    z-index: 0;
}

.window {
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

.market-name {
    margin: 8px 0 0;
    color: #666;
    font-size: 14px;
}

.error-state {
    margin-top: 12px;
    color: #d32f2f;
    font-size: 14px;
}

.loading-state {
    padding: 40px;
    text-align: center;
    color: #666;
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

.role-badge-dropdown {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding-right: 4px;
    cursor: pointer;
}

.role-select {
    appearance: none;
    background: transparent;
    border: none;
    outline: none;
    font: inherit;
    font-weight: 500;
    font-size: 12px;
    color: inherit;
    cursor: pointer;
    padding: 0;
    margin: 0;
}

.role-select:focus {
    outline: none;
    border: none;
    box-shadow: none;
}

.role-select option {
    color: black;
    padding: 0 4px;
    text-align: center;
}

.role-chevron {
    font-size: 8px;
    opacity: 0.8;
}

.role-owner {
    background: #e3f2fd;
    color: #1976d2;
}

.role-admin {
    background: #f3e5f5;
    color: #7b1fa2;
}

.role-editor {
    background: #e8f5e9;
    color: #388e3c;
}

.role-viewer {
    background: #fff3e0;
    color: #f57c00;
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
    padding: 8px 12px;
    border: 1.5px solid var(--mm-grey);
    border-radius: 6px;
    font-size: 14px;
    font-family: 'Outfit Regular', sans-serif;
    min-width: 180px;
}

.form-select {
    padding: 8px 12px;
    border: 1.5px solid var(--mm-grey);
    border-radius: 6px;
    font-size: 14px;
    font-family: 'Outfit Regular', sans-serif;
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

.form-hint {
    margin: 8px 0 0;
    color: #666;
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
