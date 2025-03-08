<script setup lang="ts">
import Papa from 'papaparse';

import IconImport from '@/components/icons/IconImport.vue';

import { useDropZone } from '@vueuse/core'
import { useFileDialog } from '@vueuse/core'
import { shallowRef, useTemplateRef, ref, defineEmits } from 'vue';

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits(['file-uploaded']);

const fileData = shallowRef<{ name: string, size: number, type: string, lastModified: number, data: any }>()
const dropZoneRef = useTemplateRef<HTMLElement>('dropZoneRef')

const { isOverDropZone } = useDropZone(dropZoneRef, { dataTypes: ['text/csv'], onDrop: onDrop })

const { files, open, onChange } = useFileDialog({
  accept: 'text/csv',
  directory: false,
})

interface FileData {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  data: any;
}

function onDrop(files: File[] | null) {
  const file = files ? files[0] : null;
  handleUpload(file);
}

onChange((files: FileList | null) => {
  const file = files ? files[0] : null;
  handleUpload(file);
});

async function handleUpload(file: File | null) {
  if (file) {
    fileData.value = await (async (file): Promise<FileData> => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      data: await readCSVFile(file),
    }))(file);

    emit('file-uploaded', fileData.value);
  }
}

const readCSVFile = (file: File) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text: string = reader.result ? reader.result as string : "";
      const result = Papa.parse(text, { header: true });
      resolve(result);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
};

</script>

<template>
    <div
        class="file-container"
        :style="{ opacity: isOpen ? '100%' : '0%' }"
        ref="dropZoneRef">
        <div class="file-drop-icons">
            <IconImport />
            <h3>
                <span><button class="file-button" type="button" @click="open()">Choose a file</button></span>
                <span class="file-text"> or drag it here </span>
            </h3>
        </div>
    </div>
</template>

<style scoped>
    .file-container {
        width: 50%;
        height: 50%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: var(--mm-beige);
        z-index: 1;

        border-radius: 10px;
        border-style: dashed;
        border-width: 1px;
    }

    .file-drop-icons {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;

        width: 100%;

        gap: 10px;
    }

    .file-button {
    width: 120px;
    height: 25px;

    background: var(--mm-green);
    border-radius: 5px;
    border: none;

    font-family: 'Merge One';
    font-style: normal;
    font-weight: 400;
    font-size: 15px;
    line-height: 15px;
    text-align: center;

    color: #FFFFFF;
    }
</style>