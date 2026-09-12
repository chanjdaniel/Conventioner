<script setup lang="ts">
/**
 * VARIANT B - "Target board" (target-driven pairing). THROWAWAY PROTOTYPE.
 *
 * Organizing principle: the solver's needs are the spine. A pool of loose CSV columns on
 * the left; a board of target slots on the right. Primary affordance is pairing - pick a
 * column chip, then click the slot it belongs in (or click a slot's suggestion). The
 * organizer's job reads as "fill every required slot", and an unfilled slot is visible as
 * an empty well rather than as an absence.
 *
 * Many-columns-to-one-target: a `multi` slot is a WELL that holds any number of chips and
 * says which shape it is holding ("3 columns, one per option" vs "1 column, comma
 * separated"). Grid groups get a one-click "add all 3" on the slot. Nothing about the slot
 * changes between the two export shapes - only how many chips land in it.
 */
import { computed, reactive, ref, watch } from 'vue';
import {
  DATASETS,
  FLOW_STEPS,
  MARKET_CONFIG,
  TARGETS,
  assign,
  autoMatchedCount,
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
  unmappedHeaders,
  vocabularyFor,
  LAST_IMPORT,
  type CsvDataset,
  type MappingTarget,
  type TargetId,
  type UnmatchedValue,
} from './prototypeData';

const dataset = ref<CsvDataset>(DATASETS[0]);
const step = ref(1);
const state = reactive(initialMappingState(dataset.value));
const unmatched = ref<UnmatchedValue[]>(initialUnmatched(dataset.value));
const picked = ref<string | null>(null);

watch(dataset, (d) => {
  const fresh = initialMappingState(d);
  state.mapping = fresh.mapping;
  state.provenance = fresh.provenance;
  unmatched.value = initialUnmatched(d);
  picked.value = null;
});

const pool = computed(() => unmappedHeaders(dataset.value, state.mapping));
const groups = computed(() => gridGroups(dataset.value.headers));

function shortLabel(header: string): string {
  const opt = optionLabel(header);
  return opt ? opt : header;
}

function stemOf(header: string): string | null {
  const stem = questionStem(header);
  return groups.value[stem] ? stem : null;
}

function drop(target: MappingTarget) {
  if (!picked.value) return;
  assign(state, picked.value, target.id);
  picked.value = null;
}

function remove(header: string) {
  assign(state, header, null);
}

/** For a multi slot: any grid group whose columns are not all in this slot yet. */
function pendingGroups(target: MappingTarget): { stem: string; headers: string[] }[] {
  if (target.arity !== 'multi') return [];
  const held = state.mapping[target.id] ?? [];
  return Object.entries(groups.value)
    .filter(
      ([, headers]) =>
        headers.some((h) => held.includes(h)) && !headers.every((h) => held.includes(h)),
    )
    .map(([stem, headers]) => ({ stem, headers }));
}

function addWholeGroup(target: MappingTarget, headers: string[]) {
  for (const h of headers) assign(state, h, target.id);
}

/** How the slot describes what it is holding - the whole point of the multi well. */
function shapeNote(target: MappingTarget): string | null {
  const held = state.mapping[target.id] ?? [];
  if (target.arity !== 'multi' || held.length === 0) return null;
  if (held.length > 1) return `${held.length} columns · one per option (checkbox grid)`;
  return '1 column · values split on commas';
}

function slotUnmatched(target: MappingTarget): UnmatchedValue[] {
  return unmatched.value.filter((u) => u.target === target.id && u.resolvedTo === null);
}

const missing = computed(() => missingRequired(state.mapping));
const canProceed = computed(() => missing.value.length === 0);
const timestampUnmapped = computed(() => !(state.mapping.submitted_at?.length ?? 0));
const outcomes = computed(() => rowOutcomes(dataset.value));
const skipped = computed(() => outcomes.value.filter((o) => o.status === 'skipped'));
const openUnmatchedCount = computed(
  () => unmatched.value.filter((u) => u.resolvedTo === null).length,
);

