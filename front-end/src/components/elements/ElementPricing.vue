<script setup lang="ts">
/**
 * The Pricing card (E43/F01/S01, S02): what one table costs for one market day, at each tier.
 *
 * Its columns are the market's tiers. Its rows are the price groups the organizer names, each a
 * rule over the vendor's answers to the market's own choice questions, built with the automatic
 * rejections' condition builder (`ChoiceConditions.vue`), and last the fixed row "Everyone else".
 * A vendor pays the cheapest group they are in, and "Everyone else" when they are in none
 * (`back-end/pricing.py`, the authority). A half table costs a share of the full price, 50% unless
 * the organizer says otherwise, and the market has one currency, Canadian dollars unless they pick
 * another. Pricing is optional: a blank cell is a tier with no price, and a market with no prices
 * shows none anywhere. No question of any one market is named here (Q14).
 *
 * It sits in the plan's fieldset, so it settles with the rest of the setup on leaving draft.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type {
  AnswerCondition,
  PricingObject,
  RejectionQuestion,
  SetupObject,
  TierPrice,
} from '@/assets/types/datatypes';
import ChoiceConditions from '@/components/application/ChoiceConditions.vue';
import { brokenCondition } from '@/utils/choiceConditions';
import {
  CURRENCIES,
  EVERYONE_ELSE,
  UNPRICED,
  centsFromText,
  groupNameProblem,
  groupsOf,
  percentFromText,
  priceText,
  pricingAfterTierChange,
  tierRenamed,
} from '@/utils/pricing';

const props = withDefaults(
  defineProps<{
    setupObject: SetupObject;
    /** The questions a group's condition may name, as the server serves them for a rule. */
    questions?: RejectionQuestion[];
    /** Shown, not changed: the setup has settled, or this person may not change it. */
    fixed?: boolean;
  }>(),
  { questions: () => [], fixed: false },
);
const emit = defineEmits<{
  (event: 'update:setupObject', value: SetupObject): void;
  /** Whether a field holds text that is not a value, so the plan waits rather than saving. */
  (event: 'held', value: boolean): void;
}>();

const pricing = computed<PricingObject>(() => props.setupObject.pricing ?? UNPRICED);
const groups = computed(() => groupsOf(pricing.value));

/** The columns: each tier the plan names, once, in its order; a tier still unnamed has none. */
const tiers = computed(() => [
  ...new Set(props.setupObject.tiers.map((tier) => tier.name).filter((name) => name.trim())),
]);

function write(next: PricingObject) {
  emit('update:setupObject', { ...props.setupObject, pricing: next });
}

/**
 * A field being typed in: its text, and the value it held before. The text is shown as typed until
 * the field is left, never redrawn from the stored value under the caret, which once turned "12.05"
 * into "125" a keystroke at a time. Text that is not a value keeps the value from before, so a
 * blank cell keeps no price and none keeps the prefix before the error ("3" then "3x" keeps
 * nothing), and is shown until it is fixed.
 */
interface Typing<V> {
  text: string;
  before: V;
}

/** A row of the card: a group, by its place, or "Everyone else". */
type Row = number | 'else';
const ELSE = 'else' as const;

function rowPrices(row: Row): TierPrice[] {
  return row === ELSE ? pricing.value.everyoneElse : (groups.value[row]?.prices ?? []);
}

function storedCents(row: Row, tier: string): number | null {
  return rowPrices(row).find((price) => price.tier === tier)?.cents ?? null;
}

/** The card with `row`'s price at `tier` set to `cents`, or left out for null, in the tiers' order. */
function withPrice(row: Row, tier: string, cents: number | null): PricingObject {
  const prices = tiers.value.flatMap((name) => {
    const price = name === tier ? cents : storedCents(row, name);
    return price === null ? [] : [{ tier: name, cents: price }];
  });
  if (row === ELSE) return { ...pricing.value, everyoneElse: prices };
  return withGroups(groups.value.map((group, i) => (i === row ? { ...group, prices } : group)));
}

