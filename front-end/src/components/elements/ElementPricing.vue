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
import { computed, ref, watch } from 'vue';
import type { PricingObject, SetupObject } from '@/assets/types/datatypes';
import {
  CURRENCIES,
  UNPRICED,
  centsFromText,
  priceText,
  pricingAfterTierChange,
} from '@/utils/pricing';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits<{ (event: 'update:setupObject', value: SetupObject): void }>();

const pricing = computed<PricingObject>(() => props.setupObject.pricing ?? UNPRICED);

/** The columns: each tier the plan names, once, in its order; a tier still unnamed has none. */
const tiers = computed(() => [
  ...new Set(props.setupObject.tiers.map((tier) => tier.name).filter((name) => name.trim())),
]);

function write(next: PricingObject) {
  emit('update:setupObject', { ...props.setupObject, pricing: next });
}

// A tier renamed in Tier Setup keeps its price, and a removed one's goes with it.
watch(
  () => props.setupObject.tiers.map((tier) => tier.name),
  (after, before) => {
    const next = pricingAfterTierChange(props.setupObject.pricing, before, after);
    if (next !== props.setupObject.pricing && next) write(next);
  },
);

/** What is typed in a cell that is not yet an amount, by tier; a cell shows its price otherwise. */
const drafts = ref<Record<string, string>>({});

function cellText(tier: string): string {
  return (
    drafts.value[tier] ??
    priceText(pricing.value.everyoneElse.find((price) => price.tier === tier)?.cents)
  );
}

function onPrice(tier: string, text: string) {
  const cents = centsFromText(text);
  if (cents === undefined) {
    drafts.value = { ...drafts.value, [tier]: text };
    return;
  }
  drafts.value = Object.fromEntries(
    Object.entries(drafts.value).filter(([typed]) => typed !== tier),
  );
  const rest = pricing.value.everyoneElse.filter((price) => price.tier !== tier);
  const everyoneElse =
    cents === null
      ? rest
      : tiers.value.flatMap((name) =>
          name === tier ? [{ tier, cents }] : rest.filter((price) => price.tier === name),
        );
  write({ ...pricing.value, everyoneElse });
}

const invalidCells = computed(() => Object.keys(drafts.value));

const percentDraft = ref<string | null>(null);
const percentText = computed(() => percentDraft.value ?? String(pricing.value.halfTablePercent));

function onPercent(text: string) {
  const percent = /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : NaN;
  if (!(percent >= 0 && percent <= 100)) {
    percentDraft.value = text;
    return;
  }
  percentDraft.value = null;
  write({ ...pricing.value, halfTablePercent: percent });
}

function onCurrency(code: string) {
  write({ ...pricing.value, currency: code });
}
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
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="invalidCells.length" class="pricing-error" role="alert" data-testid="pricing-error">
        Enter a price like 35 or 35.50, or leave it blank for no price.
      </p>
    </template>

    <div class="pricing-options">
      <label class="pricing-half">
        Half table costs
        <input
          class="field pricing-percent"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :value="percentText"
          :aria-invalid="percentDraft !== null || undefined"
          data-testid="pricing-half-percent"
          @input="onPercent(($event.target as HTMLInputElement).value)"
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
    <p v-if="percentDraft !== null" class="pricing-error" role="alert">
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
