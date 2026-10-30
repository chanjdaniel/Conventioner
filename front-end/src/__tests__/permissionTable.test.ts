/**
 * What Manage market's Permissions section says of the market's table (E39/F01/S04): each row's
 * choice, where its role came from, the confirmation of a change, and the changes made.
 *
 * The server keeps the table and its history structured (`back-end/api/market_actions.py`,
 * `back-end/history.py`); the words are here, as the placement history's are.
 */
import { describe, expect, it } from 'vitest';
import { MarketRole, type PermissionTableRow } from '@/assets/types/datatypes';
import { getFormattedTimestamp } from '@/utils/utils';
import {
  changeConsequence,
  changeLines,
  changeQuestion,
  groupedRows,
  heldRows,
  selfPromotionWarning,
  sourceLine,
  WHO_MAY_CHOICES,
  whoMayLabel,
  type PermissionHistoryEntry,
} from '@/utils/permissionTable';

function row(overrides: Partial<PermissionTableRow> = {}): PermissionTableRow {
  return {
    id: 'check-in',
    group: 'The door',
    label: 'Check vendors in',
    role: MarketRole.Editor,
    default: MarketRole.Editor,
    source: 'built-in',
    fixed: false,
    mayWhat: 'check vendors in at this market',
    ...overrides,
  };
}

const AT = '2026-11-02T18:20:00+00:00';
const EARLIER = '2026-11-01T09:05:00+00:00';

function entry(overrides: Partial<PermissionHistoryEntry> = {}): PermissionHistoryEntry {
  return {
    id: 'entry-1',
    actor: 'owner@example.com',
    at: AT,
    action: 'change-the-table',
    kind: 'permission_set',
    subject: { action: 'check-in' },
    detail: {
      before: { role: 'editor', source: 'built-in' },
      after: { role: 'admin', source: 'market' },
    },
    ...overrides,
  };
}

describe('the choices', () => {
  it('offers the four roles lowest first, each meaning that role and above', () => {
    expect(WHO_MAY_CHOICES).toEqual([
      MarketRole.Viewer,
      MarketRole.Editor,
      MarketRole.Admin,
      MarketRole.Owner,
    ]);
    expect(WHO_MAY_CHOICES.map(whoMayLabel)).toEqual([
      'Viewer and above',
      'Editor and above',
      'Admin and above',
      'Owner only',
    ]);
  });
});

describe('groupedRows', () => {
  it("keeps the table's order, and each group's rows together under it", () => {
    const rows = [
      row({ id: 'read', group: 'Reading' }),
      row({ id: 'export-csv', group: 'Reading' }),
      row({ id: 'check-in', group: 'The door' }),
      row({ id: 'manage-admins', group: 'People' }),
    ];

    expect(groupedRows(rows).map(({ group, rows }) => [group, rows.map((r) => r.id)])).toEqual([
      ['Reading', ['read', 'export-csv']],
      ['The door', ['check-in']],
      ['People', ['manage-admins']],
    ]);
  });
});

describe('heldRows', () => {
  it('counts the rows the market holds, copied or changed here', () => {
    expect(
      heldRows([
        row({ source: 'built-in' }),
        row({ source: 'organization' }),
        row({ source: 'market' }),
      ]),
    ).toBe(2);
  });
});

describe('sourceLine', () => {
  it('says a row the market holds none of is the built-in default', () => {
    expect(sourceLine(row(), [])).toBe('Built-in default');
  });

  it('says a copied row came from the organization', () => {
    expect(sourceLine(row({ source: 'organization', role: MarketRole.Admin }), [])).toBe(
      'Copied from the organization',
    );
  });

  it("names who changed a row here and when, from the row's newest change", () => {
    const changed = row({ source: 'market', role: MarketRole.Admin });
    const entries = [
      entry({ actor: 'second@example.com', at: AT }),
      entry({ id: 'older', actor: 'first@example.com', at: EARLIER }),
    ];

    expect(sourceLine(changed, entries)).toBe(
      `Changed on this market by second@example.com, ${getFormattedTimestamp(AT)}`,
    );
  });

  it("does not take another row's change, or a reset, as this row's", () => {
    const changed = row({ source: 'market', role: MarketRole.Admin });
    const entries = [
      entry({ subject: { action: 'add-vendor' } }),
      entry({ kind: 'permission_reset', at: AT }),
      entry({ actor: 'first@example.com', at: EARLIER }),
    ];

    expect(sourceLine(changed, entries)).toBe(
      `Changed on this market by first@example.com, ${getFormattedTimestamp(EARLIER)}`,
    );
  });

  it('says only that it changed here while the history has not been read', () => {
    expect(sourceLine(row({ source: 'market' }), [])).toBe('Changed on this market');
  });
});

