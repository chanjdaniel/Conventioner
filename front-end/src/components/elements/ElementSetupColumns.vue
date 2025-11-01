<script setup lang="ts">
import { ref, type Ref, onMounted, defineEmits, defineProps, toRef, nextTick, onUnmounted, watch } from 'vue';
import IconEdit from '@/components/icons/IconEdit.vue';
import { type SetupObject } from '@/assets/types/datatypes';
import IconInfo from '@/components/icons/IconInfo.vue';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(["update:setupObject"]);

const setupObject = toRef(props, "setupObject");
const inputColNames = toRef(setupObject.value, "colNames");
const colValues = toRef(setupObject.value, "colValues");
const colInclude = toRef(setupObject.value, "colInclude");

const updateSetupObject = () => {
    emit("update:setupObject", setupObject.value);
};

const container = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const textareas = ref<(HTMLTextAreaElement | null)[]>([]);

const rowsMaxHeight = ref<string | null>(null);

const infoVisible = ref(false);

const setHeight = () => {
    rowsMaxHeight.value = "0px";
    nextTick(() => {
        if (container.value && columnTitles.value && rows.value) {
            rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 15}px`;
        }
    });
};

const autoResize = (index: number) => {
    nextTick(() => {
        const textarea = textareas.value[index];
        if (textarea) {
            textarea.style.height = 'auto';
            if (textarea.style.height !== textarea.scrollHeight + 'px') {
                textarea.style.height = textarea.scrollHeight + 'px';
            }
        }
    });
};

onMounted(() => {
    setHeight();
    nextTick(() => {
        for (let i = 0; i < inputColNames.value.length; i++) {
            autoResize(i);
        }
        window.addEventListener('resize', setHeight)
    })
});

const doCheckbox = (index: number) => {
    colInclude.value[index] = !colInclude.value[index];
    updateSetupObject();
}

onUnmounted(() => {
    window.removeEventListener('resize', setHeight)
});

defineExpose({
    setHeight
});
</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3 class="title-row-item">Column names</h3>
            <!-- <h3>Data type</h3> -->
            <h3 class="title-row-item">Inspect data values</h3>
            <div class="info-icon-wrapper title-row-item" @mouseenter="infoVisible = true"
                @mouseleave="infoVisible = false">
                <IconInfo class="info-icon" />
                <div v-if="infoVisible" class="info-popup">
                    <p class="info-text">
                        Click the checkbox if you would like to include this column in the vendor info view. <br><br>
                        
                        It's recommended to include important info like names and contact info, and exlcude columns for
                        miscellaneous information like additional comments etc.<br><br>
                        
                        It's possible to come back and change these
                        settings later. All data will be available for the assignment process, this is just for hiding
                        unimportant information from view.
                    </p>
                </div>
            </div>
        </div>
        <div class="rows" ref="rows">
            <div class="row-container setup-row" v-for="(item, index) in inputColNames" :key="index">
                <div class="row-item text-item">
                    <h4 class="setup-row-colname">
                        <textarea class="colname-input" rows="1" v-model="inputColNames[index]"
                            :ref="(el) => { textareas[index] = el as HTMLTextAreaElement | null; }"
                            @blur="updateSetupObject()" @input="autoResize(index)">
                        </textarea>
                    </h4>
                    <div class="edit-icon-wrapper">
                        <IconEdit class="edit-icon" />
                    </div>
                </div>
                <div class="row-item enum-item">
                    <select class="datatype-dropdown">
                        <optgroup class="datatype-dropdown">
                            <option disabled value="">Values</option>
                            <option class="display-list" v-for="value in colValues[index]" :key="value" :value="value">
                                {{ value }}</option>
                        </optgroup>
                    </select>
                </div>
                <div class="include-checkbox-positioner" @click="doCheckbox(index)">
                    <div class="include-checkbox-container">
                        <input class="include-checkbox" type="checkbox" v-model="colInclude[index]"/>
                    </div>
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
    min-width: 24px;
    min-height: 24px;
    margin-left: 5px;
}

.info-icon {
    color: black;
    width: 20px;
    height: 20px;
}

.info-icon-wrapper {
    position: relative;
    min-width: 24px;
    min-height: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.info-popup {
    position: absolute;
    top: 100%;
    left: 100%;
    width: 200px;

    z-index: 10;
    background: #fff;
    color: #333;
    border: 1px solid #ccc;
    padding: 6px 10px;
    font-size: 14px;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.info-text {
    text-wrap: wrap;
    text-align: left;
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
    grid-template-columns: 50% auto 5%;
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

.rows {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}

.rows::-webkit-scrollbar {
  display: none; /* Chrome, Safari, and Opera */
}

.your-rows::-webkit-scrollbar {
  display: none;
}

.setup-row {
    display: grid;
    grid-template-columns: 50% auto 5%;
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

    padding-left: 8px;
    padding-right: 8px;
    justify-content: space-between;
    align-items: center;

    border-right: 3px solid var(--mm-grey);
}

.title-row-item {
    display: flex;
    flex-direction: row;

    justify-content: center;
    align-items: center;

    border-right: 3px solid none;
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
    font-size: 14px;
    padding-right: 5px;
    background-color: white;
}

.display-list {
    pointer-events: none;
}

.include-checkbox-positioner {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: top;
}

.include-checkbox-container {
    min-width: 24px;
    min-height: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}


</style>