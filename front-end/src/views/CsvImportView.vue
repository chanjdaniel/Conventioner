<script setup lang="ts">
/**
 * Importing vendors from the CSV a Google Form produced.
 *
 * A full-width flow rather than a dialog: mapping a dozen columns against a target list is too
 * dense for one, and Market Setup already carries dates, sections, tiers, priorities and the form
 * builder.
 *
 * The layout is a column ledger - one row per CSV column, in file order, each with a "Maps to"
 * control - with a rail tracking which required questions are still unserved. That shape won a
 * three-variant prototype because mappings are pre-filled on re-import, and a filled ledger is
 * scannable: the eye goes to the exceptions. Designs built around the act of assigning opened
 * with nothing left to assign.
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, getApiErrorMessage } from '@/utils/api';
import type { Market } from '@/assets/types/datatypes';

type Step = 'upload' | 'map' | 'preview' | 'done';

interface ImportTarget {
  key: string;
  label: string;
  required: boolean;
  kind: 'identity' | 'essential' | 'custom' | 'meta';
}

interface ImportFailure {
  row: number;
  email: string;
  error: string;
}

const router = useRouter();

/** The market in play, carried in localStorage the way every other organizer view reads it. */
const market = ref<Market | null>(null);
const marketId = computed(() => market.value?.id ?? '');

const step = ref<Step>('upload');
const busy = ref(false);
const error = ref('');
const fileName = ref('');
const csvContent = ref('');

const headers = ref<string[]>([]);
const sampleValues = ref<string[][]>([]);
const rowCount = ref(0);
const targets = ref<ImportTarget[]>([]);
/** Column index -> target key. The ledger is column-driven, so this is its natural direction. */
const columnTarget = ref<Record<number, string>>({});

const created = ref(0);
const updated = ref(0);
const failures = ref<ImportFailure[]>([]);

onMounted(() => {
  market.value = JSON.parse(localStorage.getItem('market') || 'null');
  if (!marketId.value) {
    error.value = 'No market is open. Open a market first, then import into it.';
  }
});

const requiredTargets = computed(() => targets.value.filter((t) => t.required));
const mappedKeys = computed(() => new Set(Object.values(columnTarget.value).filter(Boolean)));
const unservedRequired = computed(() =>
  requiredTargets.value.filter((t) => !mappedKeys.value.has(t.key)),
);
const canPreview = computed(() => unservedRequired.value.length === 0);

/** A target already taken by another column, so the ledger can grey it out. */
function takenBy(key: string, columnIndex: number): boolean {
  return Object.entries(columnTarget.value).some(
    ([index, value]) => value === key && Number(index) !== columnIndex,
  );
}

async function onFileChosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  fileName.value = file.name;
  csvContent.value = await file.text();
  await inspect();
}

async function inspect() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post(`/markets/${marketId.value}/applications/import/inspect`, {
      csvContent: csvContent.value,
    });
    headers.value = data.headers ?? [];
    sampleValues.value = data.sampleValues ?? [];
    rowCount.value = data.rowCount ?? 0;
    targets.value = data.targets ?? [];
    columnTarget.value = {};
    for (const [key, index] of Object.entries(data.suggestedMapping ?? {})) {
      columnTarget.value[Number(index)] = key;
    }
    step.value = 'map';
  } catch (e) {
    error.value = getApiErrorMessage(e, 'That file could not be read.');
  } finally {
    busy.value = false;
  }
}

async function runImport() {
  busy.value = true;
  error.value = '';
  try {
    const mapping: Record<string, number> = {};
    for (const [index, key] of Object.entries(columnTarget.value)) {
      if (key) mapping[key] = Number(index);
    }
    const { data } = await api.post(`/markets/${marketId.value}/applications/import`, {
      csvContent: csvContent.value,
      mapping,
    });
    created.value = data.created ?? 0;
    updated.value = data.updated ?? 0;
    failures.value = data.failures ?? [];
    step.value = 'done';
  } catch (e) {
    error.value = getApiErrorMessage(e, 'The import could not be completed.');
  } finally {
    busy.value = false;
  }
}

/** Sample cells for a column, with empties named rather than rendered as bare separators. */
function samplesFor(index: number): string {
  const values = (sampleValues.value[index] ?? []).filter((value) => value.trim() !== '');
  return values.length ? values.join(' · ') : 'no values in the first rows';
}

