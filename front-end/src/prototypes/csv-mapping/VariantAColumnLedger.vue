<script setup lang="ts">
/**
 * VARIANT A - "Column ledger" (source-driven). THROWAWAY PROTOTYPE.
 *
 * Organizing principle: the CSV is the spine. One row per column in the file, in file
 * order, each row deciding where that column goes. The organizer reads their own export
 * top to bottom and never has to hold the target list in their head.
 *
 * Many-columns-to-one-target: consecutive columns sharing a question stem are drawn as a
 * bracketed group with a single group-level target picker; the member rows keep their own
 * pickers but inherit the group's choice. The single-column export collapses to one
 * ordinary row with the same target on it, so the two shapes read the same way.
 */
import { computed, reactive, ref, watch } from 'vue';
import {
  DATASETS,
  FLOW_STEPS,
  MARKET_CONFIG,
  TARGETS,
  assign,
  autoMatchedCount,
  confidence,
  gridGroups,
  initialMappingState,
  initialUnmatched,
  missingRequired,
  optionLabel,
  questionStem,
  renamedFrom,
  resolvedCell,
  rowOutcomes,
  targetById,
  targetOfHeader,
  vocabularyFor,
  type CsvDataset,
  type TargetId,
  type UnmatchedValue,
} from './prototypeData';

const dataset = ref<CsvDataset>(DATASETS[0]);
const step = ref(1);
const state = reactive(initialMappingState(dataset.value));
const unmatched = ref<UnmatchedValue[]>(initialUnmatched(dataset.value));

watch(dataset, (d) => {
  const fresh = initialMappingState(d);
  state.mapping = fresh.mapping;
  state.provenance = fresh.provenance;
  unmatched.value = initialUnmatched(d);
});

const groups = computed(() => gridGroups(dataset.value.headers));

function groupOf(header: string): string | null {
  const stem = questionStem(header);
  return groups.value[stem] ? stem : null;
}

function isGroupHead(header: string): boolean {
  const stem = groupOf(header);
  return stem ? groups.value[stem][0] === header : false;
}

function sampleValues(header: string): string {
  const idx = dataset.value.headers.indexOf(header);
  const values = dataset.value.rows
    .slice(0, 3)
    .map((r) => r[idx])
    .map((v) => (v.trim() === '' ? '(blank)' : v));
  return values.join(' · ');
}

function setTarget(header: string, value: string) {
  assign(state, header, value === '' ? null : (value as TargetId));
}

function setGroupTarget(stem: string, value: string) {
  for (const h of groups.value[stem]) setTarget(h, value);
}

const missing = computed(() => missingRequired(state.mapping));
const timestampUnmapped = computed(() => !(state.mapping.submitted_at?.length ?? 0));
const openUnmatched = computed(() => unmatched.value.filter((u) => u.resolvedTo === null));
const canProceed = computed(() => missing.value.length === 0);
const outcomes = computed(() => rowOutcomes(dataset.value));
const skipped = computed(() => outcomes.value.filter((o) => o.status === 'skipped'));
const previewTargets: TargetId[] = [
  'essential_email',
  'essential_available_dates',
  'essential_tier_preference',
  'essential_section_ranking',
  'essential_max_dates',
];
</script>

