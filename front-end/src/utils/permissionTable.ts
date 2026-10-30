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

interface EntryBase {
  id: string;
  actor: string;
  at: string;
  action: string;
}

/** One row set or returned to its default: the row, and its role before and after. */
interface RowChange extends EntryBase {
  kind: 'permission_set' | 'permission_reset';
  subject: { action: string };
  detail: { before: PermissionState; after: PermissionState };
}

/** Every row the market held returned to its default at once: each row's before and after, by id. */
interface TableReset extends EntryBase {
  kind: 'permission_table_reset';
  subject: Record<string, never>;
  detail: { before: Record<string, PermissionState>; after: Record<string, PermissionState> };
}

/** One change to the market's table, as `GET /markets/:id/permission-history` serves it. */
export type PermissionHistoryEntry = RowChange | TableReset;

/** The "Who may" choices, lowest first: each means that role and every one above it. */
export const WHO_MAY_CHOICES: MarketRole[] = [
  MarketRole.Viewer,
  MarketRole.Editor,
  MarketRole.Admin,
  MarketRole.Owner,
];

/** What each role is called where the section speaks of it. */
const ROLE_WORDS: Record<MarketRole, { choice: string; whoMay: string; plural: string }> = {
  [MarketRole.Viewer]: {
    choice: 'Viewer and above',
    whoMay: 'anyone with a role',
    plural: 'Viewers',
  },
  [MarketRole.Editor]: {
    choice: 'Editor and above',
    whoMay: 'only Editors, Admins and the owner',
    plural: 'Editors',
  },
  [MarketRole.Admin]: {
    choice: 'Admin and above',
    whoMay: 'only Admins and the owner',
    plural: 'Admins',
  },
  // The owner is only ever one person.
  [MarketRole.Owner]: { choice: 'Owner only', whoMay: 'only the owner', plural: 'the owner' },
};

/** Who a role and every one above it are, as the server's refusal names them (`_WHO_MAY`). */
const WHO_MAY_TAKE: Record<MarketRole, string> = {
  [MarketRole.Viewer]: 'someone who holds a role',
  [MarketRole.Editor]: 'an Editor, an Admin or the owner',
  [MarketRole.Admin]: 'an Admin or the owner',
  [MarketRole.Owner]: "the market's owner",
};

/**
 * Who this market lets take an action, in the words its refusal names them: "an Admin or the
 * owner" (E38/F06/S01). Read from the market's own table, so a line saying who may overturn an
 * automatic rejection follows a row its owner changed; null when the market in hand carries no
 * such row.
 */
export function whoMayTake(
  table: PermissionTableRow[] | undefined,
  action: MarketAction,
): string | null {
  const row = table?.find((r) => r.id === action);
  return row ? WHO_MAY_TAKE[row.role] : null;
}

/** A role as a choice of who may: "Admin and above". */
export function whoMayLabel(role: MarketRole): string {
  return ROLE_WORDS[role].choice;
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

/** The rows the market holds, copied or changed here, rather than reading at their default. */
export function heldRows(table: PermissionTableRow[]): PermissionTableRow[] {
  return table.filter((row) => row.source !== 'built-in');
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

/** The confirmation's question: "Let only Admins and the owner check vendors in at this market?" */
export function changeQuestion(row: PermissionTableRow, role: MarketRole): string {
  return `Let ${ROLE_WORDS[role].whoMay} ${row.mayWhat}?`;
}

function listed(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0]!;
}

/** Who a change takes the action from, or gives it to: "Editors lose this." */
export function changeConsequence(from: MarketRole, to: MarketRole): string {
  const rank = (role: MarketRole) => WHO_MAY_CHOICES.indexOf(role);
  const [low, high] = rank(from) < rank(to) ? [from, to] : [to, from];
  const between = WHO_MAY_CHOICES.slice(rank(low), rank(high)).map(
    (role) => ROLE_WORDS[role].plural,
  );
  return `${listed(between)} ${rank(from) < rank(to) ? 'lose' : 'gain'} this.`;
}

/**
 * Giving and taking roles asks one row for both the role given and the role taken, so at Viewer a
 * Viewer may give themself Editor (T108's review). The owner may choose it; the section says so
 * beside the row, and in the confirmation of the role that allows it.
 */
const SELF_PROMOTION: Partial<
  Record<string, { note: string; at: Partial<Record<MarketRole, string>> }>
> = {
  [MarketAction.ManageEditorsAndViewers]: {
    note: 'At “Viewer and above”, any Viewer can make themself an Editor.',
    at: { [MarketRole.Viewer]: 'A Viewer could then make themself an Editor.' },
  },
};

/** What this row lets someone give themself at some role, said beside it, or null. */
export function selfPromotionNote(rowId: string): string | null {
  return SELF_PROMOTION[rowId]?.note ?? null;
}

/** What setting this row to this role would let someone give themself, or null. */
export function selfPromotionWarning(rowId: string, role: MarketRole): string | null {
  return SELF_PROMOTION[rowId]?.at[role] ?? null;
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
    const before = entry.detail?.before ?? {};
    const after = entry.detail?.after ?? {};
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
  const change = `${roleName(entry.detail?.before)} to ${roleName(entry.detail?.after)}`;
  return {
    title: label(entry.subject?.action ?? ''),
    rows: [entry.kind === 'permission_reset' ? `${change}, its built-in default` : change],
  };
}
