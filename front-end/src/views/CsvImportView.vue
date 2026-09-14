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
import {
  AVAILABLE_DATES_KEY,
  SECTION_RANKING_KEY,
  TABLE_CHOICES,
  TABLE_TYPE_RANKING_KEY,
  TIER_PREFERENCE_KEY,
} from '@/utils/essentialFields';

/** Targets whose answer is several values, so one column holds a comma-separated list. */
const MULTI_VALUE_TARGETS = new Set<string>([
  AVAILABLE_DATES_KEY,
  TIER_PREFERENCE_KEY,
  SECTION_RANKING_KEY,
  TABLE_TYPE_RANKING_KEY,
]);

type Step = 'upload' | 'map' | 'preview' | 'done';

/** Sentinel for "this value means nothing; leave it out" - distinct from "not yet decided". */
const IGNORE_VALUE = '__ignore__';

interface ImportTarget {
  key: string;
  label: string;
  required: boolean;
  kind: 'identity' | 'essential' | 'custom' | 'meta';
}

/** Several columns that are one question: a Google Forms checkbox or multiple-choice grid. */
interface ColumnGroup {
  stem: string;
  columns: number[];
  options: string[];
}

/** A cell value that names nothing this market offers, and how many rows carry it. */
interface UnmatchedValue {
  target: string;
  targetLabel: string;
  value: string;
  rows: number;
  offered: string[];
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

/**
 * Importing belongs to the phases that take applications. The server enforces this - all three
 * import endpoints are reachable directly, and a hidden button is not a rule - but saying so
 * before the organizer picks a file beats letting them choose one and then refusing it.
 */
const INTAKE_PHASES = ['applications_open', 'applications_closed'];
const marketPhase = computed(() => String((market.value as { phase?: string })?.phase ?? ''));
const takingApplications = computed(() => INTAKE_PHASES.includes(marketPhase.value));

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
const groups = ref<ColumnGroup[]>([]);
/** A previous import's decisions, re-applied to this file. */
const restoredTargets = ref<Set<string>>(new Set());
const restoredMissing = ref<Array<{ target: string; missingHeaders: string[] }>>([]);
const newHeaders = ref<string[]>([]);
const hasSavedMapping = ref(false);
/** Group stem -> target key: a grid is mapped once, for all of its columns at a time. */
const groupTarget = ref<Record<string, string>>({});
/** Stems the organizer has broken apart, when the detection guessed wrong. */
const splitStems = ref<Set<string>>(new Set());

const unmatched = ref<UnmatchedValue[]>([]);
/** target -> raw value -> the market's own name for it, or '' meaning "ignore this value". */
const resolutions = ref<Record<string, Record<string, string>>>({});

const created = ref(0);
const updated = ref(0);
const failures = ref<ImportFailure[]>([]);
/** What the dry run said would import, and what it said would be skipped. */
const validRows = ref(0);
const previewFailures = ref<ImportFailure[]>([]);
/** How the file lands against what is already here. */
const newRows = ref(0);
const updatedRows = ref(0);
const absentApplications = ref(0);
const absentEmails = ref<string[]>([]);
const returningToReview = ref(0);
const returningEmails = ref<string[]>([]);

onMounted(() => {
  market.value = JSON.parse(localStorage.getItem('market') || 'null');
  if (!marketId.value) {
    error.value = 'No market is open. Open a market first, then import into it.';
  }
});

const activeGroups = computed(() => groups.value.filter((g) => !splitStems.value.has(g.stem)));
const groupedColumns = computed(
  () => new Set(activeGroups.value.flatMap((group) => group.columns)),
);

/** The ledger in render order: a grid appears once, at its first column's position. */
const ledgerRows = computed(() => {
  const byFirstColumn = new Map(activeGroups.value.map((g) => [g.columns[0], g]));
  const rows: Array<{ kind: 'group'; group: ColumnGroup } | { kind: 'column'; index: number }> = [];
  headers.value.forEach((_header, index) => {
    const group = byFirstColumn.get(index);
    if (group) {
      rows.push({ kind: 'group', group });
    } else if (!groupedColumns.value.has(index)) {
      rows.push({ kind: 'column', index });
    }
  });
  return rows;
});

const requiredTargets = computed(() => targets.value.filter((t) => t.required));
const mappedKeys = computed(
  () =>
    new Set(
      [
        ...Object.entries(columnTarget.value)
          .filter(([index]) => !groupedColumns.value.has(Number(index)))
          .map(([, key]) => key),
        ...activeGroups.value.map((g) => groupTarget.value[g.stem]),
      ].filter(Boolean),
    ),
);

/** What shape a mapped target is being read from, said plainly so a wrong guess is visible. */
function shapeLabel(group: ColumnGroup): string {
  return `${group.columns.length} columns · one per option`;
}

function singleShapeLabel(index: number): string {
  const key = columnTarget.value[index];
  return key && MULTI_VALUE_TARGETS.has(key) ? '1 column · values split on commas' : '';
}

/** The unmatched values belonging to whatever target this ledger row is mapped to. */
function unmatchedFor(key: string | undefined): UnmatchedValue[] {
  if (!key) return [];
  return unmatched.value.filter((entry) => entry.target === key);
}

/** Was this row's target restored from last time, rather than chosen just now? */
function isRestored(key: string | undefined): boolean {
  return !!key && restoredTargets.value.has(key);
}

/**
 * A value to resolve an unmatched cell to, as a person would say it.
 *
 * Dates, tiers and sections are the organizer's own names and read fine as they are. Table choice is
 * the exception: it is stored as `full` / `half` / `either`, which is the contract's vocabulary, not
 * anybody's - and that is what the resolution dropdown was offering.
 */
function choiceLabel(value: string): string {
  return TABLE_CHOICES.find((c) => c.value === value)?.label ?? value;
}

function labelForTarget(key: string): string {
  return targets.value.find((t) => t.key === key)?.label ?? key;
}

/**
 * Which column, or columns, a target is being read from - said the way the ledger said it.
 *
 * The preview used to look only in `columnTarget`, so a target fed by a grid showed nothing at all
 * while every single-column target named its source. A blank reads as "not mapped" at the exact
 * moment the organizer is confirming that rows will be written.
 */
function sourceLabelFor(key: string): string {
  const group = activeGroups.value.find((g) => groupTarget.value[g.stem] === key);
  if (group) {
    return `${group.stem} (${group.columns.length} columns)`;
  }
  const index = Object.entries(columnTarget.value).find(([, k]) => k === key)?.[0];
  return index === undefined ? '' : (headers.value[Number(index)] ?? '');
}

function isNewHeader(index: number): boolean {
  return newHeaders.value.includes((headers.value[index] ?? '').trim());
}

function resolutionFor(target: string, value: string): string {
  return resolutions.value[target]?.[value] ?? '';
}

function setResolution(target: string, value: string, choice: string) {
  resolutions.value = {
    ...resolutions.value,
    [target]: { ...(resolutions.value[target] ?? {}), [value]: choice },
  };
}

const unresolvedCount = computed(
  () => unmatched.value.filter((e) => resolutionFor(e.target, e.value) === '').length,
);

function splitGroup(stem: string) {
  const next = new Set(splitStems.value);
  next.add(stem);
  splitStems.value = next;
  delete groupTarget.value[stem];
}
const unservedRequired = computed(() =>
  requiredTargets.value.filter((t) => !mappedKeys.value.has(t.key)),
);
const canPreview = computed(() => unservedRequired.value.length === 0);

/** A target already taken elsewhere, so the ledger can grey it out. */
function takenBy(key: string, columnIndex: number | null, stem: string | null): boolean {
  const byColumn = Object.entries(columnTarget.value).some(
    ([index, value]) =>
      value === key && Number(index) !== columnIndex && !groupedColumns.value.has(Number(index)),
  );
  const byGroup = Object.entries(groupTarget.value).some(
    ([groupStem, value]) => value === key && groupStem !== stem,
  );
  return byColumn || byGroup;
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
    groups.value = data.groups ?? [];
    groupTarget.value = {};
    splitStems.value = new Set();
    columnTarget.value = {};
    groupTarget.value = {};
    unmatched.value = [];
    resolutions.value = {};
    for (const [key, index] of Object.entries(data.suggestedMapping ?? {})) {
      columnTarget.value[Number(index)] = key;
    }

    // A previous import's decisions win over the auto-detected two: the organizer already said
    // what these columns mean, and re-asking is the friction this remembers them to avoid.
    hasSavedMapping.value = data.hasSavedMapping === true;
    restoredMissing.value = data.restoredTargetsMissingColumns ?? [];
    newHeaders.value = data.newHeaders ?? [];
    restoredTargets.value = new Set(Object.keys(data.restoredMapping ?? {}));
    const groupByFirstColumn = new Map(
      (groups.value ?? []).map((group) => [group.columns[0], group]),
    );
    for (const [key, indexes] of Object.entries(
      (data.restoredMapping ?? {}) as Record<string, number[]>,
    )) {
      const group = groupByFirstColumn.get(indexes[0]);
      if (group && group.columns.length === indexes.length) {
        groupTarget.value[group.stem] = key;
      } else {
        columnTarget.value[indexes[0]] = key;
      }
    }
    resolutions.value = Object.fromEntries(
      Object.entries(
        (data.restoredResolutions ?? {}) as Record<string, Record<string, string | null>>,
      ).map(([target, byValue]) => [
        target,
        Object.fromEntries(
          Object.entries(byValue).map(([value, choice]) => [value, choice ?? IGNORE_VALUE]),
        ),
      ]),
    );
    step.value = 'map';
  } catch (e) {
    error.value = getApiErrorMessage(e, 'That file could not be read.');
  } finally {
    busy.value = false;
  }
}

