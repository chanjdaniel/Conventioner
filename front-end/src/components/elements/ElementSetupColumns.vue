<script setup lang="ts">
import { ref, onMounted, defineEmits, defineProps, toRef, nextTick, onUnmounted } from 'vue';
import IconEdit from '../icons/IconEdit.vue';
import { type SetupObject } from '@/views/MarketSetupView.vue';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const inputColNames = toRef(setupObject.value, "colNames");
const colValues = toRef(setupObject.value, "colValues");

const updateSetupObject = () => {
    emit("update:setupObject", setupObject.value);
};

const container = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const textareas = ref<(HTMLTextAreaElement | null)[]>([]);

const rowsMaxHeight = ref<string | null>(null);

const setHeight = () => {
    if (container.value && columnTitles.value && rows.value) {
        rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 15}px`;
    }
};

const autoResize = (index: number) => {
      nextTick(() => {
        const textarea = textareas.value[index];
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
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
</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3>Column names</h3>
            <!-- <h3>Data type</h3> -->
            <h3>Inspect data values</h3>
        </div>
        <div class="rows" ref="rows">
            <div class="row-container setup-row" v-for="(item, index) in inputColNames" :key="index">
                <div class="row-item text-item">
                    <h4 class="setup-row-colname">
                        <textarea
                            class="colname-input"
                            rows="1"
                            v-model="inputColNames[index]"
                            :ref="(el) => { textareas[index] = el as HTMLTextAreaElement | null; }"
                            @blur="updateSetupObject()"
                            @input="autoResize(index)"
                            @click="autoResize(index)">
                        </textarea>
                    </h4>
                    <div class="edit-icon-wrapper"><IconEdit class="edit-icon" /></div></div>
                <div class="row-item enum-item">
                    <select class="datatype-dropdown">
                        <option disabled value="">Values</option>
                        <option class="display-list" v-for="value in colValues[index]" :key="value" :value="value">{{ value }}</option>
                    </select>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>

    option {
        text-align: left;
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
        font: unset;
        outline: none;
    }

    .edit-icon {
        color: grey;
        min-width: 24px;;
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
        grid-template-columns: 50% auto;
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
        grid-template-columns: 50% auto;
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
        align-items: center;
        border: none;
        outline: none;
        cursor: pointer;
        font-size: 12px;
        padding-right: 5px;
    }

    .display-list {
        pointer-events: none;
    }
</style>