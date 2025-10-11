<script setup lang="ts">
import { onMounted, ref, toRef, nextTick, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import { type SetupObject, type PriorityObject } from '@/assets/types/datatypes';
import IconAddRound from '../icons/IconAddRound.vue';
import IconClickDrag from '../icons/IconClickDrag.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import { type TierObject } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const tierObjects = toRef(setupObject.value, "tiers");

watch(
    () => setupObject.value.tiers,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

const watchers = new Map<number, () => void>();
const watchTierObject = ((id: number) => {
    const getObjectIndex = (id: number) => {
        return tierObjects.value.findIndex(obj => obj.id == id);
    };
    const objectIndex = getObjectIndex(id);

    const watcher = watch(
        () => tierObjects.value[objectIndex],
        (newObj) => {

            if (!newObj) {
                removeWatcher(id);
                return;
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

onMounted(() => {
    setHeight();
});

const addTierRow = () => {
    const newTierObject: TierObject = {
        id: tierObjects.value.length + 1,
        name: "",
    }
    tierObjects.value.push(newTierObject);
    watchTierObject(newTierObject.id);
}

const removeTierRow = (index: number) => {
    tierObjects.value.splice(index, 1);
}

const hoverParentIndex = ref(null);

const dragOptions = computed(() => ({
    group: "rows",
    disabled: false,
    ghostClass: "sortable-chosen",
    chosenClass: "sortable-ghost",
    dragClass: "sortable-ghost",
    handle: '.drag-item',
    // filter: '.click-item',
    forceFallback: false,
    fallbackOnBody: false
}));

</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3>Priority</h3>
            <h3>Tier Name</h3>
            <h3></h3>
        </div>
        <div class="rows" ref="rows">
            <draggable class="priority-rows" v-model="tierObjects" item-key="id" v-bind="dragOptions">
                <template #item="{ element, index: parentIndex }">
                    <div class="priority-row row-container" :key="element.id"
                        @mouseover="hoverParentIndex = parentIndex" @mouseleave="hoverParentIndex = null">
                        <div class="row-item drag-item">
                            <IconClickDrag class="click-drag" />
                            <h3>{{ parentIndex + 1 }}</h3>
                        </div>
                        <div class="row-item">
                            <div class="input-container text-item">
                                <input type="text" v-model="tierObjects[parentIndex].name"
                                    style="all: unset; font-size: 14px; width: 100%; height: 100%; text-align: center; text-justify: center;" />
                            </div>
                        </div>
                        <div
                            style="padding: none; display: flex; flex-direction: row; align-items: center; justify-content: center;">
                            <IconCloseRound :class="{ 'hidden-icon': hoverParentIndex !== parentIndex }"
                                class="icon-close-round" @click="() => { removeTierRow(parentIndex) }" />
                        </div>
                    </div>
                </template>
            </draggable>

            <div class="add-container">
                <IconAddRound class="icon-add-round" @click="addTierRow" />
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
    grid-template-columns: 15% 80% 5%;
}

.priority-row {
    display: grid;
    grid-template-columns: 15% 80% 5%;
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

/* .row-item {
    display: flex;
    flex-direction: row;

    padding-left: 5px;
    padding-right: 5px;
    justify-content: space-between;
    align-items: center;

    position: relative;

    border-right: 3px solid var(--mm-grey);
} */

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

.text-item {
    cursor: text;
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
    max-width: 20px;
    max-height: 20px;
    width: 80%;
    height: 80%;
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