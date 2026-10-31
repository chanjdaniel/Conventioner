<script setup lang="ts">
/**
 * The last "Give roles" run's report (E46/F01/S04), kept on the market so every reader of the
 * Vendors page reads it: the role and when it last ran (never "given", since a run may give nobody
 * the role), how many ended in each outcome, and, opened, each group's vendors, a failure's reason,
 * or why the rest are not given yet, said once for the vendors it held back.
 */
import { computed, ref } from 'vue';

import VendorIdentity from '@/components/VendorIdentity.vue';
import type { DiscordRoleRun } from '@/assets/types/datatypes';
import { agoWords } from '@/utils/discordCheck';
import {
  roleOutcomeChip,
  roleOutcomeLabel,
  roleRunCounts,
  roleRunGroups,
  roleRunSummary,
} from '@/utils/discordRoles';
import type { VendorNames } from '@/utils/vendorIdentity';

const props = defineProps<{
  run: DiscordRoleRun;
  /** Each vendor's address by their application's id, as the page lists them. */
  addresses: Map<string, string>;
  names: VendorNames;
  now: number;
}>();

const opened = ref(false);
const groups = computed(() => roleRunGroups(props.run));
const summary = computed(() => roleRunSummary(roleRunCounts(props.run)));
const when = computed(() =>
  agoWords(props.run.ranAt, Math.max(props.now, Date.parse(props.run.ranAt))),
);
</script>

<template>
  <section
    class="role-report"
    aria-labelledby="role-report-title"
    data-testid="vendors-role-report"
  >
    <p class="role-report-line">
      <span id="role-report-title" class="role-report-title"
        >{{ run.roleName || 'The role' }}, last run {{ when }}</span
      >
      <span class="role-report-summary" data-testid="vendors-role-report-summary">{{
        summary
      }}</span>
      <button
        v-if="groups.length"
        type="button"
        class="role-report-toggle"
        :aria-expanded="opened"
        aria-controls="role-report-groups"
        data-testid="vendors-role-report-toggle"
        @click="opened = !opened"
      >
        {{ opened ? 'Hide who' : 'Show who' }}
      </button>
    </p>
    <div v-if="opened" id="role-report-groups" class="role-report-groups">
      <div
        v-for="group in groups"
        :key="`${group.outcome}:${group.reason}`"
        class="role-report-group"
        data-testid="vendors-role-report-group"
      >
        <p class="role-report-group-head">
          <span :class="roleOutcomeChip(group.outcome)">{{ roleOutcomeLabel(group.outcome) }}</span>
          <span class="role-report-count">{{ group.applicationIds.length }}</span>
        </p>
        <p v-if="group.reason" class="role-report-reason" data-testid="vendors-role-report-reason">
          {{ group.reason }}
        </p>
        <ul class="role-report-vendors">
          <li v-for="id in group.applicationIds" :key="id">
            <VendorIdentity v-if="addresses.get(id)" :email="addresses.get(id)" :names="names" />
            <span v-else class="role-report-gone">A vendor no longer listed</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.role-report {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

/* The title, the counts and the toggle: one line that wraps on a phone. */
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

.role-report-toggle {
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
