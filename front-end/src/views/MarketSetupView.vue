<script setup lang="ts">
import { computed, onMounted, reactive, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import ElementSetupColumns from '@/components/elements/ElementSetupColumns.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import ElementAssignmentPriority from '@/components/elements/ElementAssignmentPriority.vue';
import ElementAssignmentOptions from '@/components/elements/ElementAssignmentOptions.vue';
import ElementTierSetup from '@/components/elements/ElementTierSetup.vue';
import ElementLocationSetup from '@/components/elements/ElementLocationSetup.vue';
import ElementSectionSetup from '@/components/elements/ElementSectionSetup.vue';
import ChoosePathOverlay from '@/components/floorplan/ChoosePathOverlay.vue';
import { type SetupObject, type Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';

const router = useRouter();

const settingsBodyHeight = ref(null);
const showPathChoice = ref(false);

const market = ref<Market | null>(null);
const setupObject = reactive<SetupObject>({
    colNames: [],
    colValues: [],
    colInclude: [],
    enumPriorityOrder: [],
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: {
        maxAssignmentsPerVendor: null,
        maxHalfTableProportionPerSection: null,
        emailColNameIdx: null,
        tableChoiceColNameIdx: null,
        tableShareEmailColNameIdx: null,
        maxDaysColNameIdx: null,
    },
});

const pageIdx = ref(0);
const maxPageIdx = 2;

function parseFiniteInt(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
    return Number.isFinite(n) ? Math.floor(n) : null;
}

function parseFiniteNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** True when required Assignment Options are set (Assign enabled). Max days column mapping is optional. */
const assignmentOptionsComplete = computed(() => {
    const ao = setupObject.assignmentOptions;
    const numCols = setupObject.colNames.length;
    const numMarketDates = setupObject.marketDates.length;

    const maxPer = parseFiniteInt(ao.maxAssignmentsPerVendor);
    if (maxPer === null || maxPer < 1) return false;
    if (numMarketDates > 0 && maxPer > numMarketDates) return false;

    const halfProp = parseFiniteNumber(ao.maxHalfTableProportionPerSection);
    if (halfProp === null || halfProp < 0 || halfProp > 100) return false;

    const idxValid = (idx: number | null | undefined) =>
        idx !== null &&
        idx !== undefined &&
        Number.isInteger(idx) &&
        idx >= 0 &&
        numCols > 0 &&
        idx < numCols;

    if (!idxValid(ao.emailColNameIdx)) return false;
    if (!idxValid(ao.tableChoiceColNameIdx)) return false;
    if (!idxValid(ao.tableShareEmailColNameIdx)) return false;
    // maxDaysColNameIdx optional: null = backend applies no per-vendor max-days cap from CSV

    return true;
});

onMounted(() => {
    // create setup object

    market.value = JSON.parse(localStorage.getItem("market") || "null");
    if (market.value && market.value.setupObject) {
        Object.assign(setupObject, market.value.setupObject);

    } else {
        const inputDataJSON = localStorage.getItem("upload") || "{}";
        const inputData = JSON.parse(inputDataJSON);

        const colNames = Array.isArray(inputData?.data?.meta?.fields) ? inputData.data.meta.fields : [];
        const colInclude = new Array(colNames.length).fill(false);
        const uploadObjectJSON = localStorage.getItem("upload") || "{}";
        const uploadObject = JSON.parse(uploadObjectJSON);
        const uploadColNames = uploadObject.data.meta.fields;
        const uploadRows = uploadObject.data.data;
        let colValuesList: string[][] = [];
        let enumPriorityOrder: string[][] = [];
        for (let i = 0; i < colNames.length; i++) {

            let columnValues: string[] = [];
            for (let j = 0; j < uploadRows.length; j++) {
                const uploadColName = uploadColNames[i];
                const uploadRow = uploadObject.data.data[j];
                columnValues.push(uploadRow[uploadColName]);
            }
            colValuesList.push([...new Set(columnValues)]);
            enumPriorityOrder.push([]);
        }

        const newSetupObject: SetupObject = {
            colNames: colNames,
            colValues: colValuesList,
            colInclude: colInclude,
            enumPriorityOrder: enumPriorityOrder,
            priority: [],
            marketDates: [],
            tiers: [],
            locations: [],
            sections: [],
            assignmentOptions: {
                maxAssignmentsPerVendor: null,
                maxHalfTableProportionPerSection: null,
                emailColNameIdx: null,
                tableChoiceColNameIdx: null,
                tableShareEmailColNameIdx: null,
                maxDaysColNameIdx: null,
            },
        };

        Object.assign(setupObject, newSetupObject);
        market.value!.setupObject = newSetupObject;
        localStorage.setItem("market", JSON.stringify(market.value));
    }

    // retrieve view state
    const setupPageIdx = JSON.parse(localStorage.getItem("setupPageIdx") || "null");
    pageIdx.value = setupPageIdx === null ? 0 : setupPageIdx;
});

const updateMarket = async () => {
    localStorage.setItem("market", JSON.stringify(market.value));
    const userEmail = JSON.parse(localStorage.getItem("user") || "null");
    await api.put('/markets/' + market.value!.id, market.value, {
        headers: {
            'X-Owner-Email': userEmail
        }
    });
}

const handleDiscordWebhookInput = (event: Event) => {
    if (!market.value) return;
    const value = (event.target as HTMLInputElement).value;
    const trimmed = value.trim();
    market.value.discordWebhookUrl = trimmed === '' ? null : value;
    localStorage.setItem('market', JSON.stringify(market.value));
};

const handleUpdateSetupObject = (newSetupObject: SetupObject) => {
    nextTick(() => {
        if (market.value) {
            Object.assign(setupObject, newSetupObject);
            market.value.setupObject = newSetupObject;
            localStorage.setItem("market", JSON.stringify(market.value));
        }
    });
};

const handleNext = async () => {
    pageIdx.value = pageIdx.value === maxPageIdx ? maxPageIdx : pageIdx.value + 1;
    localStorage.setItem("setupPageIdx", JSON.stringify(pageIdx.value));
    await updateMarket();
}
const handleBack = async () => {
    pageIdx.value = pageIdx.value === 0 ? 0 : pageIdx.value - 1;
    localStorage.setItem("setupPageIdx", JSON.stringify(pageIdx.value));
    await updateMarket();
}
const handleAssign = async () => {
    if (!assignmentOptionsComplete.value) {
        return;
    }
    await updateMarket();

    const userEmail = JSON.parse(localStorage.getItem("user") || "null");
    const response = await api.get('/markets/' + market.value!.id + '/assignment', {
        headers: {
            'X-Owner-Email': userEmail
        }
    })

    const assignedMarket: Market = response.data;
    market.value = assignedMarket;
    await updateMarket();

    router.push("/assignment-results");
}

function handlePathChoice(path: 'manual' | 'floorplan') {
  showPathChoice.value = false
  if (path === 'floorplan') {
    router.push({
      path: '/floorplan-editor',
      query: { marketId: market.value?.id },
    })
  }
  // For 'manual': just hide overlay, existing text-based UI is already underneath
}

// Show path choice overlay when entering sections page with empty sections
watch(pageIdx, (newIdx) => {
  if (
    newIdx === 1 &&
    setupObject.sections.length === 0 &&
    (!setupObject.floorplans || setupObject.floorplans.length === 0)
  ) {
    showPathChoice.value = true
  }
})

</script>

<template>
    <div class="market-setup-view">
        <ChoosePathOverlay v-if="showPathChoice" @select="handlePathChoice" />
        <div class="market-setup-body">
            <div class="settings-container">
                <div class="settings-header">
                    <h1>Settings</h1>
                </div>
                <div class="settings-body">
                    <template v-if="pageIdx === 0">
                        <div class="double-column-body">
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Manage Columns</h2>
                                </template>
                                <template #setting-content>
                                    <ElementSetupColumns :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Market Dates</h2>
                                </template>
                                <template #setting-content>
                                    <ElementMarketDates :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                        </div>
                    </template>

                    <template v-else-if="pageIdx === 1">
                        <div class="triple-column-body">
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Tier Setup</h2>
                                </template>
                                <template #setting-content>
                                    <ElementTierSetup :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Location Setup</h2>
                                </template>
                                <template #setting-content>
                                    <ElementLocationSetup :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Section Setup</h2>
                                </template>
                                <template #setting-content>
                                    <ElementSectionSetup :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                        </div>
                    </template>

                    <template v-else-if="pageIdx === 2">
                        <div class="double-column-body-asymmetric">
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Assignment Priority</h2>
                                </template>
                                <template #setting-content>
                                    <ElementAssignmentPriority :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                            <ElementSettingContainer>
                                <template #setting-title>
                                    <h2>Assignment Options</h2>
                                </template>
                                <template #setting-content>
                                    <ElementAssignmentOptions :setupObject="setupObject"
                                        @update:setupObject="handleUpdateSetupObject" />
                                </template>
                            </ElementSettingContainer>
                        </div>
                    </template>

                    <template v-else>
                        <h1>Something went wrong!</h1>
                    </template>
                </div>
            </div>
            <div class="discord-webhook-row">
                <label class="discord-webhook-label" for="discord-webhook-url">Discord webhook URL</label>
                <input
                    id="discord-webhook-url"
                    type="url"
                    class="discord-webhook-input"
                    placeholder="https://discord.com/api/webhooks/..."
                    :value="market?.discordWebhookUrl ?? ''"
                    @input="handleDiscordWebhookInput"
                    @change="updateMarket"
                />
            </div>
            <div style="width: 100%; display: flex; flex-direction: row; justify-content: space-between;">
                <div>
                    <button v-if="pageIdx !== 0" class="done-button" @click="handleBack">Back</button>
                </div>
                <div>
                    <button
                        v-if="pageIdx === maxPageIdx"
                        type="button"
                        class="done-button"
                        :disabled="!assignmentOptionsComplete"
                        :title="assignmentOptionsComplete ? '' : 'Complete required assignment options (max assignments, proportion, and column mappings; Max days is optional)'"
                        @click="handleAssign"
                    >
                        Assign
                    </button>
                    <button v-else class="done-button" @click="handleNext">Next</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.market-setup-view {
    width: 100%;
    min-width: 1000px;
    flex: 1;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.market-setup-body {
    width: 80%;
    height: 80%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.settings-container {
    align-self: stretch;
    flex: 1;
    background-color: white;
    box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
}

.settings-right-container {
    display: grid;
    grid-template-rows: 48% 4% 48%;
}

.settings-header {
    align-self: stretch;
    height: 50px;
    background-color: var(--mm-black);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
}

.settings-body {
    align-self: stretch;
    flex-grow: 1;
    display: flex;
    gap: 30px;
    padding: 40px;
    min-height: 0;
    flex: 1;
}

.single-column-body {
    align-self: stretch;
    flex-grow: 1;
    display: grid;
    grid-template-columns: 1fr;
    gap: 30px;
    min-height: 0;
    flex: 1;
}

.double-column-body {
    align-self: stretch;
    flex-grow: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    min-height: 0;
    flex: 1;
}

.double-column-body-asymmetric {
    align-self: stretch;
    flex-grow: 1;
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 30px;
    min-height: 0;
    flex: 1;
}

.triple-column-body {
    align-self: stretch;
    flex-grow: 1;
    display: grid;
    grid-template-columns: 1fr 1fr 2fr;
    gap: 30px;
    min-height: 0;
    flex: 1;
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
    font-size: 20px;
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

.done-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.discord-webhook-row {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    margin-top: 15px;
}

.discord-webhook-label {
    font-family: 'Outfit Regular';
    font-size: 14px;
    color: var(--mm-black);
    white-space: nowrap;
}

.discord-webhook-input {
    flex: 1;
    height: 32px;
    padding: 4px 10px;
    font-family: 'Outfit Regular';
    font-size: 14px;
    border: 1px solid var(--mm-grey, #b0b0b0);
    border-radius: 5px;
    background-color: white;
}
</style>