function startOver() {
  step.value = 'upload';
  fileName.value = '';
  csvContent.value = '';
  headers.value = [];
  failures.value = [];
  error.value = '';
}
</script>

<template>
  <div class="import-view" data-testid="import-view">
    <header class="import-header">
      <div>
        <h1>Import applications</h1>
        <p v-if="fileName" class="import-subtitle" data-testid="import-filename">{{ fileName }}</p>
      </div>
      <ol class="import-steps">
        <li :class="{ current: step === 'upload' }">1 Upload</li>
        <li :class="{ current: step === 'map' }">2 Map columns</li>
        <li :class="{ current: step === 'preview' }">3 Preview</li>
        <li :class="{ current: step === 'done' }">4 Confirm</li>
      </ol>
    </header>

    <p v-if="error" class="import-error" data-testid="import-error">{{ error }}</p>

    <!-- 1. Upload -->
    <section v-if="step === 'upload'" class="import-panel" data-testid="import-upload">
      <h2>Choose the CSV your form produced</h2>
      <p class="import-help">
        Export your Google Form responses as CSV and choose the file here. Nothing is written until
        you confirm.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        :disabled="busy"
        data-testid="import-file-input"
        @change="onFileChosen"
      />
    </section>

    <!-- 2. Map columns -->
    <section v-if="step === 'map'" class="import-map" data-testid="import-map">
      <div class="import-ledger">
        <h2>{{ headers.length }} columns in this file</h2>
        <p class="import-help">
          Every column, in file order. Leave a column unmapped to ignore it.
        </p>
        <table class="ledger-table">
          <thead>
            <tr>
              <th>CSV column</th>
              <th>First rows</th>
              <th>Maps to</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(header, index) in headers" :key="index" data-testid="import-column-row">
              <td class="ledger-header">{{ header || `(column ${index + 1})` }}</td>
              <td
                class="ledger-samples"
                :class="{ empty: samplesFor(index) === 'no values in the first rows' }"
              >
                {{ samplesFor(index) }}
              </td>
              <td>
                <select
                  v-model="columnTarget[index]"
                  class="ledger-select"
                  :data-testid="`import-target-select-${index}`"
                >
                  <option value="">Ignore this column</option>
                  <option
                    v-for="target in targets"
                    :key="target.key"
                    :value="target.key"
                    :disabled="takenBy(target.key, index)"
                  >
                    {{ target.label }}{{ target.required ? ' *' : '' }}
                  </option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="import-rail">
        <h3>Required questions</h3>
        <ul class="rail-list">
          <li
            v-for="target in requiredTargets"
            :key="target.key"
            :class="{ served: mappedKeys.has(target.key) }"
            data-testid="import-required-target"
          >
            <span class="rail-tick">{{ mappedKeys.has(target.key) ? '✓' : '○' }}</span>
            {{ target.label }}
          </li>
        </ul>
        <p v-if="canPreview" class="rail-ok" data-testid="import-all-mapped">
          All required questions are mapped.
        </p>
        <p v-else class="rail-warning" data-testid="import-unmapped-warning">
          Still unmapped: {{ unservedRequired.map((t) => t.label).join(', ') }}
        </p>
      </aside>
    </section>

    <!-- 3. Preview -->
    <section v-if="step === 'preview'" class="import-panel" data-testid="import-preview">
      <h2>Ready to import {{ rowCount }} row{{ rowCount === 1 ? '' : 's' }}</h2>
      <p class="import-help">
        Each row becomes an application awaiting your review. Nothing has been written yet.
      </p>
      <ul class="preview-mapping">
        <li v-for="target in targets" :key="target.key" v-show="mappedKeys.has(target.key)">
          <strong>{{ target.label }}</strong>
          <span>
            {{
              headers[Number(Object.entries(columnTarget).find(([, k]) => k === target.key)?.[0])]
            }}
          </span>
        </li>
      </ul>
    </section>

    <!-- 4. Done -->
    <section v-if="step === 'done'" class="import-panel" data-testid="import-done">
      <h2 data-testid="import-result-summary">
        Imported {{ created }} new application{{ created === 1 ? '' : 's'
        }}<span v-if="updated">, updated {{ updated }}</span
        >.
      </h2>
      <div v-if="failures.length" class="import-failures" data-testid="import-failures">
        <h3>{{ failures.length }} row{{ failures.length === 1 ? '' : 's' }} skipped</h3>
        <p class="import-help">
          These were not imported. Fix them in your spreadsheet and import again.
        </p>
        <ul>
          <li v-for="failure in failures" :key="failure.row" data-testid="import-failure-row">
            <strong>Row {{ failure.row }}</strong>
            <span v-if="failure.email"> ({{ failure.email }})</span>: {{ failure.error }}
          </li>
        </ul>
      </div>
    </section>

    <footer class="import-actions">
      <button
        v-if="step !== 'upload'"
        class="button-secondary"
        data-testid="import-back-button"
        @click="step === 'map' ? startOver() : (step = step === 'preview' ? 'map' : 'preview')"
      >
        Back
      </button>
      <button
        v-if="step === 'map'"
        class="button-primary"
        :disabled="!canPreview || busy"
        data-testid="import-preview-button"
        @click="step = 'preview'"
      >
        Preview import
      </button>
      <button
        v-if="step === 'preview'"
        class="button-primary"
        :disabled="busy"
        data-testid="import-confirm-button"
        @click="runImport"
      >
        Import {{ rowCount }} row{{ rowCount === 1 ? '' : 's' }}
      </button>
      <button
        v-if="step === 'done'"
        class="button-primary"
        data-testid="import-finish-button"
        @click="router.push({ name: 'market-setup' })"
      >
        Back to market setup
      </button>
    </footer>
  </div>
