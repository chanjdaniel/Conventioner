<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market, MarketRole } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { parseMarketFromApi, pathAfterLoadingMarket } from '@/utils/market';
import { getRoleDisplayName } from '@/utils/permissions';
import NewMarketOverlay from './NewMarketOverlay.vue';
import ManageMarketOverlay from './ManageMarketOverlay.vue';

const router = useRouter();
const markets = ref<Market[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const newOpen = ref(false);
const manageOpen = ref(false);
const manageMarket = ref<Market | null>(null);

async function fetchMarkets() {
    loading.value = true;
    errorMessage.value = '';
    try {
        const userEmail = JSON.parse(localStorage.getItem("user") || "null");
        const response = await api.get('/markets', {
            headers: {
                'X-Owner-Email': userEmail
            }
        });
        markets.value = (response.data.markets || []).map(parseMarketFromApi);
    } catch (err: any) {
        errorMessage.value = err.response?.data?.error || 'Failed to load markets';
        markets.value = [];
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    fetchMarkets();
});

function handleOpen(market: Market) {
    localStorage.removeItem("market");
    localStorage.setItem("market", JSON.stringify(market));
    router.push(pathAfterLoadingMarket(market));
}

function handleManage(market: Market) {
    manageMarket.value = market;
    manageOpen.value = true;
}

function handleManageClose() {
    manageOpen.value = false;
    manageMarket.value = null;
    fetchMarkets();
}

function canManage(userRole?: MarketRole): boolean {
    return userRole === MarketRole.Owner || userRole === MarketRole.Admin;
}

function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function handleNewClose() {
    newOpen.value = false;
    fetchMarkets();
}
</script>

<template>
    <div class="markets-view">
        <div class="header">
            <h1>Markets</h1>
            <button class="new-market-button" @click="newOpen = true">New market</button>
        </div>

        <div class="markets-block">
            <p v-if="loading" class="empty-state">Loading markets...</p>
            <p v-else-if="errorMessage" class="error-state">{{ errorMessage }}</p>
            <p v-else-if="markets.length === 0" class="empty-state">No markets found</p>
            <div v-else class="markets-container">
                <div v-for="market in markets" :key="market.id" class="market-card">
                    <div class="card-header">
                        <h3>{{ market.name }}</h3>
                    </div>
                    <div class="card-content">
                        <div class="info-group">
                            <div class="info-row">
                                <span class="info-label">Created:</span>
                                <span class="info-value">{{ formatDate(market.creationDate) }}</span>
                            </div>
                            <div v-if="market.organizationName" class="info-row">
                                <span class="info-label">Organization:</span>
                                <span class="info-value">{{ market.organizationName }}</span>
                            </div>
                            <div v-if="market.userRole" class="info-row">
                                <span class="info-label">Your role:</span>
                                <span class="info-value role-badge" :class="`role-${market.userRole.toLowerCase()}`">
                                    {{ getRoleDisplayName(market.userRole) }}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer">
                        <button @click="handleOpen(market)" class="open-button">Open</button>
                        <button v-if="canManage(market.userRole)" @click="handleManage(market)" class="manage-button">Manage</button>
                    </div>
                </div>
            </div>
        </div>

        <NewMarketOverlay @newClose="handleNewClose" :newOpen="newOpen" />
        <ManageMarketOverlay
            :manageOpen="manageOpen"
            :market="manageMarket"
            @manageClose="handleManageClose"
        />
    </div>
</template>

<style scoped>
.markets-view {
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

.new-market-button {
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

.new-market-button:hover {
    background: #3a9a82;
    box-shadow: 0 4px 8px rgba(73, 176, 150, 0.3);
}

.markets-block {
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

.markets-container {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.market-card {
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

.market-card:hover {
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
    display: flex;
    align-items: center;
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

.role-editor {
    background: #e8f5e9;
    color: #388e3c;
}

.role-viewer {
    background: #fff3e0;
    color: #f57c00;
}

.card-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

.open-button {
    padding: 8px 20px;
    background: var(--mm-green);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: 'Outfit Regular', sans-serif;
    box-shadow: 0 2px 4px rgba(73, 176, 150, 0.2);
    white-space: nowrap;
}

.open-button:hover {
    background: #3a9a82;
    box-shadow: 0 4px 8px rgba(73, 176, 150, 0.3);
    transform: translateY(-1px);
}

.manage-button {
    padding: 8px 20px;
    background: var(--mm-black);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    font-family: 'Outfit Regular', sans-serif;
    white-space: nowrap;
}

.manage-button:hover {
    opacity: 0.9;
}

/* Scrollbar styling */
.markets-block::-webkit-scrollbar {
    width: 8px;
}

.markets-block::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
}

.markets-block::-webkit-scrollbar-thumb {
    background: var(--mm-grey);
    border-radius: 4px;
}

.markets-block::-webkit-scrollbar-thumb:hover {
    background: #999;
}
</style>