function withGroups(next: PricingObject['groups']): PricingObject {
  return { ...pricing.value, groups: next };
}

/** A cell's key among the ones being typed in: its row and its tier. */
const cellKey = (row: Row, tier: string) => JSON.stringify([row, tier]);
const cellOf = (key: string) => JSON.parse(key) as [Row, string];

const cells = ref<Record<string, Typing<number | null>>>({});

function cellText(row: Row, tier: string): string {
  return cells.value[cellKey(row, tier)]?.text ?? priceText(storedCents(row, tier));
}

function onPrice(row: Row, tier: string, text: string) {
  const key = cellKey(row, tier);
  // `key in`, not `??`: a blank cell's price before is null, which is a value, not "no entry yet".
  const before = key in cells.value ? cells.value[key].before : storedCents(row, tier);
  cells.value = { ...cells.value, [key]: { text, before } };
  const cents = centsFromText(text);
  const kept = cents === undefined ? before : cents;
  if (kept !== storedCents(row, tier)) write(withPrice(row, tier, kept));
}

/** Leaving a cell redraws it from what is kept, unless what it holds is not an amount. */
function onPriceLeft(row: Row, tier: string) {
  const key = cellKey(row, tier);
  const typing = cells.value[key];
  if (!typing || centsFromText(typing.text) === undefined) return;
  cells.value = Object.fromEntries(Object.entries(cells.value).filter(([other]) => other !== key));
}

const invalidCells = computed(() =>
  Object.entries(cells.value)
    .filter(([, typing]) => centsFromText(typing.text) === undefined)
    .map(([key]) => key),
);
const isInvalid = (row: Row, tier: string) => invalidCells.value.includes(cellKey(row, tier));

/** What each group is called on the screen and to a screen reader: its name, or its place. */
const groupLabels = computed(() =>
  groups.value.map((group, i) => group.name.trim() || `Group ${i + 1}`),
);
const nameProblems = computed(() =>
  groups.value.map((group, i) =>
    groupNameProblem(
      group.name,
      groups.value.map((other) => other.name),
      i,
    ),
  ),
);
/** The groups whose name field has been left: "Name this group." waits for it, so a group just
 * added is not met with an error before anything is typed. Another group's name shows at once. */
const leftNames = ref<Set<number>>(new Set());
const shownNameProblems = computed(() =>
  nameProblems.value.map((problem, i) =>
    problem && (groups.value[i].name.trim() || leftNames.value.has(i)) ? problem : null,
  ),
);
/** Whether each group has a condition the form no longer has: it prices nobody, and holds draft. */
const brokenGroups = computed(() =>
  groups.value.map((group) =>
    group.conditions.some((condition) => brokenCondition(props.questions, condition)),
  ),
);

/** The group just added, whose name field takes the focus once its row is drawn. */
const naming = ref<number | null>(null);

function addGroup() {
  naming.value = groups.value.length;
  write(withGroups([...groups.value, { name: '', conditions: [], prices: [] }]));
}

watch(
  () => groups.value.length,
  () => {
    if (naming.value === null) return;
    document.getElementById(`pricing-group-${naming.value}-name`)?.focus();
    naming.value = null;
  },
  { flush: 'post' },
);

function removeGroup(index: number) {
  write(withGroups(groups.value.filter((_, i) => i !== index)));
  leftNames.value = new Set(
    [...leftNames.value].flatMap((i) => (i < index ? [i] : i > index ? [i - 1] : [])),
  );
  // The text being typed in a later group's cells moves up with its group.
  cells.value = Object.fromEntries(
    Object.entries(cells.value).flatMap(([key, typing]) => {
      const [row, tier] = cellOf(key);
      if (row === ELSE || row < index) return [[key, typing]];
      return row === index ? [] : [[cellKey(row - 1, tier), typing]];
    }),
  );
}

function onName(index: number, name: string) {
  write(withGroups(groups.value.map((group, i) => (i === index ? { ...group, name } : group))));
}