</template>

<style scoped>
.import-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 32px 96px;
  font-family: 'Outfit Regular';
  color: var(--mm-black);
}

.import-header {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--mm-grey, #ddd);
  padding-bottom: 16px;
}

.import-header h1 {
  margin: 0;
  font-size: 24px;
}

.import-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--mm-grey, #666);
}

.import-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
  color: var(--mm-grey, #888);
}

.import-steps .current {
  color: var(--mm-black);
  font-weight: bold;
}

.import-error {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid var(--mm-red, #cc0000);
  border-radius: 6px;
  color: var(--mm-red, #cc0000);
  font-size: 14px;
}

.import-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 720px;
}

.import-panel h2 {
  margin: 0;
  font-size: 18px;
}

.import-help {
  margin: 0;
  font-size: 13px;
  color: var(--mm-grey, #666);
}

.import-map {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 280px);
  gap: 24px;
  align-items: start;
}

.import-ledger h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 14px;
}

.ledger-table th {
  text-align: left;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-grey, #888);
  padding: 8px 10px;
  border-bottom: 1px solid var(--mm-grey, #ddd);
}

.ledger-table td {
  padding: 10px;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
}

.ledger-header {
  font-weight: bold;
  max-width: 260px;
}

.ledger-samples.empty {
  font-style: italic;
  color: var(--mm-grey, #aaa);
}

.ledger-samples {
  color: var(--mm-grey, #666);
  font-size: 13px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ledger-select {
  width: 100%;
  max-width: 260px;
  height: 34px;
  padding: 4px 8px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 5px;
  background: white;
}

.import-rail {
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.import-rail h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.rail-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}

.rail-tick {
  display: inline-block;
  width: 16px;
  color: var(--mm-grey, #aaa);
}

.rail-list .served .rail-tick {
  color: var(--mm-green, #2e7d4f);
}

.rail-ok {
  margin: 0;
  font-size: 13px;
  color: var(--mm-green, #2e7d4f);
}

.rail-warning {
  margin: 0;
  font-size: 13px;
  color: var(--mm-red, #cc0000);
}

.preview-mapping {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}

.preview-mapping li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 5px;
  background: white;
}

.preview-mapping span {
  color: var(--mm-grey, #666);
}

.import-failures {
  margin-top: 8px;
  border: 1px solid var(--mm-red, #cc0000);
  border-radius: 6px;
  padding: 12px 14px;
}

.import-failures h3 {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--mm-red, #cc0000);
}

.import-failures ul {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.import-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  border-top: 1px solid var(--mm-grey, #ddd);
  padding-top: 16px;
}

.button-primary,
.button-secondary {
  height: 38px;
  padding: 0 18px;
  border-radius: 6px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  cursor: pointer;
  border: 1px solid var(--mm-grey, #b0b0b0);
  background: white;
}

.button-primary {
  background: var(--mm-green, #2e7d4f);
  border-color: var(--mm-green, #2e7d4f);
  color: white;
}

.button-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .import-map {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
