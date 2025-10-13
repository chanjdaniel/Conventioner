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
                    MAX_ASSIGNMENTS_PER_VENDOR: market.setupObject?.assignmentOptions?.maxAssignmentsPerVendor || null,
                    MAX_HALF_TABLE_PROPORTION_PER_SECTION: market.setupObject?.assignmentOptions?.maxHalfTableProportionPerSection || null,
                },
            },
            modificationList: market.modificationList || [],
            assignmentObject: market.assignmentObject || {},
        };
        markets.value.push(newMarket);
    }
});

const handleLoadMarket = async (market: Market) => {
    localStorage.removeItem("market");
    localStorage.setItem("market", JSON.stringify(market));
    router.push('/market-setup');
}
</script>

<template>
    <div class="container" :style="{ visibility: loadOpen ? 'visible' : 'hidden' }">
        <div class="background" @click="$emit('loadClose')" :style="{ opacity: loadOpen ? '100%' : '0%' }">
        </div>
        <div class="window">
            <h2>Load Market</h2>
            <div class="markets-container">
                <div v-for="market in markets" :key="market.name" class="market-card">
                    <h3>{{ market.name }}</h3>
                    <p><strong>Owner:</strong> {{ market.owner }}</p>
                    <p><strong>Created:</strong> {{ new Date(market.creationDate).toLocaleDateString() }}</p>
                    <button @click="handleLoadMarket(market)" class="load-button">Load</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
h3 {
    display: inline;
}

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
    width: 60%;
    height: 80%;
    gap: 20px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    background: white;
    border-radius: 8px;
    z-index: 1;
    padding: 20px;
    overflow-y: auto;
}

.markets-container {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 15px;
    align-items: center;
}

.market-card {
    width: 100%;
    max-width: 400px;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #f9f9f9;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.market-card h3 {
    margin: 0;
    color: #333;
    font-size: 18px;
}

.market-card p {
    margin: 0;
    color: #666;
    font-size: 14px;
}

.load-button {
    margin-top: 10px;
    padding: 8px 16px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    align-self: flex-start;
}

.load-button:hover {
    background: #0056b3;
}

.text-input-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    border-radius: 8px;
}
</style>
