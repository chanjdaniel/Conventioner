<script setup lang="ts">
import { ref, toRef, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { type SetupObject, type SectionObject } from '@/assets/types/datatypes'
import { type LocationObject } from '@/assets/types/datatypes';

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

</script>

<template>
    <div class="container" ref="container">
        <div class="rows" ref="rows">
            <div class="row-container row">
                <div class="row-item">
                    <div class="input-container">
                        <input type="text" v-model="assignmentOptions.MAX_ASSIGNMENTS_PER_VENDOR"
                            style="all: unset; font-size: 14px; width: 100%;" />
                    </div>
                </div>
            </div>
            <div class="row-container row">
                <div class="row-item">
                    <div class="input-container">
                        <input type="text" v-model="assignmentOptions.MAX_HALF_TABLE_PROPORTION_PER_SECTION"
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
    grid-template-columns: 95% 5%;
    padding-top: 5px;
    padding-bottom: 5px;
}

.row-item {
    display: flex;
    flex-direction: row;
    position: relative;

    padding-left: 10px;
    padding-right: 5px;
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