<script setup lang="ts">
import { onMounted, ref, toRef, nextTick, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import { type SetupObject, type PriorityObject } from '@/views/MarketSetupView.vue';
import IconAddRound from '../icons/IconAddRound.vue';
import IconClickDrag from '../icons/IconClickDrag.vue';
import IconClickDragSmall from '../icons/IconClickDragSmall.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import { DataType } from '@/assets/types/DataType';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const priorityObjects = toRef(setupObject.value, "priority");
const watchers = new Map<number, () => void>();

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

const dataTypes: DataType[] = [DataType.String, DataType.Number, DataType.Enum];
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

onMounted(() => {
    setHeight();
});

const addPriorityRow = () => {
    const newPriorityObject: PriorityObject = {
        id: priorityObjects.value.length + 1,
        colName: colDefault,
        dataType: dataTypeDefault,
        sortingOrder: "",
    }
    priorityObjects.value.push(newPriorityObject);
    watchPriorityObject(newPriorityObject.id);
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

const sortingDragOptions = computed(() => ({
    group: "sorting",
    disabled: false,
    ghostClass: "sortable-chosen",
    chosenClass: "sorting-ghost",
    dragClass: "sorting-ghost",
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
                forceFallback: false,
                fallbackOnBody: false
            }" v-bind="dragOptions">
                <template #item="{ element, index }">
                    <div class="priority-row row-container" :key="element.id" @mouseenter="hover = index"
                        @mouseleave="hover = null">
                        <div class="row-item drag-item">
                            <IconClickDrag class="click-drag" />
                            <h3>{{ index + 1 }}</h3>
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
                            <draggable class="sorting-rows sorting-order-container"
                                v-if="priorityObjects[index].dataType === DataType.Enum"
                                v-model="setupObject.enumPriorityOrder[setupObject.colNames.indexOf(priorityObjects[index].colName)]"
                                item-key="element"
                                :options="{
                                    handle: '.drag-item',
                                    filter: '.click-item',
                                    forceFallback: true,
                                    fallbackOnBody: true
                                }" v-bind="sortingDragOptions">
                                <template #item="{ element, index }">
                                    <div class="sorting-order-row">
                                        <div class="sorting-index-drag">
                                            <IconClickDragSmall class="sorting-click-drag" />
                                            <h3>{{ index + 1 }}</h3>
                                        </div>
                                        <h4 class="row-container sorting-text">
                                            {{ element }}
                                        </h4>
                                        <div class="sorting-index-drag" style="visibility: hidden;">
                                            <IconClickDragSmall class="sorting-click-drag" />
                                            <h3>{{ index + 1 }}</h3>
                                        </div>
                                    </div>
                                </template>
                            </draggable>
                            <div v-else-if="priorityObjects[index].dataType === DataType.Default">
                            </div>
                            <select v-else class="dropdown" style="text-align: center;"
                                v-model="priorityObjects[index].sortingOrder">
                                <option disabled value="">{{ sortingDefault }}</option>
                                <option class="display-list"
                                    v-for="value in dataTypeSorting[priorityObjects[index].dataType]" :key="value"
                                    :value="value">
                                    {{ value }}
                                </option>
                            </select>
                        </div>
                        <div class="row-item">
                            <IconCloseRound v-if="hover === index" class="icon-close-round"
                                @click="() => { removePriorityRow(index) }" />
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
    overflow: visible;
}

.sortable-ghost {
    box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
    opacity: 0.5;
}

.sorting-ghost {
    opacity: 0.5;
}

.sortable-chosen {
    visibility: hidden;
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

.sorting-order-container {
    width: 100%;
    max-height: 200px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-top: 10px;
    padding-bottom: 10px;
    padding-left: 10px;
    padding-right: 10px;
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
    width: auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
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
</style>