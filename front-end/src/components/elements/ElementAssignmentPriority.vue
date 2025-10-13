<script setup lang="ts">
import { onMounted, ref, toRef, nextTick, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import { type SetupObject, type PriorityObject } from '@/assets/types/datatypes';
import IconAddRound from '../icons/IconAddRound.vue';
import IconClickDrag from '../icons/IconClickDrag.vue';
import IconClickDragSmall from '../icons/IconClickDragSmall.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import { DataType } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const priorityObjects = toRef(setupObject.value, "priority");
const enumPriorityOrder = toRef(setupObject.value, "enumPriorityOrder");

watch(
    () => setupObject.value.priority,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

watch(
    () => setupObject.value.enumPriorityOrder,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

const watchers = new Map<number, () => void>();
const watchPriorityObject = ((id: number) => {
    const getObjectIndex = (id: number) => {
        return priorityObjects.value.findIndex(obj => obj.id == id);
    };
    const objectIndex = getObjectIndex(id);

    const watcher = watch(
        () => priorityObjects.value[objectIndex],
        (newObj) => {

            if (!newObj) {
                removeWatcher(id);
                return;
            }

            if (!dataTypeSorting[newObj.dataType].includes(newObj.sortingOrder) && newObj.sortingOrder !== "") {
                priorityObjects.value[objectIndex].sortingOrder = "";
                console.log("deleted");
            }

            console.log("watched");
        },
        { deep: true }
    );

    watchers.set(id, watcher);
});

const removeWatcher = (objId: number) => {
    if (watchers.has(objId)) {
        watchers.get(objId)!();
        watchers.delete(objId);
    }
}

const rowsMaxHeight = ref<string | null>(null);
const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
    const setHeight = () => {
    rowsMaxHeight.value = "0px";
    nextTick(() => {
        if (container.value && columnTitles.value && rows.value) {
            rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 15}px`;
        }
    });
};

const dataTypes: DataType[] = [DataType.String, DataType.Number, DataType.Enum, DataType.Contains, DataType.NotContains];
const dataTypeSorting: Record<DataType, string[]> = {
    [DataType.String]: ["A-Z", "Z-A"],
    [DataType.Number]: ["Ascending", "Descending"],
    [DataType.Enum]: [],
    [DataType.Contains]: [],
    [DataType.NotContains]: [],
    [DataType.Default]: [],
}
const colDefault = "Select a column";
const dataTypeDefault: DataType = DataType.Default;
const sortingDefault = "Select a sorting order";
const enumDefault = "Select a value";

onMounted(() => {
    setHeight();
});

const addPriorityRow = () => {
    const newPriorityObject: PriorityObject = {
        id: priorityObjects.value.length + 1,
        colNameIdx: -1,
        dataType: dataTypeDefault,
        sortingOrder: "",
    }
    priorityObjects.value.push(newPriorityObject);
    watchPriorityObject(newPriorityObject.id);
}

function sortingItemIndex(index: number) {
    return priorityObjects.value[index].colNameIdx;
}

const removePriorityRow = (index: number) => {
    priorityObjects.value.splice(index, 1);
}

const addEnumSortingItem = (index: number) => {
    enumPriorityOrder.value[index].push(enumDefault);
}

const removeEnumSortingItem = (parentIndex: number, childIndex: number) => {
    enumPriorityOrder.value[sortingItemIndex(parentIndex)].splice(childIndex, 1);
}

const hoverParentIndex = ref(null);
const hoverChildIndex = ref(null);

const dragOptions = computed(() => ({
    group: "rows",
    disabled: false,
    ghostClass: "sortable-chosen",
    chosenClass: "sortable-ghost",
    dragClass: "sortable-ghost",
    handle: '.drag-item',
    forceFallback: false,
    fallbackOnBody: false,
}));

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

            <draggable class="priority-rows" v-model="priorityObjects" item-key="id" v-bind="dragOptions">
                <template #item="{ element, index: parentIndex }">
                    <div class="priority-row row-container" :key="element.id"
                        @mouseover="hoverParentIndex = parentIndex" @mouseleave="hoverParentIndex = null">
                        <div class="row-item drag-item">
                            <IconClickDrag class="click-drag" />
                            <h3>{{ parentIndex + 1 }}</h3>
                        </div>
                        <div class="row-item click-item">
                            <select class="dropdown" v-model="priorityObjects[parentIndex].colNameIdx">
                                <option disabled value="">{{ colDefault }}</option>
                                <option class="display-list" v-for="(value, index) in setupObject.colNames" :key="index"
                                    :value="index">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div class="row-item click-item">
                            <select class="dropdown" v-model="priorityObjects[parentIndex].dataType">
                                <option disabled value="">{{ dataTypeDefault }}</option>
                                <option class="display-list" v-for="value in dataTypes" :key="value" :value="value">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div class="row-item">
                            <div class="sorting-order-container"
                                v-if="priorityObjects[parentIndex].dataType === DataType.Enum">
                                <draggable class="sorting-rows"
                                    v-if="priorityObjects[parentIndex].dataType === DataType.Enum"
                                    v-model="enumPriorityOrder[priorityObjects[parentIndex].colNameIdx]"
                                    item-key="element" :options="{
                                        handle: '.sorting-index-drag',
                                        filter: '.click-item',
                                        forceFallback: true,
                                        fallbackOnBody: true
                                    }" :group="`sorting-${parentIndex}`" :disabled="false"
                                    :ghostClass="'sortable-chosen'" :chosenClass="'sorting-ghost'"
                                    :dragClass="'sorting-ghost'">
                                    <template #item="{ element, index: childIndex }">
                                        <div class="sorting-order-row" @mouseover="hoverChildIndex = childIndex"
                                            @mouseleave="hoverChildIndex = null">
                                            <div class="sorting-index-drag" @mousedown.stop>
                                                <IconClickDragSmall class="sorting-click-drag" />
                                                <h3>{{ childIndex + 1 }}</h3>
                                            </div>
                                            <h4 class="row-container sorting-text">
                                                <select class="dropdown"
                                                    v-model="enumPriorityOrder[sortingItemIndex(parentIndex)][childIndex]">
                                                    <option disabled value="">{{ enumDefault }}</option>
                                                    <option value="<All others>">&lt;All others&gt;</option>
                                                    <option class="display-list"
                                                        v-for="value in setupObject.colValues[sortingItemIndex(parentIndex)]"
                                                        :key="value" :value="value">
                                                        {{ value }}
                                                    </option>
                                                </select>
                                            </h4>
                                            <div
                                                style="width: 40px; display: flex; flex-direction: row; align-items: center; justify-content: center;">
                                                <IconCloseRound
                                                    :class="{ 'hidden-icon': hoverChildIndex !== childIndex || hoverParentIndex !== parentIndex }"
                                                    class="icon-close-round" style="width: 15px;"
                                                    @click="removeEnumSortingItem(parentIndex, childIndex)" />
                                            </div>
                                        </div>
                                    </template>
                                </draggable>
                                <IconAddRound
                                    :class="{ 'hidden-icon': hoverParentIndex !== parentIndex ||  priorityObjects[parentIndex].colNameIdx === -1}"
                                    @click="addEnumSortingItem(sortingItemIndex(parentIndex))"
                                    style="cursor: pointer;" />
                            </div>
                            <div v-else-if="priorityObjects[parentIndex].dataType === DataType.Default">
                            </div>
                            <div v-else-if="priorityObjects[parentIndex].dataType === DataType.Contains || priorityObjects[parentIndex].dataType === DataType.NotContains" style="width: 100%; display: flex; align-items: center; justify-content: center;">
                                    <div class="input-container row-item">
                                        <input type="text" v-model="priorityObjects[parentIndex].sortingOrder" style="all: unset; font-size: 14px; width: 100%; align-items: center; justify-content: center;" />
                                    </div>
                            </div>
                            <select v-else class="dropdown" style="text-align: center;"
                                v-model="priorityObjects[parentIndex].sortingOrder">
                                <option disabled value="">{{ sortingDefault }}</option>
                                <option class="display-list"
                                    v-for="value in dataTypeSorting[priorityObjects[parentIndex].dataType]" :key="value"
                                    :value="value">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div
                            style="padding: none; display: flex; flex-direction: row; align-items: center; justify-content: center;">
                            <IconCloseRound :class="{ 'hidden-icon': hoverParentIndex !== parentIndex }"
                                class="icon-close-round" @click="() => { removePriorityRow(parentIndex) }" />
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
h4 {
    height: auto;
    text-align: center;
    text-justify: center;
    min-height: 30px;
    max-height: 200px;
    max-width: 400px;
    overflow-y: scroll;
    scrollbar-width: none;
}

h3 {
    padding-left: 5px;
    padding-right: 5px;
}

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

.input-container {
    width: 80%;
    height: 100%;
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    border-radius: 8px;
}

.column-titles {
    display: grid;
    grid-template-columns: 10% 30% 15% 40% 5%;
}

.priority-row {
    display: grid;
    grid-template-columns: 10% 30% 15% 40% 5%;
    padding-top: 5px;
    padding-bottom: 5px;
    min-height: 48px;
    overflow: visible;
}

.sortable-ghost {
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    opacity: 0.7;
}

.sorting-ghost {
    opacity: 0.8;
}

.sortable-chosen {
    visibility: hidden;
}

.row-item {
    display: flex;
    flex-direction: row;

    padding-left: 5px;
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
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    overflow: visible;
}

.sorting-rows {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0px;
    overflow: visible;
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
    scrollbar-width: none;
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
    font-size: 14px;
    padding-right: 5px;
    background-color: white;
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
    cursor: pointer;
}

.sorting-order-container {
    width: 100%;
    max-height: 200px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-top: 10px;
    gap: 0px;
}

.sorting-order-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    height: auto;
    width: 100%;
    cursor: grab;
    padding: 4px;
}

.sorting-index-drag {
    min-width: 40px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: left;
}

.sorting-text {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 5px;
    margin-right: 5px;
    padding-left: 5px;
    padding-right: 5px;
}

.sorting-click-drag {
    width: 16px;
    height: 30px;
}

.hidden-icon {
    visibility: hidden;
}
</style>