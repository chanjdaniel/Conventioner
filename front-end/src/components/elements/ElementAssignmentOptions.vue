<script setup lang="ts">
import { ref, toRef, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { type SetupObject, type SectionObject } from '@/assets/types/datatypes'

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const updateSetupObject = () => {
    emit("update:setupObject", setupObject.value);
};

const setupObject = toRef(props, "setupObject");
const assignmentOptions = toRef(setupObject.value, "assignmentOptions");

const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);

watch(
    () => setupObject.value.assignmentOptions,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

const handleDaysInput = (value: number) => {
    if (value < 0 || isNaN(value)) { // if value is less than zero or is not a number, set to null
        assignmentOptions.value.maxAssignmentsPerVendor = null;
        return;
    }

    let MAX_DAYS = setupObject.value.marketDates.length;
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

    let MAX_PROPORTION = 100; // Backend expects percentage as integer (0-100)
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
.container {
    width: 100%;
    height: 100%;

    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;

    /* gap: 15px; */
}

.rows {
    display: flex;
    flex-direction: column;
    width: 100%;

    align-items: center;

    gap: 8px;
    padding-top: 4px;
    padding-bottom: 8px;

    overflow-y: auto;
    overflow-x: hidden;
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

.input-container {
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