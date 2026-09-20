<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { type Organization } from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { fetchOrganizations } from '@/utils/organizations';
import { getRoleDisplayName } from '@/utils/permissions';
import { useModalRoot } from '@/utils/useModalRoot';
import type { SummaryFact } from '@/utils/summary';
import SummaryCard from '@/components/SummaryCard.vue';
import ManageOrgOverlay from './ManageOrgOverlay.vue';

const organizations = ref<Organization[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const newOpen = ref(false);

/** Modal: the page behind it goes out of the tab order, not just out of reach of the mouse. */
const newOrgModalRoot = useModalRoot(newOpen);
const manageOpen = ref(false);
const manageOrg = ref<Organization | null>(null);
const newOrgName = ref('');
const newOrgError = ref('');

async function loadOrganizations() {
  loading.value = true;
  errorMessage.value = '';
  try {
    organizations.value = await fetchOrganizations();
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load organizations');
    organizations.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadOrganizations();
});

function factsFor(org: Organization): SummaryFact[] {
  return [
    { label: 'Markets', value: String(org.markets?.length ?? 0) },
    org.ownerEmail
      ? { label: 'Owner', value: org.ownerEmail }
      : { label: 'Owner', value: 'Not known', missing: true },
  ];
}

async function handleCreateOrg() {
  if (!newOrgName.value.trim()) return;
  newOrgError.value = '';
  try {
    await api.post('/organizations', { name: newOrgName.value.trim() });
    newOpen.value = false;
    newOrgName.value = '';
    await loadOrganizations();
  } catch (err) {
    newOrgError.value = getApiErrorMessage(err, 'Failed to create organization');
  }
}

function handleNewClose() {
  newOpen.value = false;
  newOrgName.value = '';
  newOrgError.value = '';
}

function handleManage(org: Organization) {
  manageOrg.value = org;
  manageOpen.value = true;
}

function handleManageClose() {
  manageOpen.value = false;
  manageOrg.value = null;
  loadOrganizations();
}

function canManage(org: Organization): boolean {
  const role = org.userRole;
  return role === 'owner' || role === 'admin';
}
</script>

<template>
  <div class="organizations-view">
    <div class="header">
      <h1>Organizations</h1>
      <button class="new-button" @click="newOpen = true" data-testid="organizations-create-button">
        New organization
      </button>
    </div>

    <div class="content-block">
      <p v-if="loading" class="empty-state">Loading organizations...</p>
      <p v-else-if="errorMessage" class="error-state">{{ errorMessage }}</p>
      <p v-else-if="organizations.length === 0" class="empty-state">No organizations found</p>
      <div v-else class="cards-container">
        <SummaryCard
          v-for="org in organizations"
          :key="org.id"
          :facts="factsFor(org)"
          data-testid="organization-card"
        >
          <template #name>
            <h3>{{ org.name }}</h3>
          </template>
          <template #badge>
            <span
              v-if="org.userRole"
              class="role-badge"
              :class="`role-${org.userRole}`"
              :title="`Your role in this organization`"
            >
              {{ getRoleDisplayName(org.userRole) }}
            </span>
          </template>
          <template #actions>
            <button
              v-if="canManage(org)"
              @click="handleManage(org)"
              class="manage-button"
              data-testid="organizations-manage-button"
            >
              Manage
            </button>
          </template>
        </SummaryCard>
      </div>
    </div>

    <ManageOrgOverlay :manageOpen="manageOpen" :org="manageOrg" @manageClose="handleManageClose" />

    <div v-if="newOpen" ref="newOrgModalRoot" class="overlay">
      <div
        class="overlay-background"
        @click="handleNewClose"
        data-testid="organizations-overlay-background"
      />
      <div class="overlay-window">
        <h2>New organization</h2>
        <div class="form-row">
          <input
            v-model="newOrgName"
            type="text"
            placeholder="Organization name"
            class="form-input"
            @keydown.enter="handleCreateOrg"
            data-testid="organizations-create-name-input"
          />
          <button
            class="submit-button"
            @click="handleCreateOrg"
            data-testid="organizations-create-submit-button"
          >
            Create
          </button>
        </div>
        <p v-if="newOrgError" class="form-error">{{ newOrgError }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* A list column of the list width, centred, growing to its content while the page scrolls
   (E16/F03). It was full-bleed, which is how a market name came to be capped at 320px inside an
   1840px row with 1,455px of the row left empty. */
.organizations-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--list-max);
  margin: 0 auto;
  padding: 32px 40px;
}

.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--mm-border);
}

.header h1 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--mm-black);
}

.new-button {
  padding: 10px 24px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 400;
  box-shadow: var(--shadow-card);
}

.new-button:hover {
  background: var(--mm-green);
  opacity: 0.9;
  box-shadow: var(--shadow-card);
}

.content-block {
  flex: 1;
  overflow-y: auto;
  padding-top: 24px;
}

.empty-state,
.error-state {
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.error-state {
  color: var(--mm-red);
}

.cards-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.role-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-control);
  font-weight: 400;
  font-size: var(--text-xs);
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

.manage-button {
  padding: 8px 20px;
  background: var(--mm-black);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 400;
  white-space: nowrap;
}

.manage-button:hover {
  opacity: 0.9;
}

.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
}

.overlay-background {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}

.overlay-window {
  position: relative;
  padding: 25px;
  background: white;
  border-radius: var(--radius-card);
  z-index: 1;
  min-width: 300px;
}

.overlay-window h2 {
  margin: 0 0 16px;
  font-size: var(--text-lg);
}

.form-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.form-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
}

.submit-button {
  padding: 8px 20px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: var(--text-sm);
}

.form-error {
  margin: 8px 0 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.content-block::-webkit-scrollbar {
  width: 8px;
}

.content-block::-webkit-scrollbar-track {
  background: var(--mm-beige);
  border-radius: var(--radius-control);
}

.content-block::-webkit-scrollbar-thumb {
  background: var(--mm-border);
  border-radius: var(--radius-control);
}
</style>
