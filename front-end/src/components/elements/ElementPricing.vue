<script setup lang="ts">
/**
 * The Pricing card (E43/F01/S01): what one table costs for one market day, at each tier.
 *
 * Its columns are the market's tiers and its one row is "Everyone else"; price groups add rows
 * above it (E43/F01/S02). A half table costs a share of the full price, 50% unless the organizer
 * says otherwise, and the market has one currency, Canadian dollars unless they pick another.
 * Pricing is optional: a blank cell is a tier with no price, and a market with no prices shows
 * none anywhere. It speaks of tiers only, never of any one market's questions (Q14).
 *
 * It sits in the plan's fieldset, so it settles with the rest of the setup on leaving draft.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { PricingObject, SetupObject } from '@/assets/types/datatypes';
import {
  CURRENCIES,
  UNPRICED,
  centsFromText,
  percentFromText,
  priceText,
  pricingAfterTierChange,
  tierRenamed,
} from '@/utils/pricing';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits<{
  (event: 'update:setupObject', value: SetupObject): void;
  /** Whether a field holds text that is not a value, so the plan waits rather than saving. */
  (event: 'held', value: boolean): void;
}>();

const pricing = computed<PricingObject>(() => props.setupObject.pricing ?? UNPRICED);

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
 * into "125" a keystroke at a time. Text that is not a value keeps the value from before, so the
 * plan never holds a prefix nobody chose ("15" on the way to "150"), and is shown until it is fixed.
 */
interface Typing<V> {
  text: string;
  before: V;
}

function storedCents(tier: string): number | null {
  return pricing.value.everyoneElse.find((price) => price.tier === tier)?.cents ?? null;
}

/** The prices with `tier`'s set to `cents`, or left out for null, in the tiers' order. */
function withPrice(tier: string, cents: number | null): PricingObject {
  const everyoneElse = tiers.value.flatMap((name) => {
    const price = name === tier ? cents : storedCents(name);
    return price === null ? [] : [{ tier: name, cents: price }];
  });
  return { ...pricing.value, everyoneElse };
}

const cells = ref<Record<string, Typing<number | null>>>({});

function cellText(tier: string): string {
  return cells.value[tier]?.text ?? priceText(storedCents(tier));
}

function onPrice(tier: string, text: string) {
  // `tier in`, not `??`: a blank cell's price before is null, which is a value, not "no entry yet".
  const before = tier in cells.value ? cells.value[tier].before : storedCents(tier);
  cells.value = { ...cells.value, [tier]: { text, before } };
  const cents = centsFromText(text);
  const kept = cents === undefined ? before : cents;
  if (kept !== storedCents(tier)) write(withPrice(tier, kept));
}

/** Leaving a cell redraws it from what is kept, unless what it holds is not an amount. */
function onPriceLeft(tier: string) {
  const typing = cells.value[tier];
  if (!typing || centsFromText(typing.text) === undefined) return;
  cells.value = Object.fromEntries(Object.entries(cells.value).filter(([name]) => name !== tier));
}

const invalidCells = computed(() =>
  Object.entries(cells.value)
    .filter(([, typing]) => centsFromText(typing.text) === undefined)
    .map(([tier]) => tier),
);

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
    const moved = (tier: string) =>
      renamed && tier === renamed[0] && !(renamed[1] in cells.value) ? renamed[1] : tier;
    cells.value = Object.fromEntries(
      Object.entries(cells.value)
        .map(([tier, typing]) => [moved(tier), typing] as const)
        .filter(([tier]) => tiers.value.includes(tier)),
    );
    if (tiers.value.length === 0) share.value = null;
  },
);

const held = computed(() => invalidCells.value.length > 0 || shareInvalid.value);
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
          </tr>
        </thead>
        <tbody>
          <tr>
            <th id="pricing-row-everyone-else" scope="row" class="pricing-who">Everyone else</th>
            <td v-for="(tier, index) in tiers" :key="tier">
              <input
                class="field pricing-cell"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                :value="cellText(tier)"
                :aria-labelledby="`pricing-row-everyone-else pricing-tier-${index}`"
                :aria-invalid="invalidCells.includes(tier) || undefined"
                :data-testid="`pricing-price-${index}`"
                @input="onPrice(tier, ($event.target as HTMLInputElement).value)"
                @blur="onPriceLeft(tier)"
              />
            </td>
          </tr>
        </tbody>
      </table>
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
  align-self: flex-start;
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
