<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useDropZone, useFileDialog } from '@vueuse/core'
import { api } from '@/utils/api'

type UploadResult = {
  gridfs_id: string
  width: number
  height: number
}

type PageResult = UploadResult & { page?: number }

const dropZoneRef = ref<HTMLDivElement>()
const uploading = ref(false)
const error = ref('')
const uploadedFile = ref<File | null>(null)
const previewUrl = ref('')
const pages = ref<PageResult[]>([])
const selectedPage = ref(0)
const singleResult = ref<UploadResult | null>(null)

const emit = defineEmits<{
  uploaded: [payload: { gridfs_id: string; width: number; height: number }]
  error: [message: string]
}>()

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

function isValidType(file: File): boolean {
  if (ALLOWED_TYPES.includes(file.type)) return true
  // pdf2image on the backend also accepts .pdf by extension
  if (file.name.toLowerCase().endsWith('.pdf')) return true
  return false
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

async function handleFile(file: File) {
  if (!isValidType(file)) {
    error.value = 'Unsupported file type. Please use PNG, JPG, WebP, or PDF.'
    emit('error', error.value)
    return
  }

  revokePreview()
  uploadedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
  error.value = ''
  uploading.value = true

  try {
    const formData = new FormData()
    formData.append('file', file)

    const { data } = await api.post('/floorplans/upload', formData)

    if (data.pages) {
      pages.value = data.pages
      selectedPage.value = 0
      emit('uploaded', data.pages[0])
    } else {
      singleResult.value = {
        gridfs_id: data.gridfs_id,
        width: data.width,
        height: data.height,
      }
      emit('uploaded', singleResult.value)
    }
  } catch (e: any) {
    error.value = e.response?.data?.error || 'Upload failed'
    emit('error', error.value)
  } finally {
    uploading.value = false
  }
}

const { isOverDropZone } = useDropZone(dropZoneRef, {
  dataTypes: ALLOWED_TYPES,
  onDrop(files: File[] | null) {
    if (files?.length) handleFile(files[0])
  },
})

const { open: openFileDialog, onChange } = useFileDialog({
  accept: 'image/png,image/jpeg,image/webp,application/pdf',
  multiple: false,
})

onChange((files: FileList | null) => {
  if (files?.length) handleFile(files[0])
})

watch(selectedPage, (idx) => {
  if (pages.value[idx]) {
    emit('uploaded', pages.value[idx])
  }
})

onUnmounted(() => {
  revokePreview()
})
</script>

<template>
  <div class="floorplan-uploader">
    <div
      ref="dropZoneRef"
      class="drop-zone"
      :class="{ 'is-active': isOverDropZone, 'has-file': uploadedFile }"
    >
      <!-- Empty state: prompt to upload -->
      <div v-if="!uploadedFile" class="drop-zone-content">
        <i class="pi pi-cloud-upload drop-zone-icon" />
        <p class="drop-zone-text">Drag &amp; drop a floorplan image or PDF here</p>
        <p class="drop-zone-subtitle">or</p>
        <button class="browse-button" @click="openFileDialog">
          Browse Files
        </button>
        <p class="drop-zone-formats">PNG, JPG, WebP, PDF</p>
      </div>

      <!-- Uploaded state: preview -->
      <div v-else class="preview">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt="Floorplan preview"
          class="preview-image"
        />
        <div v-if="pages.length > 1" class="page-selector">
          <span class="page-selector-label">Page:</span>
          <label
            v-for="(page, i) in pages"
            :key="page.gridfs_id"
            class="page-option"
          >
            <input
              type="radio"
              v-model="selectedPage"
              :value="i"
              class="page-radio"
            />
            <span class="page-number">{{ i + 1 }}</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Upload progress -->
    <div v-if="uploading" class="upload-progress">
      <span class="progress-spinner" />
      <span>Uploading&hellip;</span>
    </div>

    <!-- Error display -->
    <div v-if="error" class="upload-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.floorplan-uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}

/* ── Drop Zone ──────────────────────────────────────────── */

.drop-zone {
  width: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  background: var(--mm-beige);
  border: 2px dashed var(--mm-grey);
  border-radius: 10px;
  transition:
    border-color 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
  cursor: pointer;
}

.drop-zone.is-active {
  border-color: var(--mm-green);
  background: color-mix(in srgb, var(--mm-beige) 80%, var(--mm-green));
}

.drop-zone.has-file {
  border-style: solid;
  border-color: transparent;
  background: transparent;
  cursor: default;
}

/* ── Empty State ────────────────────────────────────────── */

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.drop-zone-icon {
  font-size: 48px;
  color: var(--mm-grey);
  margin-bottom: 4px;
}

.drop-zone-text {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 16px;
  color: var(--mm-black);
  margin: 0;
}

.drop-zone-subtitle {
  font-size: 13px;
  color: var(--mm-grey);
  margin: 0;
}

.browse-button {
  width: 140px;
  height: 32px;

  background: var(--mm-green);
  border: none;
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-style: normal;
  font-weight: 400;
  font-size: 15px;
  line-height: 15px;
  text-align: center;
  color: #ffffff;

  cursor: pointer;
  transition:
    background-color 0.15s ease-in-out,
    opacity 0.15s ease-in-out;
}

.browse-button:hover {
  opacity: 0.9;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.drop-zone-formats {
  font-size: 12px;
  color: var(--mm-grey);
  margin: 0;
}

/* ── Preview ────────────────────────────────────────────── */

.preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.preview-image {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);
}

/* ── Page Selector ──────────────────────────────────────── */

.page-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--mm-beige);
  border-radius: 8px;
}

.page-selector-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-black);
}

.page-option {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--mm-black);
}

.page-radio {
  accent-color: var(--mm-green);
  cursor: pointer;
}

.page-number {
  user-select: none;
}

/* ── Upload Progress ────────────────────────────────────── */

.upload-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--mm-black);
}

.progress-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--mm-beige);
  border-top-color: var(--mm-green);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Error ──────────────────────────────────────────────── */

.upload-error {
  width: 100%;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--mm-yellow) 20%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;
  font-size: 13px;
  color: var(--mm-black);
  text-align: center;
}
</style>