<template>
  <div class="ledger-flow">
    <div class="stepbar">
      <button
        v-for="(label, i) in FLOW_STEPS"
        :key="label"
        class="step"
        :class="{ active: i === step, done: i < step }"
        @click="step = i"
      >
        <span class="step-num">{{ i + 1 }}</span
        >{{ label }}
      </button>
      <span class="stepbar-market">{{ MARKET_CONFIG.name }} · import applications</span>
    </div>

    <!-- 1. Upload -->
    <section v-if="step === 0" class="pad">
      <div class="upload-card">
        <h2>Upload the responses export</h2>
        <p class="muted">Download the Google Form responses as CSV, then drop the file here.</p>
        <div class="dropzone">{{ dataset.fileName }}</div>
        <p class="restored-note">
          Mapping restored from your last import ({{ 'Apr 18, 2026' }}). Re-uploading keeps it.
        </p>
        <div class="proto-data">
          <span>PROTOTYPE DATA</span>
          <button
            v-for="d in DATASETS"
            :key="d.key"
            class="chip-btn"
            :class="{ on: d.key === dataset.key }"
            @click="dataset = d"
          >
            {{ d.shapeLabel }}
          </button>
        </div>
        <button class="primary" @click="step = 1">Continue to mapping</button>
      </div>
    </section>

    <!-- 2. Map -->
    <section v-else-if="step === 1" class="map-body">
      <div class="ledger">
        <div class="ledger-head">
          <h2>{{ dataset.headers.length }} columns in this file</h2>
          <span class="muted">Every column, in file order. Leave a column unmapped to ignore.</span>
        </div>
        <div class="ledger-table">
          <div class="lrow lhead">
            <span>CSV column</span>
            <span>First rows</span>
            <span>Maps to</span>
          </div>
          <template v-for="header in dataset.headers" :key="header">
            <div v-if="isGroupHead(header)" class="group-banner">
              <div class="group-text">
                <strong>{{ questionStem(header) }}</strong>
                <span
                  >{{ groups[questionStem(header)].length }} columns - checkbox grid, one column per
                  option. They feed one target together.</span
                >
              </div>
              <select
                class="target-select group-select"
                :value="targetOfHeader(state.mapping, header) ?? ''"
                @change="
                  setGroupTarget(questionStem(header), ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="">-- ignore all --</option>
                <option v-for="t in TARGETS" :key="t.id" :value="t.id">
                  {{ t.label }}{{ t.arity === 'multi' ? ' (accepts many columns)' : '' }}
                </option>
              </select>
            </div>
            <div class="lrow" :class="{ grouped: groupOf(header) }">
              <div class="col-name">
                <span v-if="groupOf(header)" class="bracket"></span>
                <div>
                  <div class="hname">
                    {{ optionLabel(header) ? '↳ ' + optionLabel(header) : header }}
                  </div>
                  <div class="flags">
                    <span
                      v-if="state.provenance[targetOfHeader(state.mapping, header)!] === 'restored'"
                      class="flag restored"
                      >restored from last import</span
                    >
                    <span
                      v-else-if="
                        state.provenance[targetOfHeader(state.mapping, header)!] ===
                        'header-changed'
                      "
                      class="flag changed"
                      >header changed - was "{{
                        renamedFrom(targetOfHeader(state.mapping, header)!)
                      }}"</span
                    >
                    <span v-else-if="targetOfHeader(state.mapping, header)" class="flag auto"
                      >auto-detected ·
                      {{
                        Math.round(
                          confidence(header, targetOfHeader(state.mapping, header)!) * 100,
                        )
                      }}%</span
                    >
                  </div>
                </div>
              </div>
              <div class="samples">{{ sampleValues(header) }}</div>
              <select
                class="target-select"
                :value="targetOfHeader(state.mapping, header) ?? ''"
                @change="setTarget(header, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">-- ignore --</option>
                <option v-for="t in TARGETS" :key="t.id" :value="t.id">
                  {{ t.label }}{{ t.arity === 'multi' ? ' (many)' : '' }}
                </option>
              </select>
            </div>
          </template>
        </div>
      </div>

      <aside class="rail">
        <div class="rail-card">
          <h3>Required targets</h3>
          <ul class="coverage">
            <li v-for="t in TARGETS.filter((x) => x.required)" :key="t.id">
              <span class="tick" :class="{ ok: (state.mapping[t.id]?.length ?? 0) > 0 }">
                {{ (state.mapping[t.id]?.length ?? 0) > 0 ? '✓' : '!' }}
              </span>
              <span class="cov-label">{{ t.label }}</span>
              <span class="cov-count" v-if="(state.mapping[t.id]?.length ?? 0) > 1">
                {{ state.mapping[t.id]!.length }} cols
              </span>
            </li>
          </ul>
          <p v-if="missing.length" class="block-note">
            {{ missing.length }} required target{{ missing.length === 1 ? '' : 's' }} unmapped -
            nothing will import until they are filled.
          </p>
          <p v-else class="ok-note">All required targets mapped.</p>
        </div>

        <div v-if="timestampUnmapped" class="rail-card warn">
          <h3>Timestamp unmapped</h3>
          <p>
            Applications will import, but ties fall back to file order instead of submission time.
          </p>
        </div>

        <div class="rail-card">
          <h3>Cell values</h3>
          <p class="muted small">
            {{ autoMatchedCount(dataset) }} values matched your market automatically.
          </p>
          <div v-for="u in openUnmatched" :key="u.raw" class="unmatched">
            <div class="raw">"{{ u.raw }}"</div>
            <div class="muted small">
              {{ targetById(u.target).label }} · {{ u.rowCount }} row{{
                u.rowCount === 1 ? '' : 's'
              }}
            </div>
            <select
              :value="u.suggestion ?? ''"
              @change="u.resolvedTo = ($event.target as HTMLSelectElement).value"
            >
              <option value="">Ignore this value</option>
              <option v-for="v in vocabularyFor(u.target)" :key="v" :value="v">{{ v }}</option>
            </select>
          </div>
          <p v-if="!openUnmatched.length" class="ok-note">Every value resolved.</p>
        </div>
      </aside>
    </section>

    <!-- 3. Preview -->
    <section v-else-if="step === 2" class="pad">
      <h2>Preview - what the solver will read</h2>
      <p class="muted">
        {{ outcomes.filter((o) => o.status === 'ok').length }} of {{ outcomes.length }} rows are
        importable.
      </p>
      <div class="preview-wrap">
        <table class="preview">
          <thead>
            <tr>
              <th>#</th>
              <th v-for="t in previewTargets" :key="t">{{ targetById(t).label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(o, i) in outcomes"
              :key="o.rowNumber"
              :class="{ bad: o.status === 'skipped' }"
            >
              <td>{{ o.rowNumber }}</td>
              <td v-for="t in previewTargets" :key="t">
                {{ resolvedCell(dataset, state.mapping, i, t, unmatched) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="skipped.length" class="skip-panel">
        <h3>{{ skipped.length }} rows will be skipped</h3>
        <ul>
          <li v-for="o in skipped" :key="o.rowNumber">
            <strong>Row {{ o.rowNumber }} - {{ o.vendor }}:</strong> {{ o.reason }}
          </li>
        </ul>
        <p class="muted small">
          Import the {{ outcomes.length - skipped.length }} valid rows, or cancel and fix the
          responses first.
        </p>
      </div>
      <div class="foot">
        <button class="ghost" @click="step = 1">Back to mapping</button>
        <button class="primary" @click="step = 3">
          Import {{ outcomes.length - skipped.length }} rows
        </button>
      </div>
    </section>

    <!-- 4. Confirm -->
    <section v-else class="pad">
      <div class="upload-card">
        <h2>Imported</h2>
        <p class="muted">
          {{ outcomes.length - skipped.length }} applications added to {{ MARKET_CONFIG.name }}.
          {{ skipped.length }} rows skipped.
        </p>
        <p class="restored-note">This mapping is saved on the market for the next import.</p>
      </div>
    </section>

    <div v-if="step === 1" class="flowfoot">
      <button class="ghost" @click="step = 0">Back</button>
      <span v-if="!canProceed" class="block-inline"> Map every required target to continue. </span>
      <button class="primary" :disabled="!canProceed" @click="step = 2">Preview import</button>
    </div>
  </div>
</template>

<style scoped>
.ledger-flow {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mm-beige);
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
}

.stepbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 20px;
  height: 50px;
  background: var(--mm-black);
  flex-shrink: 0;
}

.step {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #999;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  padding: 6px 14px;
  cursor: pointer;
}

.step.active {
  color: #fff;
  border-bottom-color: var(--mm-green);
}

.step.done {
  color: var(--mm-green);
}

.step-num {
  display: inline-block;
  margin-right: 8px;
  opacity: 0.6;
}

.stepbar-market {
  margin-left: auto;
  color: #777;
  font-size: 13px;
}

.pad {
  padding: 28px 40px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.map-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  padding: 24px 40px 0;
}

.ledger,
.rail {
  min-height: 0;
  overflow-y: auto;
}

.ledger-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 12px;
}

h2 {
  font-family: 'Merge One', sans-serif;
  font-size: 20px;
  margin: 0;
}

h3 {
  font-family: 'Merge One', sans-serif;
  font-size: 14px;
  margin: 0 0 8px;
}

.muted {
  color: rgba(39, 35, 35, 0.6);
  font-size: 13px;
  margin: 0;
}

.small {
  font-size: 12px;
}

.ledger-table {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 0 4px 2px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.lrow {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 260px;
  gap: 16px;
  align-items: center;
  padding: 10px 16px;
  border-top: 1px solid rgba(39, 35, 35, 0.08);
}

.lhead {
  border-top: none;
  background: rgba(39, 35, 35, 0.05);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(39, 35, 35, 0.6);
}

.lrow.grouped {
  background: rgba(73, 176, 150, 0.06);
}

.group-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid rgba(39, 35, 35, 0.08);
  background: rgba(73, 176, 150, 0.14);
}

.group-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.group-text span {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.7);
}