const requiredSlots = computed(() => TARGETS.filter((t) => t.required));
const optionalSlots = computed(() => TARGETS.filter((t) => !t.required && t.group !== 'custom'));
const customSlots = computed(() => TARGETS.filter((t) => t.group === 'custom'));

const previewTargets: TargetId[] = [
  'essential_email',
  'essential_available_dates',
  'essential_tier_preference',
  'essential_table_choice',
];
</script>

<template>
  <div class="board-flow">
    <header class="board-header">
      <div>
        <h1>Import applications</h1>
        <p class="sub">{{ MARKET_CONFIG.name }} · {{ dataset.fileName }}</p>
      </div>
      <ol class="dots">
        <li
          v-for="(label, i) in FLOW_STEPS"
          :key="label"
          :class="{ on: i === step, past: i < step }"
        >
          <button @click="step = i"><span class="dot"></span>{{ label }}</button>
        </li>
      </ol>
    </header>

    <!-- 1. Upload -->
    <section v-if="step === 0" class="sheet">
      <div class="panel">
        <h2>Choose the responses export</h2>
        <div class="dropzone">{{ dataset.fileName }}</div>
        <p class="restored-note">
          A saved mapping from {{ LAST_IMPORT.when }} will be applied automatically.
          {{ LAST_IMPORT.vanished.length }} previously-mapped column is missing from this file.
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
        <button class="primary" @click="step = 1">Continue</button>
      </div>
    </section>

    <!-- 2. Map -->
    <section v-else-if="step === 1" class="board">
      <aside class="pool">
        <div class="pool-head">
          <h2>Columns in your file</h2>
          <p class="hint">
            {{ pool.length }} unassigned. Pick one, then click the slot it belongs in.
          </p>
        </div>
        <div class="chips">
          <button
            v-for="h in pool"
            :key="h"
            class="chip"
            :class="{ picked: picked === h, grouped: stemOf(h) }"
            @click="picked = picked === h ? null : h"
          >
            <span v-if="stemOf(h)" class="chip-stem">{{ stemOf(h) }}</span>
            <span class="chip-name">{{ shortLabel(h) }}</span>
          </button>
          <p v-if="!pool.length" class="all-placed">Every column is placed.</p>
        </div>
        <div v-for="v in LAST_IMPORT.vanished" :key="v.header" class="vanished">
          <strong>Gone from this file:</strong> "{{ v.header }}" fed
          {{ targetById(v.target).label }} last time.
        </div>
      </aside>

      <div class="slots">
        <div class="slot-group">
          <h3>Required by the solver</h3>
          <div
            v-for="t in requiredSlots"
            :key="t.id"
            class="slot"
            :class="{
              empty: !(state.mapping[t.id]?.length ?? 0),
              armed: picked !== null,
            }"
            @click="drop(t)"
          >
            <div class="slot-top">
              <div>
                <div class="slot-label">{{ t.label }}</div>
                <div class="slot-help">{{ t.help }}</div>
              </div>
              <span v-if="t.arity === 'multi'" class="arity">accepts many columns</span>
            </div>

            <div class="well" :class="{ multi: t.arity === 'multi' }">
              <span v-for="h in state.mapping[t.id] ?? []" :key="h" class="placed">
                {{ shortLabel(h) }}
                <button class="x" @click.stop="remove(h)">×</button>
              </span>
              <span v-if="!(state.mapping[t.id]?.length ?? 0)" class="well-empty">
                {{ picked ? `Click to place "${shortLabel(picked)}"` : 'Empty - required' }}
              </span>
            </div>

            <div v-if="shapeNote(t)" class="shape">{{ shapeNote(t) }}</div>
            <div v-if="state.provenance[t.id] === 'restored'" class="prov restored">
              restored from last import
            </div>
            <div v-else-if="state.provenance[t.id] === 'header-changed'" class="prov changed">
              header changed - was "{{ renamedFrom(t.id) }}"
            </div>

            <button
              v-for="g in pendingGroups(t)"
              :key="g.stem"
              class="group-add"
              @click.stop="addWholeGroup(t, g.headers)"
            >
              + Add all {{ g.headers.length }} columns of "{{ g.stem }}"
            </button>

            <div v-if="slotUnmatched(t).length" class="slot-values">
              <div class="sv-head">
                {{ slotUnmatched(t).length }} value{{ slotUnmatched(t).length === 1 ? '' : 's' }}
                did not match your market
              </div>
              <div v-for="u in slotUnmatched(t)" :key="u.raw" class="sv-row" @click.stop>
                <code>{{ u.raw }}</code>
                <span class="arrow">→</span>
                <select
                  :value="u.suggestion ?? ''"
                  @change="u.resolvedTo = ($event.target as HTMLSelectElement).value"
                >
                  <option value="">Ignore</option>
                  <option v-for="v in vocabularyFor(t.id)" :key="v" :value="v">{{ v }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="slot-group">
          <h3>Optional</h3>
          <div
            v-for="t in optionalSlots"
            :key="t.id"
            class="slot slim"
            :class="{ armed: picked !== null }"
            @click="drop(t)"
          >
            <div class="slot-label">{{ t.label }}</div>
            <div class="well">
              <span v-for="h in state.mapping[t.id] ?? []" :key="h" class="placed">
                {{ shortLabel(h) }}
                <button class="x" @click.stop="remove(h)">×</button>
              </span>
              <span v-if="!(state.mapping[t.id]?.length ?? 0)" class="well-empty">Empty</span>
            </div>
            <div v-if="t.id === 'submitted_at' && timestampUnmapped" class="warn-inline">
              Without it, ties fall back to file order. Import is still allowed.
            </div>
          </div>
        </div>

        <div class="slot-group">
          <h3>Your custom fields</h3>
          <div
            v-for="t in customSlots"
            :key="t.id"
            class="slot slim"
            :class="{ armed: picked !== null }"
            @click="drop(t)"
          >
            <div class="slot-label">{{ t.label }}</div>
            <div class="well">
              <span v-for="h in state.mapping[t.id] ?? []" :key="h" class="placed">
                {{ shortLabel(h) }}
                <button class="x" @click.stop="remove(h)">×</button>
              </span>
              <span v-if="!(state.mapping[t.id]?.length ?? 0)" class="well-empty">Empty</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 3. Preview -->
    <section v-else-if="step === 2" class="sheet">
      <div class="panel wide">
        <h2>Preview</h2>
        <p class="hint">
          {{ outcomes.filter((o) => o.status === 'ok').length }} rows import,
          {{ skipped.length }} are skipped.
        </p>
        <div class="cards">
          <div
            v-for="(o, i) in outcomes"
            :key="o.rowNumber"
            class="rowcard"
            :class="{ bad: o.status === 'skipped' }"
          >
            <div class="rowcard-head">
              <strong>{{ o.vendor }}</strong>
              <span class="rn">row {{ o.rowNumber }}</span>
            </div>
            <div v-if="o.reason" class="rowcard-reason">{{ o.reason }}</div>
            <dl v-else>
              <div v-for="t in previewTargets" :key="t">
                <dt>{{ targetById(t).label }}</dt>
                <dd>{{ resolvedCell(dataset, state.mapping, i, t, unmatched) }}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div class="foot">
          <button class="ghost" @click="step = 1">Back to the board</button>
          <button class="primary" @click="step = 3">
            Import {{ outcomes.length - skipped.length }} valid rows
          </button>
        </div>
      </div>
    </section>

    <!-- 4. Confirm -->
    <section v-else class="sheet">
      <div class="panel">
        <h2>Done</h2>
        <p class="hint">
          {{ outcomes.length - skipped.length }} applications imported.
          {{ skipped.length }} skipped. Mapping saved on {{ MARKET_CONFIG.name }}.
        </p>
      </div>
    </section>

    <div v-if="step === 1" class="actionbar">
      <span class="status" :class="{ blocked: !canProceed }">
        <template v-if="!canProceed">
          {{ missing.length }} required slot{{ missing.length === 1 ? '' : 's' }} still empty:
          {{ missing.map((m) => m.label).join(', ') }}
        </template>
        <template v-else>
          All required slots filled · {{ autoMatchedCount(dataset) }} values matched ·
          {{ openUnmatchedCount }} awaiting a choice
        </template>
      </span>
      <button class="ghost" @click="step = 0">Back</button>
      <button class="primary" :disabled="!canProceed" @click="step = 2">Preview</button>
    </div>
  </div>
</template>

<style scoped>
.board-flow {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f6f5f3;
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
}

.board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 40px 14px;
  background: #fff;
  border-bottom: 1px solid rgba(39, 35, 35, 0.1);
  flex-shrink: 0;
}