function onNameLeft(index: number) {
  leftNames.value = new Set([...leftNames.value, index]);
  const name = groups.value[index]?.name ?? '';
  if (name !== name.trim()) onName(index, name.trim());
}

function onConditions(index: number, conditions: AnswerCondition[]) {
  write(
    withGroups(groups.value.map((group, i) => (i === index ? { ...group, conditions } : group))),
  );
}

const share = ref<Typing<number> | null>(null);
const shareText = computed(() => share.value?.text ?? String(pricing.value.halfTablePercent));
const shareInvalid = computed(
  () => share.value !== null && percentFromText(share.value.text) === undefined,
);

function onShare(text: string) {
  const before = share.value?.before ?? pricing.value.halfTablePercent;
  share.value = { text, before };
  const kept = percentFromText(text) ?? before;
  if (kept !== pricing.value.halfTablePercent) write({ ...pricing.value, halfTablePercent: kept });
}

function onShareLeft() {
  if (share.value && !shareInvalid.value) share.value = null;
}

function onCurrency(code: string) {
  write({ ...pricing.value, currency: code });
}

/**
 * A tier renamed in Tier Setup keeps its price and the text being typed in its cell, and a removed
 * one's go with it, as the share's text goes with the last tier: otherwise text that is no value
 * would hold the plan with no field left to fix it.
 */
watch(
  () => props.setupObject.tiers.map((tier) => tier.name),
  (after, before) => {
    const next = pricingAfterTierChange(props.setupObject.pricing, before, after);
    if (next !== props.setupObject.pricing && next) write(next);

    const renamed = tierRenamed(before, after);
    const moved = (row: Row, tier: string) =>
      renamed && tier === renamed[0] && !(cellKey(row, renamed[1]) in cells.value)
        ? renamed[1]
        : tier;
    cells.value = Object.fromEntries(
      Object.entries(cells.value)
        .map(([key, typing]) => {
          const [row, tier] = cellOf(key);
          return [row, moved(row, tier), typing] as const;
        })
        .filter(([, tier]) => tiers.value.includes(tier))
        .map(([row, tier, typing]) => [cellKey(row, tier), typing]),
    );
    if (tiers.value.length === 0) share.value = null;
  },
);

const held = computed(
  () => invalidCells.value.length > 0 || shareInvalid.value || nameProblems.value.some(Boolean),
);
watch(held, (value) => emit('held', value));
onBeforeUnmount(() => {
  if (held.value) emit('held', false);
});
</script>