/* Must out-specify `.target-select { width: 100% }`, which is declared later. */
.target-select.group-select {
  flex: 0 0 260px;
  width: 260px;
}

.col-name {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.bracket {
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
  background: var(--mm-green);
}

.hname {
  font-size: 13px;
  word-break: break-word;
}

.flags {
  margin-top: 3px;
}

.flag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
}

.flag.restored {
  background: #e7f3ff;
  color: #2c5d86;
}

.flag.changed {
  background: #fff6e0;
  color: #7a5200;
}

.flag.auto {
  background: rgba(73, 176, 150, 0.15);
  color: #2c7a66;
}

.samples {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.65);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-select,
.unmatched select {
  width: 100%;
  height: 32px;
  border: 1px solid var(--mm-grey);
  border-radius: 6px;
  background: #fff;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  padding: 0 6px;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rail-card {
  background: #fff;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 0 4px 2px rgba(0, 0, 0, 0.12);
}

.rail-card.warn {
  background: #fff6e0;
  border: 1px solid #f0d089;
}

.coverage {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.coverage li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.tick {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  background: #fdeaea;
  color: #8a1f1f;
  flex-shrink: 0;
}

.tick.ok {
  background: rgba(73, 176, 150, 0.18);
  color: #2c7a66;
}

.cov-label {
  flex: 1;
}

.cov-count {
  font-size: 11px;
  color: #2c7a66;
}

.block-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: #8a1f1f;
}

