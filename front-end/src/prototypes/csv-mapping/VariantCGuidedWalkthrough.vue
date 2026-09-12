<script setup lang="ts">
/**
 * VARIANT C - "Guided walkthrough" (one question per target). THROWAWAY PROTOTYPE.
 *
 * Organizing principle: neither list is on screen at once. The flow asks one plain
 * question at a time ("Which column holds the applicant's email?") and shows only the
 * candidate columns for that question, ranked by how well they match. A vertical rail
 * tracks progress. Nothing can be mapped out of order, and the organizer never sees the
 * whole 13-column file.
 *
 * Many-columns-to-one-target: the shape question is asked EXPLICITLY, before the columns
 * are chosen. The step for a `multi` target opens on two answer shapes - "one column per
 * option" (with the detected grid pre-ticked) and "one column holding several values" -
 * and the candidate picker below changes from a checkbox list to a radio list to match.
 * Auto-detection pre-selects the shape it found, so both exports are one Enter away.
 */
import { computed, reactive, ref, watch } from 'vue';
import {
  DATASETS,
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
  vocabularyFor,
  LAST_IMPORT,
  type CsvDataset,
  type MappingTarget,
  type TargetId,
  type UnmatchedValue,
} from './prototypeData';

const dataset = ref<CsvDataset>(DATASETS[0]);
/** 'upload' | 'ask' | 'preview' | 'done' - `ask` walks `order` one target at a time. */
const phase = ref<'upload' | 'ask' | 'preview' | 'done'>('ask');
const cursor = ref(0);
const state = reactive(initialMappingState(dataset.value));
const unmatched = ref<UnmatchedValue[]>(initialUnmatched(dataset.value));

const order = computed(() => [...TARGETS].sort((a, b) => Number(b.required) - Number(a.required)));
const target = computed<MappingTarget>(() => order.value[cursor.value]);

const groups = computed(() => gridGroups(dataset.value.headers));

/** Per-target answer shape, seeded from what auto-detection actually found. */
const shape = reactive<Record<string, 'per-option' | 'single'>>({});
function seedShapes() {
  for (const t of TARGETS) {
    shape[t.id] = (state.mapping[t.id]?.length ?? 0) > 1 ? 'per-option' : 'single';
  }
}
seedShapes();

watch(dataset, (d) => {
  const fresh = initialMappingState(d);
  state.mapping = fresh.mapping;
  state.provenance = fresh.provenance;
  unmatched.value = initialUnmatched(d);
  cursor.value = 0;
  seedShapes();
});

const QUESTIONS: Record<TargetId, string> = {
  essential_email: "Which column holds the applicant's email address?",
  essential_available_dates: 'Which column or columns say which days a vendor can attend?',
  essential_tier_preference: 'Which column or columns say which tiers a vendor will accept?',
  essential_max_dates: 'Which column caps how many days one vendor gets?',
  essential_section_ranking: 'Which column or columns rank the sections a vendor prefers?',
  essential_table_choice: 'Which column says full table, half table, or either?',
  essential_table_share_email: "Which column holds a table-sharing partner's email?",
  submitted_at: 'Which column holds the submission time?',
  custom_business_name: 'Which column holds the business name?',
  custom_returning_vendor: 'Which column says whether they have vended with you before?',
  custom_instagram: 'Which column holds the Instagram handle?',
};