h1 {
  font-family: 'Merge One', sans-serif;
  font-size: 22px;
  margin: 0;
  color: var(--mm-black);
}

.sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: rgba(39, 35, 35, 0.55);
}

.dots {
  display: flex;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.dots button {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: rgba(39, 35, 35, 0.45);
  padding: 4px 10px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: rgba(39, 35, 35, 0.2);
}

.dots li.on button {
  color: var(--mm-black);
  font-weight: 600;
}

.dots li.on .dot {
  background: var(--mm-green);
}

.dots li.past .dot {
  background: rgba(73, 176, 150, 0.4);
}

.board {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 0;
}

.pool {
  border-right: 1px solid rgba(39, 35, 35, 0.1);
  background: #fff;
  padding: 18px;
  overflow-y: auto;
  min-height: 0;
}

.pool-head h2 {
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  margin: 0;
}

.hint {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.6);
  margin: 4px 0 0;
}

.chips {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
}

.chip {
  text-align: left;
  border: 1px solid var(--mm-grey);
  border-radius: 8px;
  background: #fff;
  padding: 7px 10px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
}

.chip:hover {
  border-color: var(--mm-green);
}

.chip.picked {
  background: var(--mm-black);
  color: #fff;
  border-color: var(--mm-black);
}

.chip.grouped {
  border-left: 4px solid var(--mm-yellow);
}

