<script setup lang="ts">
/**
 * The day's roster on paper (T318): the door's fallback when the venue's network or the back end
 * fails. Attendance renders it for the chosen date, and it shows only in print, where it takes the
 * place of the app.
 *
 * The market, the date in words, how many are expected and when it was printed, so the door knows
 * which copy is current; then every vendor of the date by table, their name with their address
 * under it, and when they came or an empty box to tick. It lists every row whatever the page's
 * Show toggle and search leave on screen, since a sheet printed with a filter on would leave the
 * door without the vendors it hid. Notes are not printed.
 *
 * Teleported to `body`, beside the app, so printing can hide the app and keep the sheet, as the
 * door code's poster does ([`DoorCodeScreen.vue`](DoorCodeScreen.vue)).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import EmailAddress from '@/components/EmailAddress.vue';
import { getFormattedDate, getFormattedTimestamp, plural } from '@/utils/utils';

/** One vendor's line: where they sit, who they are, and when they came, or null for a box. */
export interface PrintedRow {
  key: string;
  email: string;
  name: string;
  table: string;
  here: string | null;
}

const props = defineProps<{
  marketName: string;
  /** The market date, `YYYY-MM-DD`. */
  date: string;
  /** The date's seats, as the day's tally counts them. */
  expected: number;
  seated: PrintedRow[];
  /** Checked in with no table on the date, printed under `unseatedHeading`. */
  unseated: PrintedRow[];
  unseatedHeading: string;
}>();

const dateInWords = computed(() => getFormattedDate(props.date) ?? props.date);

/** When the sheet was printed: set again as the browser lays out a print, from any menu. */
const printedAt = ref(new Date());
function stamp(): void {
  printedAt.value = new Date();
}
onMounted(() => window.addEventListener('beforeprint', stamp));
onUnmounted(() => window.removeEventListener('beforeprint', stamp));

const lists = computed(() =>
  [
    { key: 'seated', heading: '', rows: props.seated },
    { key: 'unseated', heading: props.unseatedHeading, rows: props.unseated },
  ].filter((list) => list.rows.length > 0),
);
</script>

<template>
  <Teleport to="body">
    <section class="door-roster-print" data-testid="attendance-print-sheet">
      <header class="print-head">
        <h1 class="print-market" data-testid="attendance-print-market">{{ marketName }}</h1>
        <p class="print-day">
          <span data-testid="attendance-print-date">{{ dateInWords }}</span>
          <span class="print-count" data-testid="attendance-print-count">{{
            plural(expected, 'vendor', 'vendors')
          }}</span>
        </p>
        <p class="print-printed" data-testid="attendance-print-printed">
          Printed {{ getFormattedTimestamp(printedAt.toISOString()) }}
        </p>
      </header>
      <template v-for="list in lists" :key="list.key">
        <h2
          v-if="list.heading"
          class="print-heading"
          data-testid="attendance-print-unseated-heading"
        >
          {{ list.heading }}
        </h2>
        <table class="print-table">
          <thead>
            <tr>
              <th scope="col" class="print-col-table">Table</th>
              <th scope="col">Vendor</th>
              <th scope="col" class="print-col-here">Here</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in list.rows"
              :key="row.key"
              data-testid="attendance-print-row"
              :data-vendor="row.email"
            >
              <td data-testid="attendance-print-table">{{ row.table }}</td>
              <td>
                <!-- An address breaks only before its "@" or a dot, as everywhere in the app. -->
                <span class="print-name" data-testid="attendance-print-name"
                  ><EmailAddress :words="row.name || row.email"
                /></span>
                <span v-if="row.name" class="print-email" data-testid="attendance-print-email"
                  ><EmailAddress :words="row.email"
                /></span>
              </td>
              <td data-testid="attendance-print-here">
                <template v-if="row.here">{{ row.here }}</template>
                <span v-else class="print-box" data-testid="attendance-print-box"></span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </Teleport>
</template>

<style scoped>
/* Paper only: on screen the roster is the page itself. */
.door-roster-print {
  display: none;
}

/* In this block, so each rule is as specific as the screen's own and wins after it. */
@media print {
  .door-roster-print {
    display: block;
    color: var(--mm-black);
    font-size: 11pt;
  }

  .print-head {
    margin-bottom: var(--space-4);
  }

  .print-market {
    margin: 0;
    font-size: 20pt;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .print-day {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-1) 0 0;
    font-size: 14pt;
  }

  /* On each element, not its parent: the app's reset sets every element's weight, so none is
     inherited. */
  .print-day > span {
    font-weight: 600;
  }

  .print-printed {
    margin: var(--space-1) 0 0;
    color: var(--mm-text-muted);
    font-size: 10pt;
  }

  .print-heading {
    margin: var(--space-6) 0 var(--space-2);
    font-size: 13pt;
    font-weight: 600;
  }

  /* The page's width, and never wider: a long address breaks rather than run off the paper. */
  .print-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }

  .print-table th,
  .print-table td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--mm-border);
    text-align: start;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  .print-table th {
    border-bottom-color: var(--mm-black);
    font-size: 10pt;
    font-weight: 600;
  }

  .print-table tr {
    break-inside: avoid;
  }

  .print-col-table {
    width: 30%;
  }

  .print-col-here {
    width: 28%;
  }

  .print-table td:first-child {
    font-variant-numeric: tabular-nums;
  }

  .print-name,
  .print-name :deep(*) {
    font-weight: 600;
  }

  .print-name {
    display: block;
  }

  .print-email {
    display: block;
    color: var(--mm-text-muted);
    font-size: 10pt;
  }

  /* A box to tick by hand as the vendor arrives. */
  .print-box {
    display: inline-block;
    width: 0.5cm;
    height: 0.5cm;
    border: 1.5pt solid var(--mm-black);
  }
}
</style>

<!-- Not scoped: the app is a sibling of this sheet under `body`, so printing hides the app and the
     page carries the roster alone. While the door code's screen is open its poster prints instead,
     and its own rule hides this sheet. -->
<style>
@media print {
  @page {
    /* stylelint-disable-next-line declaration-property-value-allowed-list -- the sheet's own margin, in print's units, not the screen's spacing */
    margin: 1.5cm;
  }

  body:has(> .door-roster-print):not(:has(> .door-code)) > :not(.door-roster-print) {
    display: none !important;
  }
}
</style>