function currentMapping(): Record<string, number | number[]> {
  const mapping: Record<string, number | number[]> = {};
  for (const [index, key] of Object.entries(columnTarget.value)) {
    if (key && !groupedColumns.value.has(Number(index))) mapping[key] = Number(index);
  }
  for (const group of activeGroups.value) {
    const key = groupTarget.value[group.stem];
    if (key) mapping[key] = group.columns;
  }
  return mapping;
}

/** Values the organizer has spoken for, in the shape the back end expects ('' means ignore). */
function currentResolutions(): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const [target, byValue] of Object.entries(resolutions.value)) {
    out[target] = {};
    for (const [value, choice] of Object.entries(byValue)) {
      if (choice !== '') out[target][value] = choice === IGNORE_VALUE ? null : choice;
    }
  }
  return out;
}

/**
 * Ask which cell values name nothing this market offers, before anything is written. Unresolved
 * values keep the organizer on the mapping step, with each one shown in the row that owns it.
 */
async function checkValues() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post(`/markets/${marketId.value}/applications/import/preview`, {
      csvContent: csvContent.value,
      mapping: currentMapping(),
      resolutions: currentResolutions(),
    });
    unmatched.value = data.unmatched ?? [];
    validRows.value = data.validRows ?? 0;
    previewFailures.value = data.failures ?? [];
    newRows.value = data.newRows ?? 0;
    updatedRows.value = data.updatedRows ?? 0;
    absentApplications.value = data.absentApplications ?? 0;
    absentEmails.value = data.absentEmails ?? [];
    returningToReview.value = data.returningToReview ?? 0;
    returningEmails.value = data.returningEmails ?? [];
    if (unmatched.value.length === 0) step.value = 'preview';
  } catch (e) {
    error.value = getApiErrorMessage(e, 'That file could not be checked.');
  } finally {
    busy.value = false;
  }
}

