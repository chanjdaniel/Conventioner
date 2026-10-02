/**
 * Which role changes Manage market offers: the server's rules, mirrored (bug 43, item 14).
 *
 * The owner's own row offered a role select, and the server refuses every change to an owner's
 * role - so "Cannot change owner's role" was the only thing that select could ever do, said at the
 * foot of the dialog. An admin was offered Admin, which only an owner may grant, and every list
 * offered the role the person already had, twice.
 */
import { describe, expect, it } from 'vitest';
import { MarketRole } from '@/assets/types/datatypes';
import { canChangeRole, getRolesForChange } from '@/utils/permissions';

describe('canChangeRole', () => {
  it("never offers to change an owner's role, which the server refuses", () => {
    expect(canChangeRole(MarketRole.Owner, MarketRole.Owner)).toBe(false);
    expect(canChangeRole(MarketRole.Admin, MarketRole.Owner)).toBe(false);
  });

  it("lets an owner change an admin's role, and an admin only an editor's or a viewer's", () => {
    expect(canChangeRole(MarketRole.Owner, MarketRole.Admin)).toBe(true);
    expect(canChangeRole(MarketRole.Admin, MarketRole.Admin)).toBe(false);
    expect(canChangeRole(MarketRole.Admin, MarketRole.Editor)).toBe(true);
    expect(canChangeRole(MarketRole.Editor, MarketRole.Viewer)).toBe(false);
  });
});

describe('getRolesForChange', () => {
  it('offers the roles this person may grant, other than the one already held', () => {
    expect(getRolesForChange(MarketRole.Editor, MarketRole.Owner)).toEqual([
      MarketRole.Admin,
      MarketRole.Viewer,
    ]);
    expect(getRolesForChange(MarketRole.Editor, MarketRole.Admin)).toEqual([MarketRole.Viewer]);
    expect(getRolesForChange(MarketRole.Viewer, MarketRole.Admin)).toEqual([MarketRole.Editor]);
  });

  it('offers nothing to someone who grants nothing', () => {
    expect(getRolesForChange(MarketRole.Viewer, MarketRole.Editor)).toEqual([]);
  });
});
