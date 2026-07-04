<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue';
import { type SetupObject } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const assignmentOptions = toRef(setupObject.value, "assignmentOptions");
const colNames = computed(() => setupObject.value.colNames ?? []);

onMounted(() => {
    const ao = assignmentOptions.value;
    if (ao.emailColNameIdx === undefined) ao.emailColNameIdx = null;
    if (ao.tableChoiceColNameIdx === undefined) ao.tableChoiceColNameIdx = null;
    if (ao.tableShareEmailColNameIdx === undefined) ao.tableShareEmailColNameIdx = null;
    if (ao.maxDaysColNameIdx === undefined) ao.maxDaysColNameIdx = null;
});

const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);

watch(
    () => setupObject.value.assignmentOptions,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

/** Select value: "" = null (unset); required fields must pick a column for assignment to run */
function colIdxToSelectValue(idx: number | null | undefined): string {
    if (idx === null || idx === undefined || idx < 0) {
        return "";
    }
    return String(idx);
}

function setColIdx(
    key: "emailColNameIdx" | "tableChoiceColNameIdx" | "tableShareEmailColNameIdx" | "maxDaysColNameIdx",
    raw: string
) {
    if (raw === "") {
        assignmentOptions.value[key] = null;
    } else {
        const n = parseInt(raw, 10);
        assignmentOptions.value[key] = Number.isNaN(n) ? null : n;
    }
}

const handleDaysInput = (value: number) => {
    if (value < 0 || isNaN(value)) { // if value is less than zero or is not a number, set to null
        assignmentOptions.value.maxAssignmentsPerVendor = null;
        return;
    }

    const MAX_DAYS = setupObject.value.marketDates.length;
    if (value > MAX_DAYS) {
        assignmentOptions.value.maxAssignmentsPerVendor = MAX_DAYS;
    } else {
        assignmentOptions.value.maxAssignmentsPerVendor = Math.floor(value); // Ensure integer
    }
};

const handleProportionInput = (value: number) => {
    if (value < 0 || isNaN(value)) { // if value is less than zero or is not a number, set to null
        assignmentOptions.value.maxHalfTableProportionPerSection = null;
        return;
    }

    const MAX_PROPORTION = 100; // Backend expects percentage as integer (0-100)
    if (value > MAX_PROPORTION) {
        assignmentOptions.value.maxHalfTableProportionPerSection = MAX_PROPORTION;
    } else {
        assignmentOptions.value.maxHalfTableProportionPerSection = Math.floor(value); // Ensure integer percentage
    }
};

</script>

<template>
    <div class="container" ref="container">
        <div class="rows" ref="rows">
            <div class="mapping-heading">
                <h3 class="mapping-title">Column mapping</h3>
            </div>

            <div class="row-container row">
                <div class="row-item">
                    <h3>Vendor email</h3>
                </div>
                <div class="row-item enum-item">
                    <select
                        class="datatype-dropdown"
                        :value="colIdxToSelectValue(assignmentOptions.emailColNameIdx)"
                        @change="setColIdx('emailColNameIdx', ($event.target as HTMLSelectElement).value)"
                    >
                        <option value=""></option>
                        <option
                            v-for="(name, index) in colNames"
                            :key="'email-' + index"
                            :value="String(index)"
                        >
                            {{ name }}
                        </option>
                    </select>
                </div>
            </div>
            <div class="row-container row">
                <div class="row-item">
                    <h3>Table choice</h3>
                </div>
                <div class="row-item enum-item">
                    <select
                        class="datatype-dropdown"
                        :value="colIdxToSelectValue(assignmentOptions.tableChoiceColNameIdx)"
                        @change="setColIdx('tableChoiceColNameIdx', ($event.target as HTMLSelectElement).value)"
                    >
                        <option value=""></option>
                        <option
                            v-for="(name, index) in colNames"
                            :key="'tc-' + index"
                            :value="String(index)"
                        >
                            {{ name }}
                        </option>
                    </select>
                </div>
            </div>
            <div class="row-container row">
                <div class="row-item">
                    <h3>Table share email</h3>
                </div>
                <div class="row-item enum-item">
                    <select
                        class="datatype-dropdown"
                        :value="colIdxToSelectValue(assignmentOptions.tableShareEmailColNameIdx)"
                        @change="setColIdx('tableShareEmailColNameIdx', ($event.target as HTMLSelectElement).value)"
                    >
                        <option value=""></option>
                        <option
                            v-for="(name, index) in colNames"
                            :key="'tse-' + index"
                            :value="String(index)"
                        >
                            {{ name }}
                        </option>
                    </select>
                </div>
            </div>
            <div class="row-container row">
                <div class="row-item">
                    <h3>Max days <span class="optional-label">(optional)</span></h3>
                </div>
                <div class="row-item enum-item">
                    <select
                        class="datatype-dropdown"
                        :value="colIdxToSelectValue(assignmentOptions.maxDaysColNameIdx)"
                        @change="setColIdx('maxDaysColNameIdx', ($event.target as HTMLSelectElement).value)"
                    >
                        <option value=""></option>
                        <option
                            v-for="(name, index) in colNames"
                            :key="'md-' + index"
                            :value="String(index)"
                        >
                            {{ name }}
                        </option>
                    </select>
                </div>
            </div>

            <div class="mapping-heading additional-options-heading">
                <h3 class="mapping-title">Additional options</h3>
            </div>

            <div class="row-container row">
                <div class="row-item">
                    <h3>Max assignments per vendor</h3>
                </div>
                <div class="row-item">
                    <div class="input-container">
                        <input type="text" v-model="assignmentOptions.maxAssignmentsPerVendor"
                            @input="handleDaysInput(Number(($event.target as HTMLInputElement)?.value || NaN))"
                            style="all: unset; font-size: 14px; width: 100%;" />
                    </div>
                </div>
            </div>
            <div class="row-container row">
                <div class="row-item">
                    <h3>Max half table proportion per section (%)</h3>
                </div>
                <div class="row-item">
                    <div class="input-container">
                        <input type="text" v-model="assignmentOptions.maxHalfTableProportionPerSection"
                            @blur="handleProportionInput(Number(($event.target as HTMLInputElement)?.value || NaN))"
                            style="all: unset; font-size: 14px; width: 100%;" />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Match ElementMarketDates.vue select behavior: left-aligned text, ellipsis for overflow */
option {
    text-align: left;
}

select.datatype-dropdown {
    max-width: 100%;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.container {
    width: 100%;
    height: 100%;

    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;

    /* Offset parent .setting-body padding-top so "Column mapping" sits closer to the card top */
    margin-top: -8px;
}

.rows {
    display: flex;
    flex-direction: column;
    width: 100%;

    align-items: center;

    gap: 8px;
    padding-top: 0;
    padding-bottom: 8px;

    overflow-y: auto;
    overflow-x: hidden;
}

.mapping-heading {
    width: 100%;
    padding: 0 10px 4px;
    text-align: left;
}

.mapping-title {
    margin: 0;
    font-size: 16px;
    color: var(--mm-black, #222);
}

.optional-label {
    font-weight: normal;
    font-size: 0.85em;
    opacity: 0.85;
}

.additional-options-heading {
    margin-top: 12px;
    padding-top: 6px;
}

.row {
    display: grid;
    grid-template-columns: 40% 60%;
    padding-top: 5px;
    padding-bottom: 5px;
}

.row-item {
    display: flex;
    flex-direction: row;
    position: relative;

    padding-left: 10px;
    padding-right: 10px;
    justify-content: center;
    align-items: center;

    border-right: 3px solid var(--mm-grey);
}

.row-item:last-of-type {
    border: none;
}

.enum-item {
    cursor: pointer;
}

/* Native select arrows ignore padding; use appearance:none + background chevron for consistent inset */
.datatype-dropdown {
    width: 100%;
    height: 100%;
    min-height: 32px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    text-align: left;
    text-align-last: left;
    direction: ltr;
    border: none;
    outline: none;
    cursor: pointer;
    font-size: 16px;
    padding-left: 8px;
    /* Text stops before icon; chevron sits inset from the right edge */
    padding-right: 1.5rem;
    box-sizing: border-box;
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    border-radius: 8px;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-color: white;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23333333' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.375rem center;
    background-size: 1.125rem 1.125rem;
}

.datatype-dropdown::-ms-expand {
    display: none;
}

.datatype-dropdown,
.datatype-dropdown option {
    font-family: inherit;
    font-size: 16px;
    color: #333;
}

.input-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    width: 80%;
    height: 100%;
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    border-radius: 8px;
}

input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

input[type=number] {
    -moz-appearance: textfield;
}

.hidden-icon {
    visibility: hidden;
}

.icon-add-round {
    width: 40px;
    height: 40px;
    cursor: pointer;
}

.icon-close-round {
    max-width: 20px;
    max-height: 20px;
    width: 80%;
    height: 80%;
    cursor: pointer;
}
</style>