<template>
  <div class="pricing" data-testid="pricing">
    <p v-if="tiers.length === 0" class="pricing-note" data-testid="pricing-no-tiers">
      Prices are set by tier. Add a tier in Tier Setup to price its tables.
    </p>
    <template v-else>
      <!-- Grouped, the table takes the card's width: each group's conditions sit beside its
           prices, in the column that grows, rather than under them with the card's right half
           empty. A table too wide for a narrow card scrolls inside it. -->
      <div class="pricing-frame" :class="{ 'pricing-frame--grouped': groups.length }">
        <table class="pricing-table" data-testid="pricing-table">
          <caption class="pricing-caption">
            A full table for one market day, in
            {{
              pricing.currency
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col" class="pricing-who">Who</th>
              <th
                v-for="(tier, index) in tiers"
                :id="`pricing-tier-${index}`"
                :key="tier"
                scope="col"
              >
                {{ tier }}
              </th>
              <th v-if="groups.length" scope="col" class="pricing-when">In the group when</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(group, g) in groups"
              :key="g"
              class="pricing-group"
              :class="{ broken: brokenGroups[g] }"
              :data-testid="`pricing-group-${g}`"
            >
              <th scope="row" class="pricing-who" :data-testid="`pricing-group-${g}-who`">
                <span :id="`pricing-group-${g}-label`" class="visually-hidden">{{
                  groupLabels[g]
                }}</span>
                <input
                  :id="`pricing-group-${g}-name`"
                  class="field pricing-name"
                  type="text"
                  autocomplete="off"
                  :value="group.name"
                  :aria-label="`Name of group ${g + 1}`"
                  :aria-invalid="shownNameProblems[g] ? true : undefined"
                  :data-testid="`pricing-group-${g}-name`"
                  @input="onName(g, ($event.target as HTMLInputElement).value)"
                  @blur="onNameLeft(g)"
                />
                <span
                  v-if="shownNameProblems[g]"
                  class="pricing-error pricing-name-error"
                  role="alert"
                  :data-testid="`pricing-group-${g}-name-error`"
                  >{{ shownNameProblems[g] }}</span
                >
                <button
                  v-if="!fixed"
                  type="button"
                  class="btn btn--secondary btn--compact pricing-remove"
                  :data-testid="`pricing-group-${g}-remove`"
                  @click="removeGroup(g)"
                >
                  Remove group<span class="visually-hidden"> {{ groupLabels[g] }}</span>
                </button>
              </th>
              <td v-for="(tier, index) in tiers" :key="tier">
                <input
                  class="field pricing-cell"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  :value="cellText(g, tier)"
                  :aria-labelledby="`pricing-group-${g}-label pricing-tier-${index}`"
                  :aria-invalid="isInvalid(g, tier) || undefined"
                  :data-testid="`pricing-group-${g}-price-${index}`"
                  @input="onPrice(g, tier, ($event.target as HTMLInputElement).value)"
                  @blur="onPriceLeft(g, tier)"
                />
              </td>
              <td class="pricing-when">
                <ChoiceConditions
                  :questions="questions"
                  :conditions="group.conditions"
                  :fixed="fixed"
                  :testid="`pricing-group-${g}`"
                  noun="condition"
                  after="includes any of"
                  unticked="Tick the answers that meet it. Until one is ticked, this group prices nobody."
                  :owner="`in ${groupLabels[g]}`"
                  @update:conditions="(next) => onConditions(g, next)"
                />
                <p v-if="!group.conditions.length" class="pricing-note">
                  Until it has a condition, this group prices nobody.
                </p>
                <p
                  v-if="brokenGroups[g]"
                  class="pricing-error"
                  :data-testid="`pricing-group-${g}-broken`"
                >
                  Until the condition the form no longer has is fixed, this group prices nobody, and
                  the market cannot leave draft.
                </p>
              </td>
            </tr>
            <tr class="pricing-else">
              <th
                id="pricing-row-everyone-else"
                scope="row"
                class="pricing-who"
                data-testid="pricing-everyone-else"
              >
                {{ EVERYONE_ELSE }}
              </th>
              <td v-for="(tier, index) in tiers" :key="tier">
                <input
                  class="field pricing-cell"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  :value="cellText(ELSE, tier)"
                  :aria-labelledby="`pricing-row-everyone-else pricing-tier-${index}`"
                  :aria-invalid="isInvalid(ELSE, tier) || undefined"
                  :data-testid="`pricing-price-${index}`"
                  @input="onPrice(ELSE, tier, ($event.target as HTMLInputElement).value)"
                  @blur="onPriceLeft(ELSE, tier)"
                />
              </td>
              <td v-if="groups.length" class="pricing-when pricing-note">In no group</td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        v-if="!fixed && questions.length"
        type="button"
        class="btn btn--secondary pricing-add"
        data-testid="pricing-add-group"
        @click="addGroup"
      >
        Add a group
      </button>
      <p
        v-else-if="!fixed && !groups.length"
        class="pricing-note"
        data-testid="pricing-no-questions"
      >
        A price group reads the form's questions with answers to choose from, and this form asks
        none yet, so every vendor pays “{{ EVERYONE_ELSE }}”.
      </p>
      <p v-if="invalidCells.length" class="pricing-error" role="alert" data-testid="pricing-error">
        Enter a price like 35 or 35.50, or leave it blank for no price.
      </p>
    </template>

    <div v-if="tiers.length" class="pricing-options">
      <label class="pricing-half">
        Half table costs
        <input
          class="field pricing-percent"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :value="shareText"
          :aria-invalid="shareInvalid || undefined"
          data-testid="pricing-half-percent"
          @input="onShare(($event.target as HTMLInputElement).value)"
          @blur="onShareLeft"
        />
        % of a full table
      </label>
      <label class="pricing-currency">
        Currency
        <select
          class="field field--select"
          :value="pricing.currency"
          data-testid="pricing-currency"
          @change="onCurrency(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="currency in CURRENCIES" :key="currency.code" :value="currency.code">
            {{ currency.code }} - {{ currency.name }}
          </option>
        </select>
      </label>
    </div>
    <p v-if="shareInvalid" class="pricing-error" role="alert" data-testid="pricing-share-error">
      The half table's share is a whole number from 0 to 100.
    </p>
    <p v-if="tiers.length" class="pricing-note">
      Optional. A tier left blank has no price, and a market with no prices shows none.
    </p>
    <p v-if="tiers.length && groups.length" class="pricing-note">
      A vendor is in a group when every one of its conditions holds of their answers. They pay the
      cheapest group they are in at their table's tier, and “{{ EVERYONE_ELSE }}” where they are in
      none or their groups leave the tier blank.
    </p>
  </div>
</template>

<style scoped>
.pricing {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* The plan's ink: unset, its labels took the app's default slate beside the other cards' black. */
  color: var(--mm-black);
}

/* As wide as its columns, not the card: a price is a short field, and stretched across a wide card
   each one sat at the left of a column hundreds of pixels wide. */
.pricing-table {
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.pricing-caption {
  caption-side: top;
  padding-bottom: var(--space-2);
  text-align: left;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.pricing-table th {
  padding: var(--space-1) var(--space-2);
  text-align: left;
  font-weight: 600;
}

.pricing-table td {
  padding: var(--space-1) var(--space-2);
}

/* One 1px divider between columns, as on the plan's other tables. */
.pricing-table :is(th, td) + :is(th, td) {
  border-left: 1px solid var(--mm-border);
}

.pricing-table thead th {
  border-bottom: 1px solid var(--mm-border);
}

.pricing-who {
  min-width: 10rem;
}

.pricing-cell {
  width: 8rem;
}

/* Wide enough for a name like "Student + club member" whole. */
.pricing-name {
  width: 100%;
  min-width: 15rem;
}

.pricing-name-error {
  display: block;
  margin-top: var(--space-1);
  font-weight: 400;
}

/* As wide as its columns with no groups; grouped, as wide as the card, the conditions' column
   taking what the prices leave. Too wide for a narrow card, it scrolls inside the card. */
.pricing-frame {
  align-self: flex-start;
  max-width: 100%;
  overflow-x: auto;
}

.pricing-frame--grouped {
  align-self: stretch;
}

.pricing-frame--grouped .pricing-table {
  width: 100%;
}

/* A row's cells start at its top: a group's conditions and its name's error run taller than its
   prices, which stay level with the name. */
.pricing-table :is(th, td) {
  vertical-align: top;
}

/* Each group's row, and "Everyone else", ruled off from the next. */
.pricing-table tbody tr + tr {
  border-top: 1px solid var(--mm-border);
}

.pricing-table tbody :is(th, td) {
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}

.pricing-when {
  width: 100%;
}

/* "Everyone else" holds nothing taller than its prices, so its row stays centred on them. */
.pricing-table .pricing-else :is(th, td) {
  vertical-align: middle;
}

.pricing-when > * + * {
  margin-top: var(--space-2);
}

.pricing-remove {
  display: block;
  margin-top: var(--space-2);
}

.pricing-add {
  align-self: flex-start;
}

.pricing-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-6);
  font-size: var(--text-sm);
}

.pricing-half,
.pricing-currency {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.pricing-percent {
  width: 4.5rem;
}

.pricing-currency .field--select {
  width: auto;
}

/* What is not yet saved, marked where it was typed as well as in the line below the table. */
.field[aria-invalid='true'] {
  border-color: var(--mm-red);
}

.pricing-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.pricing-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
