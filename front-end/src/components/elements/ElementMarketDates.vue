<script setup lang="ts">
import { ref, onMounted, defineEmits, defineProps, toRef, nextTick, onUnmounted, watch } from 'vue';
import { type SetupObject, type MarketDateObject } from '@/assets/types/datatypes';
import IconAddRound from '../icons/IconAddRound.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const updateSetupObject = () => {
    emit("update:setupObject", setupObject.value);
};

const setupObject = toRef(props, "setupObject");
const marketDates = toRef(setupObject.value, "marketDates");
const colNames = toRef(setupObject.value, "colNames");

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
    resizeObserver.observe(document.body);
});

onUnmounted(() => {
    resizeObserver.disconnect();
});

watch(
    () => setupObject.value.marketDates,
    () => {
        emit("update:setupObject", setupObject.value);
    },
    { deep: true }
);

const hoverIndex = ref<number | null>(null);

const colDefault = "Select a column";

const removeRow = (index: number | null) => {
    if (index != null) {
        marketDates.value.splice(index, 1);
    }
    setHeight();
}

const addRow = () => {
    const newMarketDate: MarketDateObject = {
        date: "",
        colNameIdx: -1,
    };
    marketDates.value.push(newMarketDate);
    setHeight();
}

const getFormattedDate = (dateString: string) => {
    if (dateString === "") {
        return null;
    } else {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const now = new Date(dateString + "T00:00:00.000-08:00");
        return days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate();
    }
}
</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3>Date</h3>
            <h3>Name in input file</h3>
        </div>
        <div class="rows" ref="rows">
            <div class="row-container setup-row" v-for="(item, index) in marketDates" :key="index"
                @mouseover="hoverIndex = index" @mouseleave="hoverIndex = null">
                <div class="row-item text-item">
                    <h4 class=date-display>
                        {{ getFormattedDate(marketDates[index].date) }}
                    </h4>
                    <input type="date" class="colname-input date-input" v-model="marketDates[index].date"
                        onclick="this.showPicker()" />

                </div>
                <div class="row-item enum-item">
                    <select class="datatype-dropdown" v-model="marketDates[index].colNameIdx">
                        <optgroup class="datatype-dropdown">
                            <option disabled value="">Values</option>
                            <option class="display-list" v-for="(value, index) in colNames" :key="index" :value="index">
                                    {{ value }}
                            </option>
                        </optgroup>
                    </select>
                </div>
                <div
                    style="padding: none; display: flex; flex-direction: row; align-items: center; justify-content: center;">
                    <IconCloseRound :class="{ 'hidden-icon': hoverIndex !== index }" class="icon-close-round"
                        @click="removeRow(index)" />
                </div>
            </div>
            <div class="add-container">
                <IconAddRound class="icon-add-round" @click="addRow" />
            </div>
        </div>
    </div>
</template>

<style scoped>
option {
    text-align: left;
}

select {
    max-width: 100%;
    white-space: normal;
    /* For Firefox: */
    text-overflow: ellipsis;
}

h4 {
    width: 100%;
    display: flex;
    align-items: top;
    max-height: 200px;
    overflow-y: scroll;
    scrollbar-width: none;
}

.colname-input {
    width: 100%;
    border: none;
    resize: none;
    /* font: unset; */
    outline: none;
}

.date-input {
    text-align: center;
    text-justify: center;
    color: transparent;
    text-indent: -9999px;
    position: absolute;
    left: 0;
    width: 100%;
    background-color: transparent;
    padding-right: 5px;
    font-size: 16px;
}

.date-display {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    text-align: center;
    text-justify: center;
    padding: 5px;
    font-size: 16px;
}

.edit-icon {
    color: grey;
    min-width: 24px;
    min-height: 24px;
    margin-left: 5px;
}

.container {
    width: 100%;
    height: 100%;

    display: flex;
    flex-direction: column;
    align-items: center;

    gap: 15px;
}

.column-titles {
    display: grid;
    grid-template-columns: 47.5% 47.5% 5%;
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

.setup-row {
    display: grid;
    grid-template-columns: 47.5% 47.5% 5%;
    padding-top: 5px;
    padding-bottom: 5px;
}

.setup-row-colname {
    text-align: left;
    cursor: text;
}

.row-item {
    display: flex;
    flex-direction: row;
    position: relative;

    padding-left: 10px;
    padding-right: 5px;
    justify-content: space-between;
    align-items: center;

    border-right: 3px solid var(--mm-grey);
}

.row-item:last-of-type {
    border: none;
}

.text-item {
    cursor: text;
}

.enum-item {
    cursor: pointer;
}

.edit-icon-wrapper {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: top;
}

.datatype-dropdown {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    text-align: center;
    text-justify: center;
    border: none;
    outline: none;
    cursor: pointer;
    font-size: 16px;
    padding-right: 5px;
    text-align-last: center;
    background-color: white;
}

.display-list {
    pointer-events: none;
}

.icon-add-round {
    width: 40px;
    height: 40px;
    cursor: pointer;
}

.hidden-icon {
    visibility: hidden;
}

.icon-close-round {
    width: 20px;
    height: 20px;
    cursor: pointer;
}

.date-input,
.datatype-dropdown,
.datatype-dropdown option {
    font-family: inherit;
    font-size: 16px;
    color: #333;
}
</style>