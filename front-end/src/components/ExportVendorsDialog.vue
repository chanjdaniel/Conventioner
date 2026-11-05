<script setup lang="ts">
/**
 * Export vendors (E42/F01/S01): the vendors a page shows, as a CSV for a Google Sheet and YAMM,
 * from the Vendors page or the Applications tab's All view (S03). A payment reminder is one
 * export: "Owes" and the amount still owed (S04).
 *
 * This is what the dialog asks of the server: it opens on the page's filters (`seed`), asks for the
 * preview as they and the columns change, and downloads the file, which the server builds from the
 * same filters as the preview. `ExportVendorsForm` draws it.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ExportVendorsForm from '@/components/ExportVendorsForm.vue';
import { getApiErrorMessage } from '@/utils/api';
import {
  chosenColumns,
  defaultOrder,
  downloadExport,
  fetchExportPreview,
  type ExportColumn,
  type ExportFilters,
  type ExportPreview,
} from '@/utils/vendorExport';

const props = defineProps<{ open: boolean; marketId: string; seed: ExportFilters }>();
const emit = defineEmits<{ close: [] }>();

/** A change asks again once typing pauses, not at every key. */
const PREVIEW_DELAY_MS = 250;

const filters = ref<ExportFilters>(copyOf(props.seed));
/** The ticked columns, in the file's order. */
const order = ref<ExportColumn[]>([]);
let started = false;
const preview = ref<ExportPreview | null>(null);
const previewError = ref('');
const error = ref('');
const busy = ref(false);
let asked = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function copyOf(seed: ExportFilters): ExportFilters {
  return {
    ...seed,
    statuses: [...seed.statuses],
    discord: [...seed.discord],
    answers: Object.fromEntries(Object.entries(seed.answers).map(([k, v]) => [k, [...v]])),
  };
}

const offered = computed(() => preview.value?.offered ?? null);
const columns = computed(() => chosenColumns(order.value));

async function ask(): Promise<void> {
  const mine = ++asked;
  try {
    // The first ask names no columns, and the server answers with its defaults ticked. So does an
    // ask with none chosen, for the count alone: the server refuses a file of no column, and the
    // cart already says to choose one. Its rows are of columns nobody chose, so they are not kept.
    const countAlone = started && !columns.value.length;
    const answer = await fetchExportPreview(
      props.marketId,
      filters.value,
      started && !countAlone ? columns.value : undefined,
    );
    if (mine !== asked) return;
    if (!started) {
      order.value = defaultOrder(answer.offered);
      started = true;
    }
    for (const question of answer.offered.questions) filters.value.answers[question.key] ??= [];
    preview.value = countAlone ? { ...answer, header: [], rows: [] } : answer;
    previewError.value = '';
  } catch (err: unknown) {
    if (mine !== asked) return;
    previewError.value = getApiErrorMessage(err, 'The preview could not be loaded.');
  }
}

function askSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void ask(), PREVIEW_DELAY_MS);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    filters.value = copyOf(props.seed);
    order.value = [];
    started = false;
    preview.value = null;
    previewError.value = '';
    error.value = '';
    void ask();
  },
  { immediate: true },
);

watch(
  [filters, columns],
  () => {
    if (props.open && preview.value) askSoon();
  },
  { deep: true },
);

onBeforeUnmount(() => clearTimeout(timer));

async function download(): Promise<void> {
  if (busy.value || !columns.value.length) return;
  busy.value = true;
  error.value = '';
  const refused = await downloadExport(props.marketId, filters.value, columns.value);
  busy.value = false;
  if (refused) {
    error.value = refused;
    return;
  }
  emit('close');
}
</script>

<template>
  <ExportVendorsForm
    v-model:filters="filters"
    v-model:order="order"
    :open="open"
    :offered="offered"
    :preview="preview"
    :preview-error="previewError"
    :error="error"
    :busy="busy"
    @close="emit('close')"
    @download="download"
  />
</template>
