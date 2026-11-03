<script setup lang="ts">
/**
 * The floorplan wizard's first step: the organizer's plan image or PDF, uploaded for the market.
 *
 * It takes the file on the app's one drop zone (T205, F11 of the 2026-11-02 walk), as the import
 * and the start from a Google Form do; it checks the file's type itself, since the zone judges no
 * file. The zone stays, busy, while the file uploads, and gives way to the preview once it is in;
 * an upload that fails leaves the zone there with the error, so another file can be chosen.
 *
 * An image previews as the file chosen. A PDF previews as the page the server drew from it,
 * following the page chosen, since a browser draws no PDF in an image. An upload that ends on
 * anything but a shown PDF page forgets the pages of the PDF before it, so no picker offers them.
 */
import { ref, watch, onUnmounted } from 'vue';
import { api, getApiErrorMessage } from '@/utils/api';
import FileDropZone from '@/components/FileDropZone.vue';

type UploadResult = {
  gridfs_id: string;
  width: number;
  height: number;
};

type PageResult = UploadResult & { page?: number };

const props = defineProps<{
  /** The market the image is uploaded for: the server checks the caller's role on it. */
  marketId: string;
}>();

const uploading = ref(false);
const error = ref('');
const previewUrl = ref('');
const pages = ref<PageResult[]>([]);
const selectedPage = ref(0);

const emit = defineEmits<{
  uploaded: [payload: { gridfs_id: string; width: number; height: number }];
  error: [message: string];
}>();

/** The PDF's pages are stored, but the first could not be fetched to preview it. */
const PAGE_NOT_SHOWN =
  'The floorplan was uploaded, but its page could not be shown. Choose the file again.';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

function isValidType(file: File): boolean {
  if (ALLOWED_TYPES.includes(file.type)) return true;
  // the backend also takes a PDF by its .pdf extension
  if (file.name.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
}

function forgetPages() {
  pages.value = [];
  selectedPage.value = 0;
}

/** Preview a PDF's page as the image the server drew and stored for it. */
async function previewStoredPage(page: PageResult) {
  const { data } = await api.get(`/floorplans/${page.gridfs_id}`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  if (pages.value[selectedPage.value]?.gridfs_id !== page.gridfs_id) {
    URL.revokeObjectURL(url);
    return;
  }
  revokePreview();
  previewUrl.value = url;
  error.value = '';
}

async function handleFile(file: File) {
  if (!isValidType(file)) {
    error.value = 'Unsupported file type. Please use PNG, JPG, WebP, or PDF.';
    emit('error', error.value);
    return;
  }

  error.value = '';
  uploading.value = true;

  try {
    const formData = new FormData();
    formData.append('market_id', props.marketId);
    formData.append('file', file);

    const { data } = await api.post('/floorplans/upload', formData);

    if (data.pages) {
      pages.value = data.pages;
      selectedPage.value = 0;
      try {
        await previewStoredPage(data.pages[0]);
      } catch {
        forgetPages();
        error.value = PAGE_NOT_SHOWN;
        emit('error', error.value);
        return;
      }
      emit('uploaded', data.pages[0]);
    } else {
      forgetPages();
      revokePreview();
      previewUrl.value = URL.createObjectURL(file);
      emit('uploaded', { gridfs_id: data.gridfs_id, width: data.width, height: data.height });
    }
  } catch (e: unknown) {
    forgetPages();
    error.value = getApiErrorMessage(e, 'The floorplan was not uploaded.');
    emit('error', error.value);
  } finally {
    uploading.value = false;
  }
}

watch(selectedPage, (idx) => {
  const page = pages.value[idx];
  if (!page) return;
  emit('uploaded', page);
  previewStoredPage(page).catch((e: unknown) => {
    error.value = getApiErrorMessage(e, 'This page could not be shown.');
  });
});

onUnmounted(() => {
  revokePreview();
});
</script>

<template>
  <div class="floorplan-uploader">
    <FileDropZone
      v-if="!previewUrl"
      accept="image/png,image/jpeg,image/webp,application/pdf"
      label="Drop a floorplan image or PDF here, or choose a file"
      hint="PNG, JPG, WebP or PDF."
      :busy="uploading"
      testid="floorplan-upload-dropzone"
      input-testid="floorplan-upload-file-input"
      @file="handleFile"
    />

    <div v-else class="preview">
      <img :src="previewUrl" alt="Floorplan preview" class="preview-image" />
      <div v-if="pages.length > 1" class="page-selector">
        <span class="page-selector-label">Page:</span>
        <label v-for="(page, i) in pages" :key="page.gridfs_id" class="page-option">
          <input type="radio" v-model="selectedPage" :value="i" class="page-radio" />
          <span class="page-number">{{ i + 1 }}</span>
        </label>
      </div>
    </div>

    <!-- Upload progress -->
    <div v-if="uploading" class="upload-progress" data-testid="floorplan-upload-progress">
      <span class="progress-spinner" />
      <span>Uploading&hellip;</span>
    </div>

    <!-- Error display -->
    <div v-if="error" class="upload-error" data-testid="floorplan-upload-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.floorplan-uploader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
}

/* ── Preview ────────────────────────────────────────────── */

.preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.preview-image {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

/* ── Page Selector ──────────────────────────────────────── */

.page-selector {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--mm-beige);
  border-radius: var(--radius-card);
}

.page-selector-label {
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--mm-black);
}

.page-option {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--mm-black);
}

.page-radio {
  cursor: pointer;
}

.page-number {
  user-select: none;
}

/* ── Upload Progress ────────────────────────────────────── */

.upload-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
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
  padding: var(--space-2) var(--space-3);
  background: color-mix(in srgb, var(--mm-yellow) 20%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  font-size: var(--text-xs);
  color: var(--mm-black);
  text-align: center;
}
</style>