describe('changeQuestion', () => {
  it('names who may after the change and what they may do', () => {
    expect(changeQuestion(row(), MarketRole.Admin)).toBe(
      'Let only Admins and the owner check vendors in at this market?',
    );
    expect(changeQuestion(row(), MarketRole.Owner)).toBe(
      'Let only the owner check vendors in at this market?',
    );
    expect(changeQuestion(row(), MarketRole.Editor)).toBe(
      'Let only Editors, Admins and the owner check vendors in at this market?',
    );
    expect(changeQuestion(row(), MarketRole.Viewer)).toBe(
      'Let anyone with a role check vendors in at this market?',
    );
  });
});

describe('changeConsequence', () => {
  it('names the roles a raise takes it from', () => {
    expect(changeConsequence(MarketRole.Editor, MarketRole.Admin)).toBe('Editors lose this.');
    expect(changeConsequence(MarketRole.Editor, MarketRole.Owner)).toBe(
      'Editors and Admins lose this.',
    );
    expect(changeConsequence(MarketRole.Viewer, MarketRole.Owner)).toBe(
      'Viewers, Editors and Admins lose this.',
    );
  });

  it('names the roles a lowering gives it to', () => {
    expect(changeConsequence(MarketRole.Admin, MarketRole.Viewer)).toBe(
      'Viewers and Editors gain this.',
    );
  });
});

describe('selfPromotionWarning', () => {
  it('warns that a Viewer could make themself an Editor when giving those roles is lowered to Viewer', () => {
    expect(selfPromotionWarning('manage-editors-and-viewers', MarketRole.Viewer)).toBe(
      'A Viewer could then make themself an Editor.',
    );
  });

  it('says nothing at any other role, or of any other row', () => {
    expect(selfPromotionWarning('manage-editors-and-viewers', MarketRole.Editor)).toBeNull();
    expect(selfPromotionWarning('check-in', MarketRole.Viewer)).toBeNull();
  });
});

describe('changeLines', () => {
  const table = [
    row(),
    row({
      id: 'move-phase',
      group: 'Lifecycle',
      label: 'Move the phase',
      default: MarketRole.Admin,
    }),
  ];

  it("says a row's change as its label, before and after", () => {
    expect(changeLines(entry(), table)).toEqual({
      title: 'Check vendors in',
      rows: ['Editor to Admin'],
    });
    expect(
      changeLines(
        entry({
          kind: 'permission_reset',
          detail: {
            before: { role: 'admin', source: 'market' },
            after: { role: 'editor', source: 'built-in' },
          },
        }),
        table,
      ),
    ).toEqual({ title: 'Check vendors in', rows: ['Admin to Editor, its built-in default'] });
  });

  it('says a reset of the whole table as every row it returned, in the order the table lists them', () => {
    expect(
      changeLines(
        entry({
          kind: 'permission_table_reset',
          subject: {},
          detail: {
            before: {
              'move-phase': { role: 'owner', source: 'organization' },
              'check-in': { role: 'admin', source: 'market' },
            },
            after: {
              'move-phase': { role: 'admin', source: 'built-in' },
              'check-in': { role: 'editor', source: 'built-in' },
            },
          },
        }),
        table,
      ),
    ).toEqual({
      title: 'Reset to built-in defaults',
      rows: ['Check vendors in: Admin to Editor', 'Move the phase: Owner to Admin'],
    });
  });

  it('names a row the table no longer has by its id rather than dropping it', () => {
    expect(changeLines(entry({ subject: { action: 'gone-row' } }), table).title).toBe('gone-row');
  });
});