.chip-stem {
  display: block;
  font-size: 10px;
  opacity: 0.6;
  margin-bottom: 2px;
}

.chip-name {
  display: block;
}

.all-placed {
  font-size: 12px;
  color: #2c7a66;
}

.vanished {
  margin-top: 16px;
  font-size: 11px;
  line-height: 1.4;
  background: #fff6e0;
  border: 1px solid #f0d089;
  border-radius: 8px;
  padding: 8px 10px;
  color: #7a5200;
}

.slots {
  overflow-y: auto;
  min-height: 0;
  padding: 18px 40px 90px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.slot-group h3 {
  font-family: 'Merge One', sans-serif;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(39, 35, 35, 0.5);
  margin: 0 0 10px;
}

.slot {
  background: #fff;
  border: 1px solid rgba(39, 35, 35, 0.1);
  border-left: 4px solid rgba(73, 176, 150, 0.5);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}

.slot.empty {
  border-left-color: #d68a8a;
}

.slot.armed {
  cursor: copy;
}

.slot.armed:hover {
  background: rgba(73, 176, 150, 0.08);
  border-color: var(--mm-green);
}

.slot.slim {
  padding: 10px 14px;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  border-left-color: rgba(39, 35, 35, 0.2);
}

.slot.slim .warn-inline {
  grid-column: 1 / -1;
}

.slot-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.slot-label {
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
}

.slot-help {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.6);
  margin-top: 2px;
}

.arity {
  flex-shrink: 0;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: rgba(228, 166, 41, 0.18);
  color: #7a5200;
  border-radius: 999px;
  padding: 3px 9px;
}

