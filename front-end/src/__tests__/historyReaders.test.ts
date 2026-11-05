/**
 * The history's words, one file per area (T174): every key read once, exactly the keys listed here,
 * asked in the order the history always asked them. What each key's words say is pinned by
 * `marketHistory.test.ts` through `entryParts` and `entryChanges`.
 */
import { describe, expect, it } from 'vitest';

// `shared.ts` first, so this file loads the areas by the way an area's helper would.
import { fieldValue } from '@/utils/historyReaders/shared';
import {
  HISTORY_READERS,
  NAMED_VALUES,
  WORDED_VALUES,
  merged,
  readerKeys,
} from '@/utils/historyReaders';
import * as applications from '@/utils/historyReaders/applications';
import * as applying from '@/utils/historyReaders/applying';
import * as assignment from '@/utils/historyReaders/assignment';
import * as discord from '@/utils/historyReaders/discord';
import * as door from '@/utils/historyReaders/door';
import * as lifecycle from '@/utils/historyReaders/lifecycle';
import * as organization from '@/utils/historyReaders/organization';
import * as payments from '@/utils/historyReaders/payments';
import * as people from '@/utils/historyReaders/people';
import * as setup from '@/utils/historyReaders/setup';
import * as vendors from '@/utils/historyReaders/vendors';

const AREAS = [
  applications,
  applying,
  assignment,
  discord,
  door,
  lifecycle,
  organization,
  payments,
  people,
  setup,
  vendors,
];

/**
 * The keys a sentence is worded for, sorted; a new reader's key is one line in its place. They began
 * as every key `marketHistory.ts` worded before the split: its `switch` cases, its placement kinds of
 * `assign` and its `dealt` of any action. Its one other kind of any action, `permission_table_reset`,
 * is written by `change-the-table` and `change-the-default` alone, so it is read under those two.
 */
const SENTENCES = [
  '*/dealt',
  'add-vendor/',
  'adjust-paid/payment_edited',
  'adjust-paid/payment_removed',
  'adjust-paid/refund_recorded',
  'amend-form/',
  'amend-form/resumed',
  'apply/edited',
  'apply/submitted',
  'assign/assigned',
  'assign/freed',
  'assign/owed_taken_back',
  'assign/placed',
  'assign/rules',
  'assign/swapped',
  'change-form/form',
  'change-form/rejection_rules',
  'change-form/review_highlights',
  'change-organization/renamed',
  'change-owed/owed_calculated',
  'change-owed/owed_set',
  'change-setup/floorplan',
  'change-setup/floorplan_image_deleted',
  'change-setup/plan',
  'change-setup/pricing',
  'change-setup/renamed',
  'change-the-default/permission_reset',
  'change-the-default/permission_set',
  'change-the-default/permission_table_reset',
  'change-the-table/permission_reset',
  'change-the-table/permission_set',
  'change-the-table/permission_table_copied',
  'change-the-table/permission_table_reset',
  'change-verdicts/verdict',
  'change-verdicts/verdicts',
  'check-in/check_in_undone',
  'check-in/checked_in',
  'check-in/door_code_made',
  'choose-reviewers/reviewers',
  'connect-discord/discord',
  'connect-discord/discord_checked',
  'connect-discord/discord_connected',
  'connect-discord/discord_disconnected',
  'connect-discord/discord_roles_given',
  'create-market/',
  'delete-market/',
  'give-verdicts/follow_up_owner',
  'give-verdicts/verdict',
  'give-verdicts/verdict_undone',
  'give-verdicts/verdicts',
  'give-verdicts/verdicts_undone',
  'import-applications/imported',
  'import-applications/started',
  'manage-admins/role_changed',
  'manage-admins/role_given',
  'manage-admins/role_taken',
  'manage-editors-and-viewers/role_changed',
  'manage-editors-and-viewers/role_given',
  'manage-editors-and-viewers/role_taken',
  'manage-floorplan-templates/template_added',
  'manage-floorplan-templates/template_changed',
  'manage-floorplan-templates/template_moved_in',
  'manage-floorplan-templates/template_moved_out',
  'manage-floorplan-templates/template_removed',
  'manage-organization-admins/role_changed',
  'manage-organization-admins/role_given',
  'manage-organization-admins/role_taken',
  'manage-organization-members/role_given',
  'manage-organization-members/role_taken',
  'move-phase/',
  'publish-results/',
  'record-payment/',
  'stop-applications/',
  'transfer-organization/',
  'update-vendor-info/',
  'update-vendor-info/discord_match_declined',
  'update-vendor-info/kept',
  'write-vendor-notes/note',
  'write-vendor-notes/request_handled',
];

