<script setup lang="ts">
/**
 * A list of history entries, newest first: each a sentence, when it happened, and its before and
 * after behind a toggle. Manage market's History (`MarketHistory.vue`, E40/F01/S03) and Manage
 * organization's (`OrganizationHistory.vue`, E40/F02/S01) both draw their entries with it, so the
 * two read alike; each reads its own pages and says when it has none.
 */
import { onMounted, onUpdated, ref } from 'vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { IntakeMode, type FormField, type RejectionQuestion } from '@/assets/types/datatypes';
import type { VendorNames } from '@/utils/vendorIdentity';
import {
  addressParts,
  entryChanges,
  entryParts,
  entryWhen,
  soleColumn,
  type MarketHistoryEntry,
} from '@/utils/marketHistory';

const props = withDefaults(
  defineProps<{
    entries: MarketHistoryEntry[];
    /** The prefix of every test id: `market-history`, `org-history`. */
    testid: string;
    names?: VendorNames;
    /** Each row of the table by its label, for a change to a row. */
    labels?: Readonly<Record<string, string>>;
    /** How the market's vendors arrive, so a phase reads as its other screens name it. */
    path?: IntakeMode;
    /** Where a vendor named in an entry opens; without it a vendor is drawn as text. */
    vendorLink?: (email: string) => RouteLocationRaw;
    /** The vendor whose own history this is, in their drawer: named by name alone, as text. */
    ownVendor?: string;
    /** The market's choice questions, so a price group's conditions read in the card's words. */
    questions?: readonly RejectionQuestion[];
    /** The market's form, whose questions name a vendor's answers. */
    fields?: readonly FormField[];
  }>(),
  {
    names: () => ({}),
    labels: () => ({}),
    path: IntakeMode.Csv,
    vendorLink: undefined,
    ownVendor: '',
    questions: () => [],
    fields: () => [],
  },
);

const opened = ref<Set<string>>(new Set());

function toggle(id: string) {
  const now = new Set(opened.value);
  if (now.has(id)) now.delete(id);
  else now.add(id);
  opened.value = now;
}

/** Longer field names than this wrap; shorter ones keep to one line. */
const LONG_FIELD = 32;

const changesOf = (entry: MarketHistoryEntry) =>
  entryChanges(entry, props.labels, props.path, props.questions, props.ownVendor, props.fields);

/** The value columns an entry's table draws: Before and After, or the one an arrival needs. */
function valueColumns(entry: MarketHistoryEntry): string[] {
  const sole = soleColumn(entry, changesOf(entry).changed);
  return sole ? [sole] : ['Before', 'After'];
}

/**
 * One Field width for the whole list, so the value columns line up down it: as wide as the widest
 * name of any table open, a long name counted at the most a name is given (it wraps there).
 */
const FIELD_MOST_REM = 12;
const list = ref<HTMLOListElement | null>(null);
const fieldWidth = ref('');

function measureFields() {
  const names = list.value?.querySelectorAll<HTMLElement>('.history-field-name') ?? [];
  const cell = names[0]?.parentElement;
  if (!cell) {
    fieldWidth.value = '';
    return;
  }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const most = FIELD_MOST_REM * rem;
  let widest = 0;
  for (const name of names) {
    const long = name.parentElement?.classList.contains('history-field--long');
    widest = Math.max(widest, long ? most : Math.min(name.getBoundingClientRect().width, most));
  }
  const style = getComputedStyle(cell);
  const chrome =
    parseFloat(style.paddingLeft) +
    parseFloat(style.paddingRight) +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.borderRightWidth);
  const next = widest ? `${Math.ceil(widest + (chrome || 0))}px` : '';
  if (fieldWidth.value !== next) fieldWidth.value = next;
}
onMounted(measureFields);
onUpdated(measureFields);
</script>

