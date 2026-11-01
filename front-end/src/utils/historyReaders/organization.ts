/**
 * The organization's own words (E40/F02/S01): its name, its people, its markets coming and going,
 * its floorplan templates, and its default permission table, which Manage organization reads.
 *
 * Reads:
 * - `change-organization/renamed`
 * - `manage-organization-admins/role_given`
 * - `manage-organization-admins/role_changed`
 * - `manage-organization-admins/role_taken`
 * - `manage-organization-members/role_given`
 * - `manage-organization-members/role_taken`
 * - `transfer-organization/`
 * - `create-market/`
 * - `delete-market/`
 * - `manage-floorplan-templates/template_added`
 * - `manage-floorplan-templates/template_changed`
 * - `manage-floorplan-templates/template_removed`
 * - `manage-floorplan-templates/template_moved_out`
 * - `manage-floorplan-templates/template_moved_in`
 * - `change-the-default/permission_set`
 * - `change-the-default/permission_reset`
 * - `change-the-default/permission_table_reset`, its sentence and its rows
 *
 * Words the stored values `table_types` and `aisles` for `fieldValue`.
 */
import { getRoleDisplayName } from '@/utils/permissions';
import {
  asDetail,
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

/** A floorplan template's aisle settings, in the order its layout reads them. */
const AISLES: Array<[string, string]> = [
  ['wallBufferMm', 'wall buffer'],
  ['tableSpacingMm', 'table spacing'],
  ['walkwayWidthMm', 'walkway'],
];

export const readers: HistoryReaders = {
  'change-organization/renamed': {
    parts(entry, context) {
      const { actor, text, before, after } = sentence(entry, context);
      return [
        actor,
        text(`renamed the organization from "${str(before.name)}" to "${str(after.name)}"`),
      ];
    },
  },
  'manage-organization-admins/role_given': { parts: roleGiven },
  'manage-organization-admins/role_changed': { parts: roleChanged },
  'manage-organization-admins/role_taken': { parts: roleTaken },
  'manage-organization-members/role_given': { parts: roleGiven },
  'manage-organization-members/role_taken': { parts: roleTaken },
  'transfer-organization/': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text(`handed the organization to ${str(entry.subject.email)}`)];
    },
  },
  'create-market/': {
    parts(entry, context) {
      const { actor, text, after } = sentence(entry, context);
      return [actor, text(`created the market "${str(after.name)}"`)];
    },
  },
  'delete-market/': {
    parts(entry, context) {
      const { actor, text, before } = sentence(entry, context);
      return [actor, text(`deleted the market "${str(before.name)}"`)];
    },
  },
  'manage-floorplan-templates/template_added': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text(`added the floorplan template "${str(entry.subject.name)}"`)];
    },
  },
  'manage-floorplan-templates/template_changed': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text(`changed the floorplan template "${str(entry.subject.name)}"`)];
    },
  },
  'manage-floorplan-templates/template_removed': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text(`removed the floorplan template "${str(entry.subject.name)}"`)];
    },
  },
  'manage-floorplan-templates/template_moved_out': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [
        actor,
        text(`moved the floorplan template "${str(entry.subject.name)}" out of the organization`),
      ];
    },
  },
  'manage-floorplan-templates/template_moved_in': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [
        actor,
        text(`moved the floorplan template "${str(entry.subject.name)}" into the organization`),
      ];
    },
  },
  'change-the-default/permission_set': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, before, after } = sentence(entry, context);
      return [
        actor,
        text(
          `changed ${rowLabel(entry, labels)} for new markets from ` +
            `${getRoleDisplayName(str(before.role))} to ${getRoleDisplayName(str(after.role))}`,
        ),
      ];
    },
  },
  'change-the-default/permission_reset': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, after } = sentence(entry, context);
      return [
        actor,
        text(
          `set ${rowLabel(entry, labels)} for new markets back to its default, ` +
            getRoleDisplayName(str(after.role)),
        ),
      ];
    },
  },
  'change-the-default/permission_table_reset': {
    parts(entry, context) {
      const { labels } = context;
      const { actor, text, after } = sentence(entry, context);
      const rows = Object.keys(after).map((id) => labels[id] ?? id);
      return [
        actor,
        text(
          rows.length === 1
            ? `reset ${rows[0]} for new markets to its built-in default`
            : `reset ${listed(rows)} for new markets to their built-in defaults`,
        ),
      ];
    },
    changes: permissionRows,
  },
};

/** The stored values that are lists or objects, in words rather than JSON: a floorplan template's
 * table types, each its name and size, and its aisles. */
export const wordedValues: HistoryArea['wordedValues'] = {
  table_types: (value) =>
    Array.isArray(value) && value.length
      ? value
          .map(asDetail)
          // A size never breaks across lines: "915 ×" over "760 mm" reads as two values.
          .map((type) => `${str(type.name)} ${str(type.widthMm)} × ${str(type.heightMm)} mm`)
          .join(', ')
      : 'none',
  aisles: (value) => {
    const aisles = asDetail(value);
    const set = AISLES.filter(([key]) => aisles[key] !== undefined && aisles[key] !== null);
    return set.length
      ? set.map(([key, words]) => `${words} ${str(aisles[key])} mm`).join(', ')
      : 'none';
  },
};