.well {
  margin-top: 8px;
  min-height: 38px;
  border: 1px dashed var(--mm-grey);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  background: #fbfbfa;
}

.slot.slim .well {
  margin-top: 0;
  min-height: 32px;
}

.well.multi {
  min-height: 48px;
}

.placed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(73, 176, 150, 0.16);
  color: #22604f;
  border-radius: 999px;
  padding: 4px 6px 4px 10px;
  font-size: 12px;
}

.x {
  border: none;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  width: 16px;
  height: 16px;
  line-height: 1;
  cursor: pointer;
}

.well-empty {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.4);
  padding-left: 4px;
}

.shape {
  margin-top: 6px;
  font-size: 11px;
  color: #7a5200;
  background: #fff6e0;
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
}

.prov {
  margin-top: 6px;
  font-size: 11px;
}

.prov.restored {
  color: #2c5d86;
}

.prov.changed {
  color: #7a5200;
}

.group-add {
  margin-top: 8px;
  display: block;
  background: rgba(228, 166, 41, 0.18);
  border: 1px solid #f0d089;
  border-radius: 8px;
  padding: 6px 10px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  cursor: pointer;
  color: #7a5200;
}

.slot-values {
  margin-top: 10px;
  border-top: 1px solid rgba(39, 35, 35, 0.1);
  padding-top: 8px;
}

.sv-head {
  font-size: 12px;
  color: #8a1f1f;
  margin-bottom: 6px;
}

.sv-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.sv-row code {
  font-size: 12px;
  background: #fdeaea;
  border-radius: 4px;
  padding: 2px 8px;
}

.arrow {
  color: rgba(39, 35, 35, 0.4);
}

.sv-row select,
.slot select {
  height: 28px;
  border: 1px solid var(--mm-grey);
  border-radius: 6px;
  background: #fff;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
}

.warn-inline {
  margin-top: 6px;
  font-size: 11px;
  color: #7a5200;
}

.sheet {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 28px 40px 90px;
}

.panel {
  max-width: 640px;
  background: #fff;
  border-radius: 10px;
  padding: 24px;
  border: 1px solid rgba(39, 35, 35, 0.1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel.wide {
  max-width: none;
}

.panel h2 {
  font-family: 'Merge One', sans-serif;
  font-size: 18px;
  margin: 0;
}

.dropzone {
  border: 2px dashed var(--mm-grey);
  border-radius: 10px;
  padding: 26px;
  text-align: center;
  font-size: 13px;
  color: rgba(39, 35, 35, 0.7);
}

.restored-note {
  margin: 0;
  font-size: 12px;
  color: #2c5d86;
  background: #e7f3ff;
  border-radius: 6px;
  padding: 8px 10px;
}

.proto-data {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 11px;
  color: rgba(39, 35, 35, 0.5);
}

.chip-btn {
  border: 1px dashed var(--mm-grey);
  background: #fff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-family: 'Outfit Regular', sans-serif;
  cursor: pointer;
}

.chip-btn.on {
  background: var(--mm-black);
  color: #fff;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.rowcard {
  border: 1px solid rgba(39, 35, 35, 0.12);
  border-radius: 10px;
  padding: 12px;
  background: #fff;
}

.rowcard.bad {
  background: #fdeaea;
  border-color: #f0a9a9;
}

.rowcard-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 8px;
}

.rn {
  color: rgba(39, 35, 35, 0.45);
  font-size: 11px;
}

.rowcard-reason {
  font-size: 12px;
  color: #8a1f1f;
}

dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

dl div {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 8px;
}

dt {
  font-size: 11px;
  color: rgba(39, 35, 35, 0.5);
}

dd {
  margin: 0;
  font-size: 12px;
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

.foot {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.actionbar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 40px;
  background: #fff;
  border-top: 1px solid rgba(39, 35, 35, 0.12);
  flex-shrink: 0;
}

.status {
  flex: 1;
  font-size: 12px;
  color: #2c7a66;
}

.status.blocked {
  color: #8a1f1f;
}
</style>
