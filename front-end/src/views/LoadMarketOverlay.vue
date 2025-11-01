<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes.ts'
import { api } from '@/utils/api';

defineProps<{
    loadOpen: boolean;
}>();

const router = useRouter();
const markets = ref<Market[]>([]);
const next = ref(false);

onMounted(async () => {
    const userEmail = JSON.parse(localStorage.getItem("user") || "null");
    const response = await api.get('/markets', {
        headers: {
            'X-Owner-Email': userEmail
        }
    });

    for (const market of response.data.markets) {
        let newMarket: Market = {
            name: market.name,
            owner: market.owner,
            creationDate: market.creationDate,
            editors: market.editors || [],
            viewers: market.viewers || [],
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
                    maxAssignmentsPerVendor: market.setupObject?.assignmentOptions?.maxAssignmentsPerVendor || null,
                    maxHalfTableProportionPerSection: market.setupObject?.assignmentOptions?.maxHalfTableProportionPerSection || null,
                },
            },
            modificationList: market.modificationList || [],
            assignmentObject: market.assignmentObject || {
                vendorAssignments: [],
                assignmentDate: "",
                totalVendorsAssigned: 0,
                totalTablesAssigned: 0,
                assignmentStatistics: null,
            },
        };
        markets.value.push(newMarket);
    }
});

const handleLoadMarket = async (market: Market) => {
    localStorage.removeItem("market");
    localStorage.setItem("market", JSON.stringify(market));
    router.push('/market-setup');
}

const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}
</script>

<template>
    <div class="container" :style="{ visibility: loadOpen ? 'visible' : 'hidden' }">
        <div class="background" @click="$emit('loadClose')" :style="{ opacity: loadOpen ? '100%' : '0%' }">
        </div>
        <div class="window">
            <div class="header">
                <h2>Load Market</h2>
                <p v-if="markets.length === 0" class="empty-state">No markets found</p>
            </div>
            <div class="markets-container">
                <div v-for="market in markets" :key="market.name" class="market-card">
                    <div class="card-header">
                        <h3>{{ market.name }}</h3>
                    </div>
                    <div class="card-content">
                        <div class="info-group">
                            <div class="info-row">
                                <span class="info-label">Owner:</span>
                                <span class="info-value">{{ market.owner }}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Created:</span>
                                <span class="info-value">{{ formatDate(market.creationDate) }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer">
                        <button @click="handleLoadMarket(market)" class="load-button">Load Market</button>
                    </div>
                </div>
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
    max-width: 900px;
    height: 85%;
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

.empty-state {
    margin-top: 12px;
    color: #666;
    font-size: 14px;
}

.markets-container {
    flex: 1;
    overflow-y: auto;
    padding: 24px 40px 32px;
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

.card-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
}

.load-button {
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

.load-button:hover {
    background: #3a9a82;
    box-shadow: 0 4px 8px rgba(73, 176, 150, 0.3);
    transform: translateY(-1px);
}

.load-button:active {
    transform: translateY(0);
    box-shadow: 0 2px 4px rgba(73, 176, 150, 0.2);
}

/* Scrollbar styling */
.markets-container::-webkit-scrollbar {
    width: 8px;
}

.markets-container::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
}

.markets-container::-webkit-scrollbar-thumb {
    background: var(--mm-grey);
    border-radius: 4px;
}

.markets-container::-webkit-scrollbar-thumb:hover {
    background: #999;
}
</style>