<template>
  <ol
    ref="list"
    class="history-list"
    :style="fieldWidth ? { '--history-field-width': fieldWidth } : undefined"
  >
    <li
      v-for="entry in entries"
      :key="entry.id"
      class="history-entry"
      :data-action="entry.action"
      :data-testid="`${testid}-entry`"
    >
      <p class="history-what" :data-testid="`${testid}-sentence`">
        <template
          v-for="(part, index) in entryParts(entry, names, labels, path, ownVendor)"
          :key="index"
        >
          <template v-if="part.kind === 'text'">{{ part.text }}</template>
          <!-- The drawer's head names them with their address, so here the name is enough. -->
          <span
            v-else-if="ownVendor && part.email.toLowerCase() === ownVendor"
            class="history-vendor-self"
            :data-testid="`${testid}-own-vendor`"
            >{{ part.name || part.email }}</span
          >
          <component
            :is="vendorLink ? RouterLink : 'span'"
            v-else
            :to="vendorLink ? vendorLink(part.email) : undefined"
            :class="{ 'history-vendor': vendorLink }"
            :data-testid="`${testid}-vendor-link`"
            >{{ part.name || part.email
            }}<template v-if="part.name"
              >{{ ' ' }}<span class="history-email">{{ part.email }}</span></template
            ></component
          >
        </template>
      </p>
      <div class="history-meta">
        <span class="history-when" :data-testid="`${testid}-when`">{{ entryWhen(entry) }}</span>
        <button
          type="button"
          class="history-toggle"
          :aria-expanded="opened.has(entry.id)"
          :aria-controls="`${testid}-changes-${entry.id}`"
          :data-testid="`${testid}-toggle`"
          @click="toggle(entry.id)"
        >
          {{ opened.has(entry.id) ? 'Hide before and after' : 'Before and after' }}
        </button>
      </div>
      <div
        v-if="opened.has(entry.id)"
        :id="`${testid}-changes-${entry.id}`"
        class="history-changes"
        :data-testid="`${testid}-changes`"
      >
        <table v-if="changesOf(entry).changed.length" class="history-table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th v-for="column in valueColumns(entry)" :key="column" scope="col">
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in changesOf(entry).changed" :key="row.field">
              <th scope="row" :class="{ 'history-field--long': row.field.length > LONG_FIELD }">
                <span class="history-field-name">{{ row.field }}</span>
              </th>
              <td
                v-for="(side, s) in valueColumns(entry).length === 1
                  ? [row.after]
                  : [row.before, row.after]"
                :key="s"
              >
                <template v-if="row.hanging">
                  <span
                    v-for="(line, i) in side.split('\n')"
                    :key="i"
                    class="history-line"
                    :data-testid="`${testid}-line`"
                    >{{ line }}</span
                  >
                </template>
                <!-- An address breaks, if at all, only before its "@". -->
                <template v-for="(part, p) in addressParts(side)" v-else :key="p">
                  <template v-if="part.kind === 'text'">{{ part.text }}</template>
                  <template v-else
                    ><span class="history-address">{{ part.local }}</span
                    ><wbr /><span class="history-address">{{ part.domain }}</span></template
                  >
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <dl v-if="changesOf(entry).recorded.length" class="history-recorded">
          <template v-for="row in changesOf(entry).recorded" :key="row.field">
            <dt>{{ row.field }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
        <p
          v-if="!changesOf(entry).changed.length && !changesOf(entry).recorded.length"
          class="history-note"
        >
          Nothing more was recorded about this change.
        </p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.history-list {
  /* Until a table is open and measured; `measureFields` sets it on the list. */
  --history-field-width: 22%;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.history-entry {
  border-left: 3px solid var(--mm-border);
  padding: var(--space-2) 0 var(--space-2) var(--space-3);
}

.history-what {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.history-vendor {
  color: var(--mm-green);
  text-decoration: underline;
}

/* The drawer's own vendor, named in their own history: no link to where the reader already is. */
.history-vendor-self {
  font-weight: 600;
}

/* The address beside the name, muted, so the line still reads as a sentence. */
.history-email {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.history-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  margin-top: var(--space-hairline);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.history-toggle {
  min-height: var(--target-min);
  padding: 0;
  border: 0;
  background: none;
  color: var(--mm-green);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.history-changes {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* One Field width for the whole list (`--history-field-width`, the widest name of any open table),
   so Before and After, halves of the rest, line up down it; each name on one line unless it is
   long. An entry whose every Before is "none" draws its one value across the rest. */
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
  table-layout: fixed;
}

.history-table th,
.history-table td {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--mm-border);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

/* Every value keeps its line breaks: a price group's prices and each of its conditions
   (`groupText`), and as well a vendor note's lines and an Update info answer's, which ran into one
   before and now read as the drawer shows them. Runs of spaces still collapse. */
.history-table td {
  white-space: pre-line;
}

/* A row whose lines hang (a price group's prices, then each condition): a line that wraps goes on
   indented under itself, so its tail never reads as a line of its own. */
.history-line {
  display: block;
  padding-left: var(--space-3);
  text-indent: calc(-1 * var(--space-3));
}

/* The field's name is a few words; the values beside it are what is read. */
.history-table thead th:first-child {
  width: var(--history-field-width);
}

.history-table tbody th {
  white-space: nowrap;
}

/* An organizer's long question wraps in a column of its own width rather than squeezing both
   values into slivers. */
.history-table tbody th.history-field--long {
  white-space: normal;
}

.history-address {
  white-space: nowrap;
}

.history-table thead th {
  color: var(--mm-text-muted);
  font-weight: 400;
}

.history-table tbody th {
  font-weight: 600;
  color: var(--mm-black);
}

.history-recorded {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--text-xs);
}

.history-recorded dt {
  color: var(--mm-text-muted);
}

.history-recorded dd {
  margin: 0;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.history-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
