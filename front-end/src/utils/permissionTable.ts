/**
 * What Manage market's Permissions section says of the market's table (E39/F01/S04).
 *
 * The server keeps the table and every change to it structured (`back-end/api/market_actions.py`,
 * `back-end/history.py`); the words are here, as the placement history's are
 * (`placementHistory.ts`), so a sentence can change without a back-end release.
 */
import { MarketRole, type PermissionTableRow } from '@/assets/types/datatypes';
import { getRoleDisplayName } from '@/utils/permissions';
import { getFormattedTimestamp } from '@/utils/utils';
import { MarketAction } from '@/utils/marketActions';

/** A row's role and where it came from, as a history entry's before or after holds it. */
export interface PermissionState {
  role: string;
  source: string;
}

/** One change to the market's table, as `GET /markets/:id/permission-history` serves it. */
export interface PermissionHistoryEntry {
  id: string;
  actor: string;
  at: string;
  action: string;
  kind: 'permission_set' | 'permission_reset' | 'permission_table_reset';
  /** The row a set or a reset is about; empty on a reset of the whole table. */
  subject: { action?: string };
  /** A row's before and after; on a reset of the whole table, each held row's, by its id. */
  detail: {
    before: PermissionState | Record<string, PermissionState>;
    after: PermissionState | Record<string, PermissionState>;
  };
}

/** The "Who may" choices, lowest first: each means that role and every one above it. */
export const WHO_MAY_CHOICES: MarketRole[] = [
  MarketRole.Viewer,
  MarketRole.Editor,
  MarketRole.Admin,
  MarketRole.Owner,
];

const WHO_MAY_LABELS: Record<MarketRole, string> = {
  [MarketRole.Viewer]: 'Viewer and above',
  [MarketRole.Editor]: 'Editor and above',
  [MarketRole.Admin]: 'Admin and above',
  // The owner is only ever one person.
  [MarketRole.Owner]: 'Owner only',
};

/** A role as a choice of who may: "Admin and above". */
export function whoMayLabel(role: MarketRole): string {
  return WHO_MAY_LABELS[role];
}

/** The table's rows under their groups, in the order the server lists them. */
export function groupedRows(
  table: PermissionTableRow[],
): Array<{ group: string; rows: PermissionTableRow[] }> {
  const groups: Array<{ group: string; rows: PermissionTableRow[] }> = [];
  for (const row of table) {
    const last = groups[groups.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }
  return groups;
}

/** How many rows the market holds rather than reading at their built-in default. */
export function heldRows(table: PermissionTableRow[]): number {
  return table.filter((row) => row.source !== 'built-in').length;
}

/**
 * Where a row's role came from: the built-in default, the organization's default copied when the
 * market was created, or a change on this market, named by its newest change (newest first, as the
 * history is served). Before the history is read, a changed row says only that.
 */
export function sourceLine(row: PermissionTableRow, entries: PermissionHistoryEntry[]): string {
  if (row.source === 'built-in') return 'Built-in default';
  if (row.source === 'organization') return 'Copied from the organization';
  const change = entries.find(
    (entry) => entry.kind === 'permission_set' && entry.subject?.action === row.id,
  );
  if (!change) return 'Changed on this market';
  return `Changed on this market by ${change.actor}, ${getFormattedTimestamp(change.at)}`;
}

const WHO_MAY: Record<MarketRole, string> = {
  [MarketRole.Viewer]: 'anyone with a role',
  [MarketRole.Editor]: 'only Editors, Admins and the owner',
  [MarketRole.Admin]: 'only Admins and the owner',
  [MarketRole.Owner]: 'only the owner',
};

/** The confirmation's question: "Let only Admins and the owner check vendors in at this market?" */
export function changeQuestion(row: PermissionTableRow, role: MarketRole): string {
  return `Let ${WHO_MAY[role]} ${row.mayWhat}?`;
}

const PLURAL: Record<MarketRole, string> = {
  [MarketRole.Viewer]: 'Viewers',
  [MarketRole.Editor]: 'Editors',
  [MarketRole.Admin]: 'Admins',
  [MarketRole.Owner]: 'the owner',
};

function listed(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!;
}

/** Who a change takes the action from, or gives it to: "Editors lose this." */
export function changeConsequence(from: MarketRole, to: MarketRole): string {
  const rank = (role: MarketRole) => WHO_MAY_CHOICES.indexOf(role);
  const [low, high] = rank(from) < rank(to) ? [from, to] : [to, from];
  const between = WHO_MAY_CHOICES.slice(rank(low), rank(high)).map((role) => PLURAL[role]);
  return `${listed(between)} ${rank(from) < rank(to) ? 'lose' : 'gain'} this.`;
}

/**
 * Giving and taking roles asks one row for both the role given and the role taken, so at Viewer a
 * Viewer may give themself Editor (T108's review). The owner may choose it; the section says so.
 */
const SELF_PROMOTION: Partial<Record<string, Partial<Record<MarketRole, string>>>> = {
  [MarketAction.ManageEditorsAndViewers]: {
    [MarketRole.Viewer]: 'A Viewer could then make themself an Editor.',
  },
};

/** What setting this row to this role would let someone give themself, or null. */
export function selfPromotionWarning(rowId: string, role: MarketRole): string | null {
  return SELF_PROMOTION[rowId]?.[role] ?? null;
}

function roleName(state: PermissionState | undefined): string {
  return state?.role ? getRoleDisplayName(state.role) : 'unknown';
}

/** One change as the "Changes" list says it: the row, or the reset, and each row's before and after. */
export function changeLines(
  entry: PermissionHistoryEntry,
  table: PermissionTableRow[],
): { title: string; rows: string[] } {
  const label = (id: string) => table.find((row) => row.id === id)?.label ?? id;
  if (entry.kind === 'permission_table_reset') {
    const before = (entry.detail?.before ?? {}) as Record<string, PermissionState>;
    const after = (entry.detail?.after ?? {}) as Record<string, PermissionState>;
    const order = (id: string) => {
      const at = table.findIndex((row) => row.id === id);
      return at === -1 ? table.length : at;
    };
    const ids = Object.keys(before).sort((a, b) => order(a) - order(b));
    return {
      title: 'Reset to built-in defaults',
      rows: ids.map((id) => `${label(id)}: ${roleName(before[id])} to ${roleName(after[id])}`),
    };
  }
  const before = entry.detail?.before as PermissionState | undefined;
  const after = entry.detail?.after as PermissionState | undefined;
  const change = `${roleName(before)} to ${roleName(after)}`;
  return {
    title: label(entry.subject?.action ?? ''),
    rows: [entry.kind === 'permission_reset' ? `${change}, its built-in default` : change],
  };
}