/** The keys before-and-after rows are given for, sorted, as `entryChanges`' `if` chain gave them
 * before the split, an action's every kind keyed `action/*`. */
const ROWS = [
  '*/dealt',
  'add-vendor/*',
  'adjust-paid/*',
  'apply/edited',
  'apply/submitted',
  'assign/owed_taken_back',
  'assign/placed',
  'change-owed/*',
  'change-setup/pricing',
  'change-the-default/permission_table_reset',
  'change-the-table/permission_table_copied',
  'change-the-table/permission_table_reset',
  'choose-reviewers/reviewers',
  'connect-discord/*',
  'connect-discord/discord_checked',
  'connect-discord/discord_roles_given',
  'record-payment/*',
  'update-vendor-info/*',
  'update-vendor-info/discord_match_declined',
];

const keysWith = (method: 'parts' | 'changes') =>
  Object.entries(HISTORY_READERS)
    .filter(([, reader]) => reader?.[method])
    .map(([key]) => key)
    .sort();

describe('the history readers', () => {
  it('reads every key in one area only', () => {
    const keys = AREAS.flatMap((area) => Object.keys(area.readers));
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
    expect(Object.keys(HISTORY_READERS).sort()).toEqual(keys.sort());
  });

  it('words a sentence for the keys listed, and only those', () => {
    expect(keysWith('parts')).toEqual([...SENTENCES].sort());
  });

  it('gives rows for the keys listed, and only those', () => {
    expect(keysWith('changes')).toEqual([...ROWS].sort());
  });

  it('refuses a key two areas both define, naming both', () => {
    const one = { readers: { 'check-in/checked_in': {} } };
    const other = { readers: { 'check-in/checked_in': {} } };
    expect(() => merged('reader', { door: one.readers, people: other.readers })).toThrow(
      'The history\'s reader "check-in/checked_in" is defined by both door and people',
    );
  });

  it('words every placement kind of assign by the one reader', () => {
    const parts = assignment.PLACEMENT_KINDS.map(
      (kind) => HISTORY_READERS[`assign/${kind}`]?.parts,
    );
    expect(parts.every((one) => typeof one === 'function')).toBe(true);
    expect(new Set(parts).size).toBe(1);
  });

  it('names and words the stored values the areas name and word', () => {
    expect(Object.keys(NAMED_VALUES).sort()).toEqual(['role', 'source', 'status']);
    expect(Object.keys(WORDED_VALUES).sort()).toEqual(['aisles', 'table_types']);
    expect(fieldValue('source', 'organization')).toBe('The organization’s default');
  });
});

describe('the order the readers are asked in', () => {
  it('asks a placement kind of assign first, then the kind under any action', () => {
    expect(readerKeys({ action: 'assign', kind: 'freed' })).toEqual([
      'assign/freed',
      '*/freed',
      'assign/*',
    ]);
  });

  it('asks the kind under any action, then the action and kind, then every kind of the action', () => {
    expect(readerKeys({ action: 'update-vendor-info', kind: 'kept' })).toEqual([
      '*/kept',
      'update-vendor-info/kept',
      'update-vendor-info/*',
    ]);
  });

  it('asks an entry with no kind by its action and an empty kind', () => {
    expect(readerKeys({ action: 'move-phase', kind: null })).toEqual([
      '*/',
      'move-phase/',
      'move-phase/*',
    ]);
  });
});
