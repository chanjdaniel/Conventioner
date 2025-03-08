<script setup lang="ts">
    import { ref, onMounted, defineEmits, defineProps, toRef } from 'vue';
    import { nextTick } from 'vue';
    import IconEdit from '../icons/IconEdit.vue';
    import { type SetupObject } from '@/views/MarketSetupView.vue';

    // handle reactivity for setupObject

    const props = defineProps<{ setupObject: SetupObject }>();
    const emit = defineEmits(["update:setupObject"]);
    const localSetupObject = ref(props.setupObject);
    const inputColNames = toRef(localSetupObject.value, "colNames");

    const updateSetupObject= () => {
        emit("update:setupObject", localSetupObject.value);
    };

    // dynamically resize row

    const container = ref<HTMLElement | null>(null);
    const columnTitles = ref<HTMLElement | null>(null);
    const rows = ref<HTMLElement | null>(null);
    const rowsMaxHeight = ref<string | null>(null);

    const setHeight = () => {
        if (container.value && columnTitles.value && rows.value) {
            const containerHeight = container.value.clientHeight;
            const columnTitlesHeight = columnTitles.value.clientHeight;
            rowsMaxHeight.value = `${containerHeight - columnTitlesHeight - 15}px`;
        }
    };

    onMounted(() => {
        setHeight();
        window.addEventListener('resize', setHeight);
    });

    // resize text area

    const textareas = ref<(HTMLTextAreaElement | null)[]>([]);

    const autoResize = (index: number) => {
      nextTick(() => {
        const textarea = textareas.value[index];
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
        }
      });
    };

    onMounted(() => {
        nextTick(() => {
            inputColNames.value.forEach((_, index) => autoResize(index));
        });
    });

</script>

<template>
    <div class="container" ref="container">
        <div class="column-titles row-container" ref="columnTitles">
            <h3>Column</h3>
            <h3>Data type</h3>
            <h3>Data values</h3>
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
                            @input="autoResize(index)">
                        </textarea>
                    </h4>
                    <div class="edit-icon-wrapper"><IconEdit class="edit-icon" /></div></div>
                <div class="row-item enum-item"><h4 class="setup-row-datatype">temp</h4></div>
                <div class="row-item enum-item"><h4>temp</h4></div>
            </div>
        </div>
    </div>
</template>

<style scoped>

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
        grid-template-columns: 40% 30% 30%;
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
        grid-template-columns: 40% 30% 30%;
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
</style>