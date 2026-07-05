<script setup lang="ts">
import { ref, toRef, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { type SetupObject } from '@/assets/types/datatypes'
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import { type LocationObject } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const locationObjects = toRef(setupObject.value, "locations");

const container = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);

const rowsMaxHeight = ref<string | null>(null);

const setHeight = () => {
    rowsMaxHeight.value = "0px";
    nextTick(() => {
        if (container.value && columnTitles.value && rows.value) {
            rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 15}px`;
        }
    });
};

const resizeObserver = new ResizeObserver(setHeight);

onMounted(() => {
    setHeight();
    nextTick(() => {
        resizeObserver.observe(document.body);
    })
});

onUnmounted(() => {
    resizeObserver.disconnect();
});

watch(
    () => setupObject.value.locations,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

const hoverIndex = ref<number | null>(null);

const addRow = () => {
    const newLocation: LocationObject = {
        name: "",
    }
    locationObjects.value.push(newLocation);
    setHeight();
}

const removeRow = (index: number | null) => {
    if (index != null) {
        locationObjects.value.splice(index, 1);
    }
    setHeight();
}
</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3>Location Name</h3>
            <h3></h3>
        </div>
        <div class="rows" ref="rows">
            <div class="row-container row" v-for="(item, index) in locationObjects" :key="index" @mouseover="hoverIndex = index"
                @mouseleave="hoverIndex = null">
                <div class="row-item">
                    <div class="input-container">
                        <input type="text" v-model="locationObjects[index].name"
                            style="all: unset; font-size: 14px; width: 100%;"
                            :data-testid="'setup-location-name-input-' + index" />
                    </div>
                </div>
                <div
                    style="padding: none; display: flex; flex-direction: row; align-items: center; justify-content: center;">
                    <IconCloseRound :class="{ 'hidden-icon': hoverIndex !== index }" class="icon-close-round"
                        @click="removeRow(index)" />
                </div>
            </div>
            <div class="add-container">
                <IconAddRound class="icon-add-round" @click="addRow" data-testid="setup-location-add-button" />
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

.column-titles {
    display: grid;
    grid-template-columns: 95% 5%;
    margin-bottom: 15px;
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