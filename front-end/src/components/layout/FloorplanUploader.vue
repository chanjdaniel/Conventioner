<script setup lang="ts">
/**
 * A location's floorplan, uploaded for its market (T257): the venue's plan as an image or a page
 * of a PDF.
 *
 * It takes the file on the app's one drop zone (T205, F11 of the 2026-11-02 walk), as the import
 * and the start from a Google Form do, and checks the file itself, since the zone judges no file:
 *
 * - a file of any other type is refused with the type sentence;
 * - a PDF over the upload's 4 MB is refused here with its sentence, since a PDF is not drawn in the
 *   browser, and an image over it is shrunk before it is sent (`shrinkImage.ts`), since production
 *   refuses a request over 4.5 MB before the server reads it;
 * - the server's refusals (a PDF of too many pages, one it cannot read) are said as it words them.
 *
 * The error line is an alert, so a screen reader says a refusal as it appears. An image emits
 * `uploaded` once it is in; a PDF of one page too, and a PDF of several shows the page the server
 * drew, a choice of page and "Use page N", and emits the page chosen. The zone stays, busy, while
 * the file uploads and while the caller saves what was chosen (`busy`); an upload that fails leaves
 * it there with the error, so another file can be chosen.
 */
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { api, getApiErrorMessage } from '@/utils/api';
import FileDropZone from '@/components/FileDropZone.vue';
import { ImageTooLarge, MAX_UPLOAD_BYTES, shrinkToUpload } from './shrinkImage';
import type { UploadedFloorplan } from './layoutSave';

const props = defineProps<{
  /** The market the image is uploaded for: the server checks the caller's role on it. */
  marketId: string;
  /** The caller is saving what was chosen: the zone takes no other file meanwhile. */
  busy?: boolean;
}>();

const emit = defineEmits<{
  uploaded: [payload: UploadedFloorplan];
  error: [message: string];
}>();

const NOT_A_FLOORPLAN = 'This file is not a PNG, JPG, WebP or PDF.';
const PDF_TOO_LARGE =
  'This PDF is larger than 4 MB. Export the page with the plan on it as a PNG or a smaller PDF.';
const IMAGE_TOO_LARGE =
  'This image could not be made smaller than 4 MB. Export the plan at a smaller size.';
/** The PDF's pages are stored, but the first could not be fetched to preview it. */
const PAGE_NOT_SHOWN =
  'The floorplan was uploaded, but its page could not be shown. Choose the file again.';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const uploading = ref(false);
/** What the zone is doing while it is busy with the file: making it smaller, or sending it. */
const progress = ref('');
const error = ref('');
const previewUrl = ref('');
const pages = ref<UploadedFloorplan[]>([]);
const selectedPage = ref(0);
const pickerId = useId();

const zoneBusy = computed(() => uploading.value || Boolean(props.busy));