.ok-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: #2c7a66;
}

.unmatched {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(39, 35, 35, 0.1);
}

.raw {
  font-size: 13px;
  font-weight: 600;
}

.unmatched select {
  margin-top: 6px;
}

.upload-card {
  max-width: 680px;
  background: #fff;
  border-radius: 10px;
  padding: 28px;
  box-shadow: 0 0 4px 2px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dropzone {
  border: 2px dashed var(--mm-grey);
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  font-size: 13px;
  color: rgba(39, 35, 35, 0.7);
}

.restored-note {
  margin: 0;
  font-size: 12px;
  color: #2c5d86;
  background: #e7f3ff;
  padding: 8px 10px;
  border-radius: 6px;
}

.proto-data {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(39, 35, 35, 0.5);
}

.chip-btn {
  border: 1px dashed var(--mm-grey);
  background: #fff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
}

.chip-btn.on {
  background: var(--mm-black);
  color: #fff;
}

.primary {
  align-self: flex-start;
  min-height: 35px;
  padding: 0 18px;
  background: var(--mm-green);
  border: none;
  border-radius: 5px;
  color: #fff;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ghost {
  min-height: 35px;
  padding: 0 18px;
  background: transparent;
  border: 1px solid var(--mm-grey);
  border-radius: 5px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  cursor: pointer;
}

.flowfoot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 40px 70px;
  flex-shrink: 0;
}

.flowfoot .primary {
  margin-left: auto;
}

.block-inline {
  font-size: 13px;
  color: #8a1f1f;
}

.preview-wrap {
  overflow-x: auto;
  margin-top: 14px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 0 4px 2px rgba(0, 0, 0, 0.12);
}

table.preview {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

table.preview th,
table.preview td {
  text-align: left;
  padding: 8px 12px;
  border-top: 1px solid rgba(39, 35, 35, 0.08);
  white-space: nowrap;
}

table.preview th {
  background: rgba(39, 35, 35, 0.05);
  border-top: none;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 11px;
}

tr.bad td {
  background: #fdeaea;
  color: #8a1f1f;
}

.skip-panel {
  margin-top: 18px;
  background: #fdeaea;
  border: 1px solid #f0a9a9;
  border-radius: 10px;
  padding: 14px 16px;
}

.skip-panel ul {
  margin: 0 0 8px;
  padding-left: 18px;
  font-size: 13px;
}

.foot {
  display: flex;
  gap: 14px;
  margin-top: 20px;
  padding-bottom: 60px;
}
</style>
