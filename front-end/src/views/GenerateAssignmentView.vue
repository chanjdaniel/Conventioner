<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';

import { type AssignmentStatistics } from '@/assets/types/datatypes';

const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

const assignmentStatistics = ref<AssignmentStatistics | null>(null);

const processedTableChoices = computed(() => {
    if (!assignmentStatistics.value?.assignmentsPerTableChoice) {
        return {};
    }
    
    const choices = assignmentStatistics.value.assignmentsPerTableChoice;
    const processed: Record<string, number> = {};
    let halfTableTotal = 0;
    let halfTableLabel = '';
    
    for (const [choice, count] of Object.entries(choices)) {
        if (choice.toLowerCase().includes('half')) {
            halfTableTotal += count;
            // Use the first half table label found, or create a generic one
            if (!halfTableLabel) {
                halfTableLabel = 'Half table';
            }
        } else {
            processed[choice] = count;
        }
    }
    
    // Add combined half table entry if any were found
    if (halfTableTotal > 0) {
        processed[halfTableLabel] = halfTableTotal;
    }
    
    return processed;
});

onMounted(() => {
    const market = JSON.parse(localStorage.getItem("market") || "null");
    if (market && market["assignmentObject"] && market["assignmentObject"]["assignmentStatistics"]) {
        assignmentStatistics.value = market["assignmentObject"]["assignmentStatistics"];
    }
});

const handleBack = () => {
    router.push("/market-setup");
}
const handleDone = () => {
    router.push("");
}

</script>

<template>
    <div class="generate-assignment-view">
        <div class="generate-assignment-window">
            <div class="generate-assignment-container">
                <div class="generate-assignment-header">
                    <h1>Generated Assignment</h1>
                </div>
                <div class="generate-assignment-body">
                    <div v-if="assignmentStatistics" class="statistics-container">
                        <!-- Total Summary Cards -->
                        <div class="stat-card summary-card">
                            <h3>Total Summary</h3>
                            <div class="stat-row">
                                <div class="stat-item">
                                    <span class="stat-label">Total Vendors</span>
                                    <span class="stat-value">{{ assignmentStatistics.totalVendors }}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Total Tables</span>
                                    <span class="stat-value">{{ assignmentStatistics.totalTables }}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Assignments Per Date -->
                        <div class="stat-card">
                            <h3>Per Date</h3>
                            <div class="stat-list">
                                <div 
                                    v-for="(count, date) in assignmentStatistics.assignmentsPerDate" 
                                    :key="date" 
                                    class="stat-list-item"
                                >
                                    <span class="stat-list-label">{{ date }}</span>
                                    <span class="stat-list-value">{{ count }}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Assignments Per Section -->
                        <div class="stat-card">
                            <h3>Per Section</h3>
                            <div class="stat-list">
                                <div 
                                    v-for="(count, section) in assignmentStatistics.assignmentsPerSection" 
                                    :key="section" 
                                    class="stat-list-item"
                                >
                                    <span class="stat-list-label">Section {{ section }}</span>
                                    <span class="stat-list-value">{{ count }}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Assignments Per Tier -->
                        <div class="stat-card">
                            <h3>Per Tier</h3>
                            <div class="stat-list">
                                <div 
                                    v-for="(count, tier) in assignmentStatistics.assignmentsPerTier" 
                                    :key="tier" 
                                    class="stat-list-item"
                                >
                                    <span class="stat-list-label">{{ tier }}</span>
                                    <span class="stat-list-value">{{ count }}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Assignments Per Table Choice -->
                        <div v-if="assignmentStatistics.assignmentsPerTableChoice" class="stat-card">
                            <h3>Per Table Choice</h3>
                            <div class="stat-list">
                                <div 
                                    v-for="(count, choice) in processedTableChoices" 
                                    :key="choice" 
                                    class="stat-list-item"
                                >
                                    <span class="stat-list-label">{{ choice }}</span>
                                    <span class="stat-list-value">{{ count }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="no-data-message">
                        <p>No assignment statistics available.</p>
                    </div>
                </div>
            </div>
            <div style="width: 100%; display: flex; flex-direction: row; justify-content: space-between;">
                <div>
                    <button class="done-button" @click="handleBack">Back</button>
                </div>
                <div>
                    <button class="done-button" @click="handleDone">Done</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.generate-assignment-view {
    width: 100%;
    min-width: 1000px;
    flex: 1;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.generate-assignment-window {
    width: 80%;
    height: 80%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.generate-assignment-container {
    align-self: stretch;
    flex: 1;
    background-color: white;
    box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
}

.generate-assignment-header {
    align-self: stretch;
    height: 50px;
    background-color: var(--mm-black);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
}

.generate-assignment-body {
    align-self: stretch;
    flex-grow: 1;
    padding: 30px;
    min-height: 0;
    flex: 1;
    overflow-y: auto;
}

.statistics-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 25px;
    width: 100%;
}

.stat-card {
    background-color: var(--mm-beige);
    border-radius: 10px;
    padding: 20px;
    box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.summary-card {
    grid-column: 1 / -1;
    background: linear-gradient(135deg, var(--mm-green) 0%, #3a9d82 100%);
}

.summary-card h3,
.summary-card .stat-label,
.summary-card .stat-value {
    color: white;
}

.stat-card h3 {
    font-family: 'Merge One';
    font-size: 22px;
    color: var(--mm-black);
    margin: 0;
    border-bottom: 2px solid var(--mm-grey);
    padding-bottom: 10px;
}

.stat-row {
    display: flex;
    flex-direction: row;
    gap: 30px;
    justify-content: space-around;
}

.stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.stat-label {
    font-family: 'Outfit Regular';
    font-size: 16px;
    color: var(--mm-black);
    opacity: 0.8;
}

.stat-value {
    font-family: 'Merge One';
    font-size: 36px;
    font-weight: bold;
    color: var(--mm-green);
}

.stat-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.stat-list-item {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    background-color: white;
    border-radius: 6px;
    border-left: 4px solid var(--mm-green);
    transition: transform 0.2s, box-shadow 0.2s;
}

.stat-list-item:hover {
    transform: translateX(5px);
    box-shadow: 0px 2px 6px rgba(0, 0, 0, 0.15);
}

.stat-list-label {
    font-family: 'Outfit Regular';
    font-size: 15px;
    color: var(--mm-black);
}

.stat-list-value {
    font-family: 'Merge One';
    font-size: 20px;
    font-weight: bold;
    color: var(--mm-green);
    background-color: var(--mm-beige);
    padding: 5px 15px;
    border-radius: 20px;
    min-width: 50px;
    text-align: center;
}

.no-data-message {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-family: 'Outfit Regular';
    font-size: 18px;
    color: var(--mm-grey);
}

h1 {
    font-family: 'Outfit Regular';
    text-align: center;
    font-size: 30px;
    color: white;
}

h2 {
    font-family: 'Merge One';
    text-align: left;
    font-size: 26px;
    color: white;
}

.done-button {
    margin-top: 15px;
    width: 100px;
    height: 35px;

    background: var(--mm-green);
    border-radius: 5px;
    border: none;

    font-family: 'Merge One';
    font-style: normal;
    font-weight: 400;
    font-size: 20px;
    line-height: 15px;
    text-align: center;

    color: #FFFFFF;
}
</style>