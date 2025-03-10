<script setup lang="ts">
import { onMounted, ref, toRef, nextTick, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import { type SetupObject, type PriorityObject } from '@/views/MarketSetupView.vue';
import IconAddRound from '../icons/IconAddRound.vue';
import IconClickDrag from '../icons/IconClickDrag.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import { DataType } from '@/assets/types/DataType';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const priorityObjects = toRef(setupObject.value, "priority");

watch(
    () => setupObject.value.priority,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

const rowsMaxHeight = ref<string | null>(null);
const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const setHeight = () => {
    if (container.value && columnTitles.value && rows.value) {
        rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 15}px`;
    }
};

const dataTypes = ["String", "Number", "Enum"];
const dataTypeSorting: Record<DataType, string[]> = {
  [DataType.String]: ["A-Z", "Z-A"],
  [DataType.Number]: ["Ascending", "Descending"],
  [DataType.Enum]: [],
  [DataType.Default]: [],
};
const colDefault = "Select a column";
const dataTypeDefault: DataType = DataType.Default;
const sortingDefault = "Select a sorting order";

const hover = ref();

onMounted(() => {
    setHeight();
    nextTick(() => {

    })
});

const addPriorityRow = () => {
    const newPriorityObject: PriorityObject = {
        id: priorityObjects.value.length + 1,
        colName: colDefault,
        dataType: dataTypeDefault,
        sortingOrder: "",
    }
    priorityObjects.value.push(newPriorityObject);
};

const removePriorityRow = (index: number) => {
    priorityObjects.value.splice(index, 1);
}

const dragOptions = computed(() => ({
    group: "rows",
    disabled: false,
    ghostClass: "sortable-chosen",
    chosenClass: "sortable-ghost",
    dragClass: "sortable-ghost",
}))

</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3>Priority</h3>
            <h3>Column</h3>
            <h3>Data type</h3>
            <h3>Sorting order</h3>
            <h3></h3>
        </div>
        <div class="rows" ref="rows">

            <draggable class="priority-rows" v-model="priorityObjects" item-key="id" :options="{
                handle: '.drag-item',
                filter: '.click-item',
                forceFallback: true,
                fallbackOnBody: true
            }" v-bind="dragOptions">
                <template #item="{ element, index }">
                    <div class="priority-row row-container" :key="element.id" @mouseenter="hover = index"
                        @mouseleave="hover = null">
                        <div class="row-item drag-item">
                            <IconClickDrag class="click-drag" />
                            <h4>{{ index + 1 }}</h4>
                        </div>
                        <div class="row-item click-item">
                            <select class="dropdown" v-model="priorityObjects[index].colName">
                                <option disabled value="">{{ colDefault }}</option>
                                <option class="display-list" v-for="value in setupObject.colNames" :key="value"
                                    :value="value">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div class="row-item click-item">
                            <select class="dropdown" v-model="priorityObjects[index].dataType">
                                <option disabled value="">{{ dataTypeDefault }}</option>
                                <option class="display-list" v-for="value in dataTypes" :key="value" :value="value">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div class="row-item click-item">
                            <select v-if="priorityObjects[index].dataType===DataType.Enum" class="dropdown" style="text-align: center;" v-model="priorityObjects[index].dataType">
                                <option disabled value="">{{ dataTypeDefault }}</option>
                                <option class="display-list" v-for="value in dataTypes" :key="value" :value="value">
                                    {{ value }}
                                </option>
                            </select>
                            <div v-if="priorityObjects[index].dataType===DataType.Default">
                            </div>
                            <select v-else class="dropdown" style="text-align: center;" v-model="priorityObjects[index].sortingOrder">
                                <option disabled value="">{{ sortingDefault }}</option>
                                <option class="display-list" v-for="value in dataTypeSorting[priorityObjects[index].dataType]" :key="value" :value="value">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div class="row-item">
                            <IconCloseRound v-if="hover === index" class="icon-close-round"
                                @click="removePriorityRow(index)" />
                        </div>
                    </div>
                </template>
            </draggable>

            <div class="add-container">
                <IconAddRound class="icon-add-round" @click="addPriorityRow" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.container {
    width: 100%;
    height: 100%;

    display: flex;
    flex-direction: column;
    align-items: center;

    padding-left: 5px;
    padding-right: 5px;
    gap: 15px;
}

.column-titles {
    display: grid;
    grid-template-columns: 10% 30% 15% 45%;
}

.priority-row {
    display: grid;
    grid-template-columns: 10% 30% 15% 40% 5%;
    padding-top: 5px;
    padding-bottom: 5px;
    min-height: 48px;
    transition: transform 0.3s ease-in-out !important;
    overflow: visible;
}

.sortable-ghost {
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.3s ease-in-out !important;
}

.sortable-chosen {
    visibility: hidden;
    transition: transform 0.3s ease-in-out !important;
}

.row-item {
    display: flex;
    flex-direction: row;

    padding-left: 10px;
    padding-right: 5px;
    justify-content: space-between;
    align-items: center;

    position: relative;

    border-right: 3px solid var(--mm-grey);
}

.row-item:last-of-type {
    border: none;
}

.priority-rows {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    overflow: visible;
    transition: all 0.2s ease-in-out !important;
}

.rows {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: v-bind(rowsMaxHeight);

    align-items: center;

    gap: 8px;
    padding-top: 4px;
    padding-bottom: 8px;

    overflow: auto;
}

.icon-add-round {
    width: 40px;
    height: 40px;
    cursor: pointer;
}

.dropdown {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    border: none;
    outline: none;
    cursor: pointer;
    font-size: 12px;
    padding-right: 5px;
}

.click-item {
    cursor: pointer;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
}

.drag-item {
    cursor: grab;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    text-align: center;
}

.drag-item:active {
    cursor: grabbing;
}

.click-drag {
    width: 16px;
    height: 56px;
    position: absolute;
    left: 0;
}

.icon-close-round {
    width: 20px;
    height: 20px;
    opacity: 0;
    transition: opacity 0.15s ease-in-out;
}

.priority-row:hover,
.icon-close-round {
    opacity: 1;
    cursor: pointer;
}
</style>