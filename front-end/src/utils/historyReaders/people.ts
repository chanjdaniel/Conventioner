/**
 * The People group's words: a market's roles, and its permission table.
 *
 * Reads:
 * - `manage-editors-and-viewers/role_given`
 * - `manage-editors-and-viewers/role_changed`
 * - `manage-editors-and-viewers/role_taken`
 * - `manage-admins/role_given`
 * - `manage-admins/role_changed`
 * - `manage-admins/role_taken`
 * - `hand-on-market/handed_on`
 * - `change-the-table/permission_set`
 * - `change-the-table/permission_reset`
 * - `change-the-table/permission_table_reset`, its sentence and its rows
 * - `change-the-table/permission_table_copied`, its sentence and its rows
 *
 * Names the stored values `role` and `source` for `fieldValue`. `delete-market/` is the
 * organization's: its entry is in the organization's history.
 */
import { getRoleDisplayName } from '@/utils/permissions';
import {
  listed,
  permissionRows,
  roleChanged,
  roleGiven,
  roleTaken,
  rowLabel,
  sentence,
  str,
  type HistoryArea,
  type HistoryReaders,
} from './shared';

/** Where a row of the permission table came from, in words. */
const PERMISSION_SOURCES: Record<string, string> = {
  'built-in': 'Built in',
  organization: 'The organization’s default',
  market: 'This market',
};

export const readers: HistoryReaders = {
  'manage-editors-and-viewers/role_given': { parts: roleGiven },
  'manage-editors-and-viewers/role_changed': { parts: roleChanged },
  'manage-editors-and-viewers/role_taken': { parts: roleTaken },
  'manage-admins/role_given': { parts: roleGiven },
  'manage-admins/role_changed': { parts: roleChanged },
  'manage-admins/role_taken': { parts: roleTaken },
  'hand-on-market/handed_on': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [
        actor,
        text(
          `transferred ownership of the market to ${str(entry.subject.email)}, and stays on it as an Admin`,
        ),
      ];
    },
  },
  'change-the-table/permission_set': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, before, after } = sentence(entry, context);
      return [
        actor,
        text(
          `changed ${rowLabel(entry, labels)} from ${getRoleDisplayName(str(before.role))} to ` +
            getRoleDisplayName(str(after.role)),
        ),
      ];
    },
  },
  'change-the-table/permission_reset': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, after } = sentence(entry, context);
      return [
        actor,
        text(
          `set ${rowLabel(entry, labels)} back to its default, ${getRoleDisplayName(str(after.role))}`,
        ),
      ];
    },
  },
  'change-the-table/permission_table_reset': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, after } = sentence(entry, context);
      const rows = Object.keys(after).map((id) => labels[id] ?? id);
      return [
        actor,
        text(
          rows.length === 1
            ? `reset ${rows[0]} to its built-in default`
            : `reset ${listed(rows)} to their built-in defaults`,
        ),
      ];
    },
    changes: permissionRows,
  },
  'change-the-table/permission_table_copied': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, after } = sentence(entry, context);
      const rows = Object.keys(after).map((id) => labels[id] ?? id);
      return [actor, text(`copied the organization's defaults, changing ${listed(rows)}`)];
    },
    changes: permissionRows,
  },
};

/** A role, and where a row of the permission table came from, in the words the screens use. */
export const namedValues: HistoryArea['namedValues'] = {
  role: getRoleDisplayName,
  source: (source) => PERMISSION_SOURCES[source] ?? source,
};