/** Candidates for the current question, best guess first. */
const candidates = computed(() => {
  const t = target.value;
  const singleOnly = t.arity === 'single' || shape[t.id] === 'single';
  return dataset.value.headers
    .map((h) => ({ header: h, score: confidence(h, t.id) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, singleOnly ? 5 : dataset.value.headers.length);
});

/** The grid groups this question could plausibly be answered by. */
const detectedGroups = computed(() =>
  Object.entries(groups.value).map(([stem, headers]) => ({ stem, headers })),
);

const chosen = computed(() => state.mapping[target.value.id] ?? []);

function chooseSingle(header: string) {
  assign(state, header, target.value.id);
}

function toggleMulti(header: string) {
  if (chosen.value.includes(header)) assign(state, header, null);
  else assign(state, header, target.value.id);
}

function chooseGroup(headers: string[]) {
  for (const h of [...chosen.value]) assign(state, h, null);
  for (const h of headers) assign(state, h, target.value.id);
}

function clearTarget() {
  for (const h of [...chosen.value]) assign(state, h, null);
}

function setShape(s: 'per-option' | 'single') {
  shape[target.value.id] = s;
  clearTarget();
}

const stepUnmatched = computed(() =>
  unmatched.value.filter((u) => u.target === target.value.id && u.resolvedTo === null),
);

const answered = computed(() => chosen.value.length > 0);
const missing = computed(() => missingRequired(state.mapping));
const outcomes = computed(() => rowOutcomes(dataset.value));
const skipped = computed(() => outcomes.value.filter((o) => o.status === 'skipped'));

function next() {
  if (cursor.value < order.value.length - 1) cursor.value += 1;
  else phase.value = 'preview';
}
function back() {
  if (cursor.value > 0) cursor.value -= 1;
  else phase.value = 'upload';
}

function statusOf(t: MappingTarget): 'done' | 'todo' | 'skipped' {
  if ((state.mapping[t.id]?.length ?? 0) > 0) return 'done';
  return t.required ? 'todo' : 'skipped';
}

function sample(header: string): string {
  const idx = dataset.value.headers.indexOf(header);
  return dataset.value.rows
    .slice(0, 2)
    .map((r) => (r[idx].trim() === '' ? '(blank)' : r[idx]))
    .join(' · ');
}

const previewTargets: TargetId[] = [
  'essential_email',
  'essential_available_dates',
  'essential_tier_preference',
  'essential_section_ranking',
];
</script>

<template>
  <div class="walk">
    <!-- Upload -->
    <section v-if="phase === 'upload'" class="centre">
      <div class="card">
        <h1>Import applications</h1>
        <p class="lead">{{ MARKET_CONFIG.name }}</p>
        <div class="dropzone">{{ dataset.fileName }}</div>
        <p class="restored">
          We saved your mapping from {{ LAST_IMPORT.when }}. We will ask about each field, with your
          last answer already filled in.
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
        <button class="primary big" @click="phase = 'ask'">Start</button>
      </div>
    </section>

    <!-- Walkthrough -->
    <section v-else-if="phase === 'ask'" class="ask">
      <aside class="rail">
        <div class="rail-title">
          {{ order.filter((t) => statusOf(t) === 'done').length }} of {{ order.length }} answered
        </div>
        <ol>
          <li
            v-for="(t, i) in order"
            :key="t.id"
            :class="[statusOf(t), { current: i === cursor }]"
            @click="cursor = i"
          >
            <span class="mark">{{ statusOf(t) === 'done' ? '✓' : t.required ? '!' : '–' }}</span>
            <span class="rail-label">{{ t.label }}</span>
            <span v-if="(state.mapping[t.id]?.length ?? 0) > 1" class="rail-multi">
              {{ state.mapping[t.id]!.length }}
            </span>
          </li>
        </ol>
        <div v-if="missing.length" class="rail-block">
          Nothing imports until the {{ missing.length }} required question{{
            missing.length === 1 ? '' : 's'
          }}
          above are answered.
        </div>
      </aside>

      <div class="stage">
        <div class="stage-inner">
          <p class="kicker">
            Question {{ cursor + 1 }} of {{ order.length }} ·
            {{ target.required ? 'Required' : 'Optional' }}
          </p>
          <h1>{{ QUESTIONS[target.id] }}</h1>
          <p class="lead">{{ target.help }}</p>

          <div v-if="state.provenance[target.id] === 'restored'" class="banner info">
            Answer restored from your last import.
          </div>
          <div v-else-if="state.provenance[target.id] === 'header-changed'" class="banner warn">
            This question was renamed in your Form. Last time it was "{{ renamedFrom(target.id) }}";
            we matched it to the column below. Check it is right.
          </div>
          <div
            v-for="v in LAST_IMPORT.vanished.filter((x) => x.target === target.id)"
            :key="v.header"
            class="banner warn"
          >
            The column you used last time - "{{ v.header }}" - is not in this file. Pick a new one
            or skip.
          </div>

          <!-- Shape question, only for targets that can eat several columns -->
          <div v-if="target.arity === 'multi'" class="shapes">
            <p class="shape-q">How did your Form ask this?</p>
            <div class="shape-row">
              <button
                class="shape-card"
                :class="{ on: shape[target.id] === 'per-option' }"
                :disabled="!detectedGroups.length"
                @click="setShape('per-option')"
              >
                <strong>One column per option</strong>
                <span>
                  A checkbox grid. Google Forms writes one column for each choice, headed with the
                  choice in square brackets.
                </span>
                <em v-if="detectedGroups.length">
                  Detected: {{ detectedGroups[0].headers.length }} columns under "{{
                    detectedGroups[0].stem
                  }}"
                </em>
                <em v-else>No grid columns found in this file</em>
              </button>
              <button
                class="shape-card"
                :class="{ on: shape[target.id] === 'single' }"
                @click="setShape('single')"
              >
                <strong>One column, several values</strong>
                <span>
                  A single checkbox question. Every ticked choice ends up in one cell, separated by
                  commas.
                </span>
                <em>We will split each cell on commas.</em>
              </button>
            </div>
          </div>

          <!-- Grid answer -->
          <div v-if="target.arity === 'multi' && shape[target.id] === 'per-option'" class="answers">
            <div v-for="g in detectedGroups" :key="g.stem" class="grid-group">
              <div class="grid-head">
                <strong>{{ g.stem }}</strong>
                <button class="link" @click="chooseGroup(g.headers)">
                  Use all {{ g.headers.length }}
                </button>
              </div>
              <label v-for="h in g.headers" :key="h" class="opt check">
                <input type="checkbox" :checked="chosen.includes(h)" @change="toggleMulti(h)" />
                <span class="opt-main">
                  <span class="opt-title">{{ optionLabel(h) }}</span>
                  <span class="opt-sub">{{ questionStem(h) }} · {{ sample(h) }}</span>
                </span>
              </label>
            </div>
            <p v-if="!detectedGroups.length" class="lead">
              This file has no bracketed option columns. Switch to "one column, several values".
            </p>
          </div>

          <!-- Single-column answer (also the shape a multi target falls back to) -->
          <div v-else class="answers">
            <label v-for="c in candidates" :key="c.header" class="opt radio">
              <input
                type="radio"
                :name="'q-' + target.id"
                :checked="chosen.includes(c.header)"
                @change="chooseSingle(c.header)"
              />
              <span class="opt-main">
                <span class="opt-title">{{ c.header }}</span>
                <span class="opt-sub">{{ sample(c.header) }}</span>
              </span>
              <span class="score">
                <span class="bar"><i :style="{ width: Math.round(c.score * 100) + '%' }"></i></span>
                {{ Math.round(c.score * 100) }}%
              </span>
            </label>
            <label class="opt radio none">
              <input
                type="radio"
                :name="'q-' + target.id"
                :checked="!answered"
                @change="clearTarget()"
              />
              <span class="opt-main">
                <span class="opt-title">
                  {{ target.required ? 'None of these (blocks the import)' : 'Skip this field' }}
                </span>
                <span v-if="target.id === 'submitted_at'" class="opt-sub">
                  Allowed, but ties fall back to file order instead of submission time.
                </span>
              </span>
            </label>
          </div>

          <!-- Value matching, folded into the same question -->
          <div v-if="answered && stepUnmatched.length" class="values">
            <h3>
              {{ stepUnmatched.length }} answer{{ stepUnmatched.length === 1 ? '' : 's' }} in this
              column did not match your market
            </h3>
            <p class="lead small">
              {{ autoMatchedCount(dataset) }} other values matched on their own. Only the leftovers
              are here.
            </p>
            <div v-for="u in stepUnmatched" :key="u.raw" class="value-row">
              <code>{{ u.raw }}</code>
              <span class="v-count">{{ u.rowCount }} row{{ u.rowCount === 1 ? '' : 's' }}</span>
              <select
                :value="u.suggestion ?? ''"
                @change="u.resolvedTo = ($event.target as HTMLSelectElement).value"
              >
                <option value="">Ignore this value</option>
                <option v-for="v in vocabularyFor(target.id)" :key="v" :value="v">{{ v }}</option>
              </select>
              <span v-if="u.suggestion" class="suggest">suggested: {{ u.suggestion }}</span>
            </div>
          </div>

          <div class="nav">
            <button class="ghost" @click="back()">Back</button>
            <button class="primary" @click="next()">
              {{ cursor === order.length - 1 ? 'Review the import' : 'Next question' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Preview -->
    <section v-else-if="phase === 'preview'" class="centre wide">
      <div class="card wide">
        <h1>Before we import</h1>
        <div v-if="missing.length" class="banner block">
          {{ missing.map((m) => m.label).join(', ') }} still unanswered. Nothing can import until
          they are.
          <button class="link" @click="phase = 'ask'">Go back and answer them</button>
        </div>
        <p class="lead">
          {{ outcomes.length - skipped.length }} of {{ outcomes.length }} rows are importable.
        </p>
        <ul class="issues" v-if="skipped.length">
          <li v-for="o in skipped" :key="o.rowNumber">
            <strong>Row {{ o.rowNumber }} - {{ o.vendor }}</strong>
            <span>{{ o.reason }}</span>
          </li>
        </ul>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th v-for="t in previewTargets" :key="t">{{ targetById(t).label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(o, i) in outcomes"
                :key="o.rowNumber"
                :class="{ bad: o.status === 'skipped' }"
              >
                <td>{{ o.vendor }}</td>
                <td v-for="t in previewTargets" :key="t">
                  {{ resolvedCell(dataset, state.mapping, i, t, unmatched) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="nav">
          <button class="ghost" @click="phase = 'ask'">Back to the questions</button>
          <button class="primary" :disabled="missing.length > 0" @click="phase = 'done'">
            Import {{ outcomes.length - skipped.length }} rows, skip {{ skipped.length }}
          </button>
        </div>
      </div>
    </section>

    <!-- Done -->
    <section v-else class="centre">
      <div class="card">
        <h1>Imported</h1>
        <p class="lead">
          {{ outcomes.length - skipped.length }} applications are in {{ MARKET_CONFIG.name }}. Your
          answers are saved, so the next export will only ask about what changed.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.walk {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mm-beige);
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
}

h1 {
  font-family: 'Merge One', sans-serif;
  font-size: 26px;
  line-height: 1.25;
  margin: 0;
  color: var(--mm-black);
}

h3 {
  font-family: 'Merge One', sans-serif;
  font-size: 14px;
  margin: 0 0 4px;
}

.lead {
  font-size: 14px;
  color: rgba(39, 35, 35, 0.65);
  margin: 8px 0 0;
}

.lead.small {
  font-size: 12px;
}

.centre {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  justify-content: center;
  align-items: safe center;
  padding: 40px 40px 90px;
}

.card {
  width: 560px;
  background: #fff;
  border-radius: 14px;
  padding: 32px;
  box-shadow: 0 0 4px 5px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card.wide {
  width: min(1080px, 100%);
}

.ask {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr);
}

.rail {
  background: var(--mm-black);
  color: #fff;
  padding: 24px 18px;
  overflow-y: auto;
  min-height: 0;
}

.rail-title {
  font-family: 'Merge One', sans-serif;
  font-size: 13px;
  letter-spacing: 0.06em;
  color: #9a9694;
  margin-bottom: 14px;
}

.rail ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rail li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: #b8b4b2;
}

.rail li:hover {
  background: rgba(255, 255, 255, 0.06);
}

.rail li.current {
  background: rgba(73, 176, 150, 0.2);
  color: #fff;
}

.rail li.done {
  color: #e6e3e1;
}

.mark {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.12);
}

.rail li.done .mark {
  background: var(--mm-green);
  color: #fff;
}

.rail li.todo .mark {
  background: #a33;
  color: #fff;
}

.rail-label {
  flex: 1;
}

.rail-multi {
  font-size: 10px;
  background: var(--mm-yellow);
  color: #111;
  border-radius: 999px;
  padding: 1px 7px;
}

.rail-block {
  margin-top: 18px;
  font-size: 11px;
  line-height: 1.5;
  color: #ffb9b9;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 12px;
}

.stage {
  overflow-y: auto;
  min-height: 0;
  padding: 40px 48px 90px;
}

.stage-inner {
  max-width: 760px;
}

.kicker {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(39, 35, 35, 0.5);
  margin: 0 0 8px;
}

.banner {
  margin-top: 14px;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.info {
  background: #e7f3ff;
  color: #2c5d86;
}

.banner.warn {
  background: #fff6e0;
  color: #7a5200;
  border: 1px solid #f0d089;
}

.banner.block {
  background: #fdeaea;
  color: #8a1f1f;
  border: 1px solid #f0a9a9;
}

.shapes {
  margin-top: 22px;
}

.shape-q {
  font-family: 'Merge One', sans-serif;
  font-size: 14px;
  margin: 0 0 8px;
}

.shape-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.shape-card {
  text-align: left;
  background: #fff;
  border: 2px solid rgba(39, 35, 35, 0.12);
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: 'Outfit Regular', sans-serif;
}

.shape-card.on {
  border-color: var(--mm-green);
  background: rgba(73, 176, 150, 0.07);
}

.shape-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shape-card strong {
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
}

.shape-card span {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.65);
  line-height: 1.4;
}

.shape-card em {
  font-size: 11px;
  font-style: normal;
  color: #7a5200;
  background: #fff6e0;
  border-radius: 999px;
  padding: 2px 9px;
  align-self: flex-start;
}

.answers {
  margin-top: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid-group {
  background: #fff;
  border: 1px solid rgba(39, 35, 35, 0.12);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.grid-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.opt {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid rgba(39, 35, 35, 0.12);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
}

.grid-group .opt {
  border-color: rgba(39, 35, 35, 0.08);
  background: #fbfbfa;
}

.opt:hover {
  border-color: var(--mm-green);
}

.opt-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opt-title {
  font-size: 14px;
}

.opt-sub {
  font-size: 12px;
  color: rgba(39, 35, 35, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opt.none {
  background: transparent;
  border-style: dashed;
}

.score {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(39, 35, 35, 0.55);
  flex-shrink: 0;
}

.bar {
  display: block;
  width: 70px;
  height: 5px;
  border-radius: 999px;
  background: rgba(39, 35, 35, 0.12);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  background: var(--mm-green);
}

.values {
  margin-top: 24px;
  background: #fff;
  border-left: 4px solid var(--mm-yellow);
  border-radius: 10px;
  padding: 14px 16px;
}

.value-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.value-row code {
  font-size: 13px;
  background: #fdeaea;
  border-radius: 5px;
  padding: 3px 9px;
}

.v-count {
  font-size: 11px;
  color: rgba(39, 35, 35, 0.5);
}

.suggest {
  font-size: 11px;
  color: #2c7a66;
}

select {
  height: 30px;
  border: 1px solid var(--mm-grey);
  border-radius: 6px;
  background: #fff;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
}

.nav {
  display: flex;
  gap: 12px;
  margin-top: 28px;
}

.primary {
  min-height: 38px;
  padding: 0 22px;
  background: var(--mm-green);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  cursor: pointer;
}

.primary.big {
  align-self: flex-start;
}

.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ghost {
  min-height: 38px;
  padding: 0 22px;
  background: transparent;
  border: 1px solid var(--mm-grey);
  border-radius: 6px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  cursor: pointer;
}

.link {
  background: none;
  border: none;
  color: #2c7a66;
  text-decoration: underline;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  padding: 0;
}

.dropzone {
  border: 2px dashed var(--mm-grey);
  border-radius: 10px;
  padding: 30px;
  text-align: center;
  font-size: 13px;
  color: rgba(39, 35, 35, 0.7);
}

.restored {
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

.issues {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.issues li {
  background: #fdeaea;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  display: flex;
  gap: 10px;
  color: #8a1f1f;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(39, 35, 35, 0.12);
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  text-align: left;
  padding: 8px 12px;
  border-top: 1px solid rgba(39, 35, 35, 0.08);
  white-space: nowrap;
}

th {
  border-top: none;
  background: rgba(39, 35, 35, 0.05);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

tr.bad td {
  background: #fdeaea;
  color: #8a1f1f;
}
</style>