function isPdf(file: File): boolean {
  // The server also takes a PDF by its .pdf extension.
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isValidType(file: File): boolean {
  return ALLOWED_TYPES.includes(file.type) || isPdf(file);
}

function refuse(message: string) {
  error.value = message;
  emit('error', message);
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
  revokePreview();
}

/** Preview a PDF's page as the image the server drew and stored for it. */
async function previewStoredPage(page: UploadedFloorplan) {
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

/** The file as it is sent: an image over the limit shrunk, a PDF over it refused (null). */
async function sendable(file: File): Promise<File | null> {
  if (isPdf(file)) {
    if (file.size > MAX_UPLOAD_BYTES) {
      refuse(PDF_TOO_LARGE);
      return null;
    }
    return file;
  }
  if (file.size > MAX_UPLOAD_BYTES) progress.value = 'Making the image smaller';
  try {
    return await shrinkToUpload(file);
  } catch (e: unknown) {
    refuse(e instanceof ImageTooLarge ? IMAGE_TOO_LARGE : 'This image could not be read.');
    return null;
  }
}

async function handleFile(file: File) {
  if (!isValidType(file)) {
    forgetPages();
    refuse(NOT_A_FLOORPLAN);
    return;
  }

  error.value = '';
  uploading.value = true;
  forgetPages();

  try {
    const sent = await sendable(file);
    if (!sent) return;
    progress.value = 'Uploading';
    const formData = new FormData();
    formData.append('market_id', props.marketId);
    formData.append('file', sent);

    const { data } = await api.post('/floorplans/upload', formData);

    if (data.pages) {
      const drawn: UploadedFloorplan[] = data.pages.map((page: UploadedFloorplan, i: number) => ({
        gridfs_id: page.gridfs_id,
        width: page.width,
        height: page.height,
        page: i + 1,
      }));
      if (drawn.length === 1) {
        emit('uploaded', drawn[0]);
        return;
      }
      pages.value = drawn;
      try {
        await previewStoredPage(drawn[0]);
      } catch {
        forgetPages();
        refuse(PAGE_NOT_SHOWN);
      }
    } else {
      emit('uploaded', { gridfs_id: data.gridfs_id, width: data.width, height: data.height });
    }
  } catch (e: unknown) {
    forgetPages();
    refuse(getApiErrorMessage(e, 'The floorplan was not uploaded.'));
  } finally {
    uploading.value = false;
    progress.value = '';
  }
}

watch(selectedPage, (idx) => {
  const page = pages.value[idx];
  if (!page) return;
  previewStoredPage(page).catch((e: unknown) => {
    error.value = getApiErrorMessage(e, 'This page could not be shown.');
  });
});

function usePage() {
  const page = pages.value[selectedPage.value];
  if (page) emit('uploaded', page);
}

onUnmounted(() => {
  revokePreview();
});
</script>

<template>
  <div class="floorplan-uploader">
    <FileDropZone
      v-if="!pages.length"
      accept="image/png,image/jpeg,image/webp,application/pdf"
      label="Drop the floorplan's image or PDF here, or choose a file"
      hint="PNG, JPG, WebP or PDF, up to 4 MB; a larger image is made smaller for you."
      :busy="zoneBusy"
      testid="floorplan-upload-dropzone"
      input-testid="floorplan-upload-file-input"
      @file="handleFile"
    />

    <div v-else class="pdf-pages" data-testid="floorplan-upload-pages">
      <img
        v-if="previewUrl"
        :src="previewUrl"
        :alt="`Page ${selectedPage + 1} of the PDF`"
        class="preview-image"
      />
      <fieldset class="page-selector">
        <legend :id="pickerId" class="page-selector-label">Which page holds the plan?</legend>
        <label v-for="(page, i) in pages" :key="page.gridfs_id" class="page-option">
          <input
            type="radio"
            v-model="selectedPage"
            :value="i"
            class="page-radio"
            :name="pickerId"
          />
          <span class="page-number">{{ i + 1 }}</span>
        </label>
      </fieldset>
      <div class="pdf-actions">
        <button
          type="button"
          class="btn btn--primary"
          :disabled="busy"
          data-testid="floorplan-upload-use-page"
          @click="usePage"
        >
          Use page {{ selectedPage + 1 }}
        </button>
        <button type="button" class="btn btn--secondary" :disabled="busy" @click="forgetPages">
          Choose another file
        </button>
      </div>
    </div>

    <p v-if="uploading" class="upload-progress" data-testid="floorplan-upload-progress">
      <span class="progress-spinner" aria-hidden="true" />
      <span>{{ progress || 'Uploading' }}&hellip;</span>
    </p>

    <!-- An alert, so a screen reader says the refusal as it appears (T263's sweep). -->
    <p v-if="error" class="upload-error" role="alert" data-testid="floorplan-upload-error">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.floorplan-uploader {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-3);
  width: 100%;
}

/* The zone's own top margin keeps it off a heading above it elsewhere; here it heads the map
   column, level with the side panel's first card. */
.floorplan-uploader :deep(.file-drop-zone) {
  margin-top: 0;
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.page-selector {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: none;
}

.page-selector-label {
  float: left;
  margin-right: var(--space-2);
  padding: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.page-option {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--target-min);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.page-radio {
  cursor: pointer;
}

.pdf-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.upload-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
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

.upload-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