async function runImport() {
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post(`/markets/${marketId.value}/applications/import`, {
      csvContent: csvContent.value,
      mapping: currentMapping(),
      resolutions: currentResolutions(),
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

    <!-- Not taking applications: say so instead of offering a file picker. -->
    <section
      v-if="step === 'upload' && marketId && !takingApplications"
      class="import-panel"
      data-testid="import-wrong-phase"
    >
      <h2>This market is not taking applications right now</h2>
      <p class="import-help">
        Importing changes who has applied, so it belongs to the phases where the market is open to
        applications. Move the market back to
        <strong>applications closed</strong> and you can import again.
      </p>
    </section>

    <!-- 1. Upload -->
    <section
      v-if="step === 'upload' && takingApplications"
      class="import-panel"
      data-testid="import-upload"
    >
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
        <div v-if="hasSavedMapping" class="import-restored" data-testid="import-restored-banner">
          <strong>Restored from your last import.</strong>
          <span v-if="restoredMissing.length" data-testid="import-restored-missing">
            <template v-for="(entry, position) in restoredMissing" :key="entry.target">
              {{ position ? '; ' : '' }}{{ labelForTarget(entry.target) }} lost
              {{ entry.missingHeaders.join(', ') }}
            </template>
            - map {{ restoredMissing.length === 1 ? 'it' : 'them' }} again.
          </span>
          <span v-if="newHeaders.length" data-testid="import-restored-new">
            {{ newHeaders.length }} column{{ newHeaders.length === 1 ? ' is' : 's are' }} new since
            then.
          </span>
        </div>
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
            <template
              v-for="row in ledgerRows"
              :key="row.kind === 'group' ? row.group.stem : row.index"
            >
              <!-- A grid: one question spread across several columns, mapped once. -->
              <template v-if="row.kind === 'group'">
                <tr class="ledger-group-row" data-testid="import-group-row">
                  <td class="ledger-header">
                    {{ row.group.stem }}
                    <span
                      v-if="isRestored(groupTarget[row.group.stem])"
                      class="ledger-badge"
                      data-testid="import-restored-badge"
                    >
                      restored from last import
                    </span>
                    <span class="ledger-shape" data-testid="import-group-shape">
                      {{ shapeLabel(row.group) }}
                    </span>
                  </td>
                  <td class="ledger-samples">
                    <button
                      class="ledger-split"
                      :data-testid="`import-split-group-${row.group.columns[0]}`"
                      @click="splitGroup(row.group.stem)"
                    >
                      Not one question - split
                    </button>
                  </td>
                  <td>
                    <select
                      v-model="groupTarget[row.group.stem]"
                      class="ledger-select"
                      :data-testid="`import-group-select-${row.group.columns[0]}`"
                    >
                      <option value="">Ignore these columns</option>
                      <option
                        v-for="target in targets"
                        :key="target.key"
                        :value="target.key"
                        :disabled="takenBy(target.key, null, row.group.stem)"
                      >
                        {{ target.label }}{{ target.required ? ' *' : '' }}
                      </option>
                    </select>

                    <!-- Values the market does not recognise, fixed in the row that owns them. -->
                    <div
                      v-if="unmatchedFor(groupTarget[row.group.stem]).length"
                      class="ledger-fixes"
                      data-testid="import-value-fixes"
                    >
                      <p class="ledger-fixes-title">
                        {{ unmatchedFor(groupTarget[row.group.stem]).length }} value{{
                          unmatchedFor(groupTarget[row.group.stem]).length === 1 ? '' : 's'
                        }}
                        did not match your market
                      </p>
                      <div
                        v-for="entry in unmatchedFor(groupTarget[row.group.stem])"
                        :key="entry.value"
                        class="ledger-fix"
                      >
                        <code :data-testid="`import-unmatched-value`">{{ entry.value }}</code>
                        <span class="ledger-fix-rows"
                          >{{ entry.rows }} row{{ entry.rows === 1 ? '' : 's' }}</span
                        >
                        <select
                          class="ledger-fix-select"
                          :value="resolutionFor(entry.target, entry.value)"
                          :data-testid="`import-fix-${entry.value}`"
                          @change="
                            setResolution(
                              entry.target,
                              entry.value,
                              ($event.target as HTMLSelectElement).value,
                            )
                          "
                        >
                          <option value="">Choose…</option>
                          <option v-for="choice in entry.offered" :key="choice" :value="choice">
                            {{ choiceLabel(choice) }}
                          </option>
                          <option :value="IGNORE_VALUE">Ignore this value</option>
                        </select>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr
                  v-for="(option, position) in row.group.options"
                  :key="`${row.group.stem}-${option}`"
                  class="ledger-member-row"
                  data-testid="import-group-member"
                >
                  <td class="ledger-member">↳ {{ option }}</td>
                  <td
                    class="ledger-samples"
                    :class="{
                      empty: samplesFor(row.group.columns[position]).startsWith('no values'),
                    }"
                  >
                    {{ samplesFor(row.group.columns[position]) }}
                  </td>
                  <td class="ledger-member-note">part of the question above</td>
                </tr>
              </template>

              <!-- An ordinary column. -->
              <tr v-else data-testid="import-column-row">
                <td class="ledger-header">
                  {{ headers[row.index] || `(column ${row.index + 1})` }}
                  <span
                    v-if="isRestored(columnTarget[row.index])"
                    class="ledger-badge"
                    data-testid="import-restored-badge"
                  >
                    restored from last import
                  </span>
                  <span
                    v-else-if="isNewHeader(row.index)"
                    class="ledger-badge new"
                    data-testid="import-new-badge"
                  >
                    new since last import
                  </span>
                  <span
                    v-if="singleShapeLabel(row.index)"
                    class="ledger-shape"
                    data-testid="import-column-shape"
                  >
                    {{ singleShapeLabel(row.index) }}
                  </span>
                </td>
                <td
                  class="ledger-samples"
                  :class="{ empty: samplesFor(row.index).startsWith('no values') }"
                >
                  {{ samplesFor(row.index) }}
                </td>
                <td>
                  <select
                    v-model="columnTarget[row.index]"
                    class="ledger-select"
                    :data-testid="`import-target-select-${row.index}`"
                  >
                    <option value="">Ignore this column</option>
                    <option
                      v-for="target in targets"
                      :key="target.key"
                      :value="target.key"
                      :disabled="takenBy(target.key, row.index, null)"
                    >
                      {{ target.label }}{{ target.required ? ' *' : '' }}
                    </option>
                  </select>

                  <!-- Values the market does not recognise, fixed in the row that owns them. -->
                  <div
                    v-if="unmatchedFor(columnTarget[row.index]).length"
                    class="ledger-fixes"
                    data-testid="import-value-fixes"
                  >
                    <p class="ledger-fixes-title">
                      {{ unmatchedFor(columnTarget[row.index]).length }} value{{
                        unmatchedFor(columnTarget[row.index]).length === 1 ? '' : 's'
                      }}
                      did not match your market
                    </p>
                    <div
                      v-for="entry in unmatchedFor(columnTarget[row.index])"
                      :key="entry.value"
                      class="ledger-fix"
                    >
                      <code :data-testid="`import-unmatched-value`">{{ entry.value }}</code>
                      <span class="ledger-fix-rows"
                        >{{ entry.rows }} row{{ entry.rows === 1 ? '' : 's' }}</span
                      >
                      <select
                        class="ledger-fix-select"
                        :value="resolutionFor(entry.target, entry.value)"
                        :data-testid="`import-fix-${entry.value}`"
                        @change="
                          setResolution(
                            entry.target,
                            entry.value,
                            ($event.target as HTMLSelectElement).value,
                          )
                        "
                      >
                        <option value="">Choose…</option>
                        <option v-for="choice in entry.offered" :key="choice" :value="choice">
                          {{ choiceLabel(choice) }}
                        </option>
                        <option :value="IGNORE_VALUE">Ignore this value</option>
                      </select>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
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
        <p v-if="unresolvedCount" class="rail-warning" data-testid="import-unresolved-warning">
          {{
            unresolvedCount === 1 ? '1 value still needs' : `${unresolvedCount} values still need`
          }}
          a match.
        </p>
        <!-- Only when something actually is unmapped. This was `v-else` on the unresolved-values
             warning above, so a fully mapped file showed a red "Still unmapped:" with an empty list
             directly under the green "All required questions are mapped." -->
        <p
          v-else-if="unservedRequired.length"
          class="rail-warning"
          data-testid="import-unmapped-warning"
        >
          Still unmapped: {{ unservedRequired.map((t) => t.label).join(', ') }}
        </p>
      </aside>
    </section>

    <!-- 3. Preview -->
    <section v-if="step === 'preview'" class="import-panel" data-testid="import-preview">
      <h2 data-testid="import-preview-counts">
        {{ validRows }} of {{ rowCount }} row{{ rowCount === 1 ? '' : 's' }} will be imported
      </h2>
      <p class="import-help" data-testid="import-preview-merge">
        <template v-if="updatedRows">{{ newRows }} new, {{ updatedRows }} updated. </template>Each
        imported row becomes an application awaiting your review. Nothing has been written yet.
      </p>

      <!-- An approval the import would invalidate. Said before it happens, because silently
           un-approving someone the organizer already decided on is not acceptable either way. -->
      <p v-if="returningToReview" class="import-note warn" data-testid="import-returning-note">
        {{ returningToReview }} approved application{{ returningToReview === 1 ? '' : 's' }} will
        return to review because
        {{ returningToReview === 1 ? 'its answers have' : 'their answers have' }} changed<span
          v-if="returningEmails.length"
        >
          ({{ returningEmails.join(', ') }})</span
        >.
      </p>

      <!-- Already here, not in this file. Left alone: absence is almost always a filtered export,
           not a withdrawal, and guessing otherwise would destroy review state on a guess. -->
      <p v-if="absentApplications" class="import-note" data-testid="import-absent-note">
        {{ absentApplications }} existing application{{ absentApplications === 1 ? '' : 's' }}
        {{ absentApplications === 1 ? 'is' : 'are' }} not in this file<span
          v-if="absentEmails.length"
        >
          ({{ absentEmails.join(', ') }})</span
        >. They will be left exactly as they are.
      </p>

      <!-- Everything that would be skipped, before it is skipped. -->
      <div
        v-if="previewFailures.length"
        class="import-failures"
        data-testid="import-preview-failures"
      >
        <h3>
          {{ previewFailures.length }} row{{ previewFailures.length === 1 ? '' : 's' }} will be
          skipped
        </h3>
        <p class="import-help">
          These will not be imported. Import the rest, or go back and fix them in your spreadsheet.
        </p>
        <ul>
          <li
            v-for="failure in previewFailures"
            :key="failure.row"
            data-testid="import-preview-failure-row"
          >
            <strong>Row {{ failure.row }}</strong>
            <span v-if="failure.email"> ({{ failure.email }})</span>: {{ failure.error }}
          </li>
        </ul>
      </div>
      <ul class="preview-mapping">
        <li v-for="target in targets" :key="target.key" v-show="mappedKeys.has(target.key)">
          <strong>{{ target.label }}</strong>
          <span data-testid="import-preview-source">{{ sourceLabelFor(target.key) }}</span>
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
        :disabled="!canPreview || busy || unresolvedCount > 0"
        data-testid="import-preview-button"
        @click="checkValues"
      >
        {{ unmatched.length ? 'Re-check values' : 'Preview import' }}
      </button>
      <button
        v-if="step === 'preview'"
        class="button-primary"
        :disabled="busy || validRows === 0"
        data-testid="import-confirm-button"
        @click="runImport"
      >
        Import {{ validRows }} row{{ validRows === 1 ? '' : 's' }}
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

.ledger-group-row {
  background: #f2f8f4;
}

.ledger-shape {
  display: block;
  margin-top: 2px;
  font-weight: normal;
  font-size: 12px;
  color: var(--mm-green, #2e7d4f);
}

.ledger-member td {
  border-bottom: none;
}

.ledger-member {
  padding-left: 26px !important;
  color: var(--mm-grey, #444);
}

.ledger-member-note {
  font-size: 12px;
  color: var(--mm-grey, #999);
}

.import-restored {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border: 1px solid #cfe3d4;
  border-radius: 6px;
  background: #f2f8f4;
  font-size: 13px;
}

.ledger-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #e8f3ec;
  color: var(--mm-green, #2e7d4f);
  font-size: 11px;
  font-weight: normal;
}

.ledger-badge.new {
  background: #fff4e5;
  color: #a5670b;
}

.ledger-fixes {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--mm-red, #cc0000);
  border-radius: 6px;
  background: #fff8f8;
}

.ledger-fixes-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--mm-red, #cc0000);
}

.ledger-fix {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.ledger-fix code {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f2f2f2;
  font-size: 12px;
}

.ledger-fix-rows {
  font-size: 11px;
  color: var(--mm-grey, #888);
}

.ledger-fix-select {
  height: 30px;
  padding: 2px 6px;
  font-family: 'Outfit Regular';
  font-size: 13px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 5px;
  background: white;
}

.ledger-split {
  border: none;
  background: none;
  padding: 0;
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #666);
  text-decoration: underline;
  cursor: pointer;
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

.import-note.warn {
  border-color: #e6c07a;
  background: #fff8ea;
  color: #7a5a12;
}

.import-note {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 6px;
  background: #fafafa;
  font-size: 13px;
  color: var(--mm-grey, #555);
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
