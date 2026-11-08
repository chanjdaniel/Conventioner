<script setup lang="ts">
/**
 * The last "Give roles" run's report (E46/F01/S04), kept on the market so every reader of the
 * Vendors page reads it: the role and when it last ran (never "given", since a run may give nobody
 * the role), how many ended in each outcome, and, in a dialog so that up to every vendor never
 * pushes the table down, each group's vendors, a failure's reason, or why the rest are not given
 * yet, said once for the vendors it held back. A vendor it did not find whom the check offers a
 * possible match now is counted beside "not found", since their row says "Possible match".
 *
 * The dialog is a `ListFrame` over one row per vendor (T223, L9), so a report of every vendor finds
 * one by name or address and draws 50 at a time; each group's outcome, whole count, reason and
 * possible-match line stand over its first drawn row, and a group with none drawn is not there. A
 * vendor the page no longer lists has no words to be found by. The words last as long as the dialog.
 */
import { computed, ref, useId } from 'vue';

import AppDialog from '@/components/AppDialog.vue';
import ListFrame, { LIST_FIND_FROM } from '@/components/ListFrame.vue';
import VendorIdentity from '@/components/VendorIdentity.vue';
import type { DiscordRoleRun } from '@/assets/types/datatypes';
import { agoWords } from '@/utils/discordCheck';
import {
  possibleMatchesLine,
  roleOutcomeChip,
  roleOutcomeLabel,
  roleRunCounts,
  roleRunGroupKey,
  roleRunGroups,
  roleRunGroupsDrawn,
  roleRunPossibleMatches,
  roleRunRows,
  roleRunSummary,
  type RoleRunRow,
} from '@/utils/discordRoles';
import { vendorMatches, type VendorNames } from '@/utils/vendorIdentity';

const props = defineProps<{
  run: DiscordRoleRun;
  /** Each vendor's address by their application's id, as the page lists them. */
  addresses: Map<string, string>;
  names: VendorNames;
  /** The names on their identification, so someone going by another is found as the page finds them. */
  legalNames?: VendorNames;
  now: number;
  /** The application ids the check offers a possible match now. */
  offered: ReadonlySet<string>;
}>();

const opened = ref(false);
/** Its own, since the library draws two reports on one page. */
const titleId = `${useId()}-role-report-title`;
const groups = computed(() => roleRunGroups(props.run));
const possibleMatches = computed(() => roleRunPossibleMatches(props.run, props.offered));
const summary = computed(() => roleRunSummary(roleRunCounts(props.run), possibleMatches.value));
const when = computed(() =>
  agoWords(props.run.ranAt, Math.max(props.now, Date.parse(props.run.ranAt))),
);
const title = computed(() => `${props.run.roleName || 'The role'}, last run ${when.value}`);

const VENDOR = { one: 'vendor', many: 'vendors' };
const rows = computed(() => roleRunRows(groups.value, props.addresses));
const rowKey = (row: RoleRunRow) => row.key;
const findsRow = (row: RoleRunRow, words: string) =>
  Boolean(row.email) && vendorMatches(words, row.email, props.names, props.legalNames);
/**
 * At 12 or fewer the dialog reads as it did, with no field: given `finds`, the frame would still say
 * "12 vendors" over the groups, which count themselves.
 */
const finds = computed(() => (rows.value.length > LIST_FIND_FROM ? findsRow : undefined));
</script>

<template>
  <section class="role-report" :aria-labelledby="titleId" data-testid="vendors-role-report">
    <p class="role-report-line">
      <span :id="titleId" class="role-report-title" data-testid="vendors-role-report-title">{{
        title
      }}</span>
      <span class="role-report-summary" data-testid="vendors-role-report-summary">{{
        summary
      }}</span>
      <button
        v-if="groups.length"
        type="button"
        class="role-report-open"
        data-testid="vendors-role-report-open"
        @click="opened = true"
      >
        Show who
      </button>
    </p>
    <AppDialog
      :open="opened"
      :title="title"
      testid="vendors-role-report-who"
      size="wide"
      scroll="body"
      @close="opened = false"
    >
      <ListFrame
        :items="rows"
        :finds="finds"
        :itemKey="rowKey"
        :noun="VENDOR"
        findLabel="Find by name or address"
        testid="vendors-role-report-list"
      >
        <template #rows="{ rows: drawn }">
          <!-- One box, or the frame's gap would come between each group as well as its own. -->
          <div class="role-report-groups">
            <div
              v-for="{ group, rows: vendors } in roleRunGroupsDrawn(drawn)"
              :key="roleRunGroupKey(group)"
              class="role-report-group"
              data-testid="vendors-role-report-group"
            >
              <p class="role-report-group-head">
                <span :class="roleOutcomeChip(group.outcome)">{{
                  roleOutcomeLabel(group.outcome)
                }}</span>
                <span class="role-report-count">{{ group.applicationIds.length }}</span>
              </p>
              <p
                v-if="group.reason"
                class="role-report-reason"
                data-testid="vendors-role-report-reason"
              >
                {{ group.reason }}
              </p>
              <p
                v-if="group.outcome === 'not_found' && possibleMatches"
                class="role-report-reason"
                data-testid="vendors-role-report-matches"
              >
                {{ possibleMatchesLine(possibleMatches) }}
              </p>
              <ul class="role-report-vendors">
                <li
                  v-for="row in vendors"
                  :key="row.key"
                  data-list-row
                  tabindex="-1"
                  data-testid="vendors-role-report-vendor"
                >
                  <VendorIdentity v-if="row.email" :email="row.email" :names="names" />
                  <span v-else class="role-report-gone">A vendor no longer listed</span>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </ListFrame>
    </AppDialog>
  </section>
</template>

<style scoped>
.role-report {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

/* The title, the counts and the button: one line that wraps on a phone. */
.role-report-line {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--space-3);
  row-gap: var(--space-1);
  font-size: var(--text-sm);
}

.role-report-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.role-report-summary {
  color: var(--mm-text-muted);
}

.role-report-open {
  --focus-border-offset: var(--focus-border-width);
  min-height: var(--target-min);
  padding: 0;
  border: 0;
  background: none;
  color: var(--mm-green);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.role-report-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.role-report-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.role-report-group-head {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.role-report-count {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.role-report-reason {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.role-report-vendors {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.role-report-vendors li {
  min-width: 0;
  overflow-wrap: anywhere;
}

.role-report-gone {
  color: var(--mm-text-muted);
}
</style>
