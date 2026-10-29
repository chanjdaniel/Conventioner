/**
 * Which role changes Manage market offers: the table's answers, as the server serves them (bug 43,
 * item 14, E39/F01/S02).
 *
 * The owner's own row offered a role select, and the server refuses every change to an owner's
 * role - so "Cannot change owner's role" was the only thing that select could ever do, said at the
 * foot of the dialog. An admin was offered Admin, which only an owner may grant, and every list
 * offered the role the person already had, twice. The helpers compared the person's role
 * themselves; they now ask the row that gives each role.
 */
import { describe, expect, it } from 'vitest';
import { MarketRole } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { canManageRoles, getRolesForChange } from '@/utils/permissions';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

/** What the built-in table serves each of these people. */
const OWNER = { actionRefusals: answersRefusing() };
const ADMIN = { actionRefusals: answersRefusing(MarketAction.ManageAdmins) };
const EDITOR = {
  actionRefusals: answersRefusing(MarketAction.ManageAdmins, MarketAction.ManageEditorsAndViewers),
};
const VIEWER = { actionRefusals: VIEWER_ANSWERS };

describe('canManageRoles', () => {
  it("never offers to change or take an owner's role, which the server refuses", () => {
    expect(canManageRoles(OWNER, MarketRole.Owner)).toBe(false);
    expect(canManageRoles(ADMIN, MarketRole.Owner)).toBe(false);
  });

  it("lets an owner manage an admin's role, and an admin only an editor's or a viewer's", () => {
    expect(canManageRoles(OWNER, MarketRole.Admin)).toBe(true);
    expect(canManageRoles(ADMIN, MarketRole.Admin)).toBe(false);
    expect(canManageRoles(ADMIN, MarketRole.Editor)).toBe(true);
    expect(canManageRoles(EDITOR, MarketRole.Viewer)).toBe(false);
    expect(canManageRoles(VIEWER, MarketRole.Viewer)).toBe(false);
  });

  it('answers by the row, whoever holds it: a row the server changed is followed', () => {
    const editorGivingRoles = { actionRefusals: answersRefusing(MarketAction.ManageAdmins) };

    expect(canManageRoles(editorGivingRoles, MarketRole.Viewer)).toBe(true);
  });

  it('offers nothing on a read that carries no answer', () => {
    expect(canManageRoles({}, MarketRole.Viewer)).toBe(false);
    expect(canManageRoles(null, MarketRole.Viewer)).toBe(false);
  });
});

describe('getRolesForChange', () => {
  it('offers the roles this person may grant, other than the one already held', () => {
    expect(getRolesForChange(OWNER, MarketRole.Editor)).toEqual([
      MarketRole.Admin,
      MarketRole.Viewer,
    ]);
    expect(getRolesForChange(ADMIN, MarketRole.Editor)).toEqual([MarketRole.Viewer]);
    expect(getRolesForChange(ADMIN, MarketRole.Viewer)).toEqual([MarketRole.Editor]);
  });

  it('offers nothing for a role this person may not take', () => {
    expect(getRolesForChange(ADMIN, MarketRole.Admin)).toEqual([]);
    expect(getRolesForChange(OWNER, MarketRole.Owner)).toEqual([]);
  });

  it('offers nothing to someone who grants nothing', () => {
    expect(getRolesForChange(EDITOR, MarketRole.Viewer)).toEqual([]);
  });
});
