<script setup lang="ts">
/**
 * A permission table's rows under their groups (E39/F01/S04): each row's label, where its role
 * came from, and a "Who may" select for someone who may change it, else a chip naming who may.
 *
 * Manage market's Permissions section shows a market's table with it, and Manage organization's
 * default permissions the table its new markets copy (E39/F02/S01). A choice is not sent from
 * here: the section asks about it first, and puts the select back if it is cancelled.
 */
import { computed } from 'vue';
import { MarketRole, type PermissionTableRow } from '@/assets/types/datatypes';
import {
  WHO_MAY_CHOICES,
  groupedRows,
  selfPromotionNote,
  whoMayLabel,
} from '@/utils/permissionTable';

const props = defineProps<{
  table: PermissionTableRow[];
  /** Whether the person may change the table: a select on each row that is not fixed. */
  editable: boolean;
  /** Where a row's role came from, in the section's own words. */
  sourceOf: (row: PermissionTableRow) => string;
  /** Prefixes every test id and element id: `manage-market-permission`, `manage-org-permission`. */
  testid: string;
}>();

const emit = defineEmits<{
  /** A role chosen on a row, with the select that chose it. */
  ask: [row: PermissionTableRow, role: MarketRole, select: HTMLSelectElement];
}>();

const groups = computed(() => groupedRows(props.table));

/** A choice of the role the row already asks is nothing to ask about. */
function chose(row: PermissionTableRow, select: HTMLSelectElement) {
  const role = select.value as MarketRole;
  if (role !== row.role) emit('ask', row, role, select);
}

/** The keys that step a closed select's value, each step its own change and so its own question. */
const STEPPING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

/**
 * A closed select steps its value on these keys, and every step is a change, so a keyboard user
 * met a confirmation at the first option past their own (T114's review). They open the list
 * instead, where the keys move among the options and only Enter chooses.
 */
function openInsteadOfStepping(event: KeyboardEvent) {
  if (event.altKey || !STEPPING_KEYS.has(event.key)) return;
  event.preventDefault();
  const select = event.currentTarget as HTMLSelectElement & { showPicker?: () => void };
  try {
    select.showPicker?.();
  } catch {
    // Refused without a user gesture somewhere: Space and Alt+ArrowDown still open the list.
  }
}
</script>

<template>
  <div v-for="{ group, rows } in groups" :key="group">
    <h4 class="subheading">{{ group }}</h4>
    <ul class="rows">
      <li v-for="row in rows" :key="row.id" class="row" :data-testid="`${testid}-row-${row.id}`">
        <div class="text">
          <span :id="`${testid}-${row.id}`" class="label">{{ row.label }}</span>
          <span class="caption" :data-testid="`${testid}-source`">
            {{ row.fixed ? 'Always' : sourceOf(row) }}
          </span>
          <span v-if="selfPromotionNote(row.id)" class="caption">
            {{ selfPromotionNote(row.id) }}
          </span>
        </div>
        <!-- Named by the row's own words, which a voice user reads off the screen. -->
        <select
          v-if="editable && !row.fixed"
          :id="`${testid}-select-${row.id}`"
          :value="row.role"
          :name="row.id"
          :aria-labelledby="`${testid}-${row.id}`"
          class="field field--select select"
          :data-testid="`${testid}-select`"
          @keydown="openInsteadOfStepping"
          @change="chose(row, $event.target as HTMLSelectElement)"
        >
          <option v-for="role in WHO_MAY_CHOICES" :key="role" :value="role">
            {{ whoMayLabel(role) }}
          </option>
        </select>
        <span v-else class="chip chip--neutral" :data-testid="`${testid}-role`">
          {{ whoMayLabel(row.role) }}
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.subheading {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A compact table rather than a card per row, which would make the dialog unwieldy. */
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

.text {
  flex: 1 1 16rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
}

.label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.caption {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.select {
  width: auto;
  flex: 0 0 auto;
}
</style>
