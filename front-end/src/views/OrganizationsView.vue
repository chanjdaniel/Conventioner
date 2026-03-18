<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { type Organization } from '@/assets/types/datatypes';
import { api } from '@/utils/api';

const organizations = ref<Organization[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const newOpen = ref(false);
const newOrgName = ref('');
const newOrgError = ref('');

function parseOrgFromApi(org: any): Organization {
    return {
        id: org.id,
        name: org.name,
        owner: org.owner,
        admins: org.admins || [],
        members: org.members || [],
        markets: org.markets || [],
        ownerEmail: org.ownerEmail ?? org.owner_email,
        adminEmails: org.adminEmails ?? org.admin_emails,
        memberEmails: org.memberEmails ?? org.member_emails,
        theme: org.theme,
    };
}

async function fetchOrganizations() {
    loading.value = true;
    errorMessage.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem("user") || "null");
        const response = await api.get('/organizations', {
            headers: { 'X-Owner-Email': userEmail },
        });
        organizations.value = (response.data.organizations || []).map(parseOrgFromApi);
    } catch (err: any) {
        errorMessage.value = err.response?.data?.error || 'Failed to load organizations';
        organizations.value = [];
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    fetchOrganizations();
});

async function handleCreateOrg() {
    if (!newOrgName.value.trim()) return;
    newOrgError.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem("user") || "null");
        await api.post('/organizations', { name: newOrgName.value.trim() }, {
            headers: { 'X-Owner-Email': userEmail },
        });
        newOpen.value = false;
        newOrgName.value = '';
        await fetchOrganizations();
    } catch (err: any) {
        newOrgError.value = err.response?.data?.error || 'Failed to create organization';
    }
}

function handleNewClose() {
    newOpen.value = false;
    newOrgName.value = '';
    newOrgError.value = '';
}
</script>

<template>
    <div class="organizations-view">
        <div class="header">
            <h1>Organizations</h1>
            <button class="new-button" @click="newOpen = true">New organization</button>
        </div>

        <div class="content-block">
            <p v-if="loading" class="empty-state">Loading organizations...</p>
            <p v-else-if="errorMessage" class="error-state">{{ errorMessage }}</p>
            <p v-else-if="organizations.length === 0" class="empty-state">No organizations found</p>
            <div v-else class="cards-container">
                <div v-for="org in organizations" :key="org.id" class="org-card">
                    <div class="card-header">
                        <h3>{{ org.name }}</h3>
                    </div>
                    <div class="card-content">
                        <div class="info-group">
                            <div class="info-row">
                                <span class="info-label">Markets:</span>
                                <span class="info-value">{{ org.markets?.length ?? 0 }}</span>
                            </div>
                            <div v-if="org.ownerEmail" class="info-row">
                                <span class="info-label">Owner:</span>
                                <span class="info-value">{{ org.ownerEmail }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="newOpen" class="overlay">
            <div class="overlay-background" @click="handleNewClose" />
            <div class="overlay-window">
                <h2>New organization</h2>
                <div class="form-row">
                    <input
                        v-model="newOrgName"
                        type="text"
                        placeholder="Organization name"
                        class="form-input"
                        @keydown.enter="handleCreateOrg"
                    />
                    <button class="submit-button" @click="handleCreateOrg">Create</button>
                </div>
                <p v-if="newOrgError" class="form-error">{{ newOrgError }}</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
.organizations-view {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    padding: 32px 40px;
    overflow: hidden;
}

.header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--mm-grey);
}

.header h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
    color: var(--mm-black);
    font-family: 'Outfit Regular', sans-serif;
}

.new-button {
    padding: 10px 24px;
    background: var(--mm-green);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: 'Outfit Regular', sans-serif;
    box-shadow: 0 2px 4px rgba(73, 176, 150, 0.2);
}

.new-button:hover {
    background: #3a9a82;
    box-shadow: 0 4px 8px rgba(73, 176, 150, 0.3);
}

.content-block {
    flex: 1;
    overflow-y: auto;
    padding-top: 24px;
}

.empty-state,
.error-state {
    color: #666;
    font-size: 14px;
}

.error-state {
    color: #d32f2f;
}

.cards-container {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.org-card {
    width: 100%;
    padding: 16px 24px;
    border: 1.5px solid var(--mm-grey);
    border-radius: 10px;
    background: white;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 24px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.org-card:hover {
    border-color: var(--mm-green);
    box-shadow: 0 4px 12px rgba(73, 176, 150, 0.15);
    transform: translateY(-2px);
}

.card-header {
    flex-shrink: 0;
    min-width: 200px;
}

.card-header h3 {
    margin: 0;
    color: var(--mm-black);
    font-size: 18px;
    font-weight: 600;
    font-family: 'Outfit Regular', sans-serif;
}

.card-content {
    flex: 1;
}

.info-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.info-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
}

.info-label {
    font-weight: 500;
    color: #666;
    font-size: 13px;
    min-width: 70px;
}

.info-value {
    color: var(--mm-black);
    font-size: 14px;
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
    border-radius: 8px;
    z-index: 1;
    min-width: 300px;
}

.overlay-window h2 {
    margin: 0 0 16px;
    font-size: 20px;
}

.form-row {
    display: flex;
    gap: 12px;
    align-items: center;
}

.form-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--mm-grey);
    border-radius: 6px;
    font-size: 14px;
}

.submit-button {
    padding: 8px 20px;
    background: var(--mm-green);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
}

.form-error {
    margin: 8px 0 0;
    color: #d32f2f;
    font-size: 13px;
}

.content-block::-webkit-scrollbar {
    width: 8px;
}

.content-block::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
}

.content-block::-webkit-scrollbar-thumb {
    background: var(--mm-grey);
    border-radius: 4px;
}
</style>
