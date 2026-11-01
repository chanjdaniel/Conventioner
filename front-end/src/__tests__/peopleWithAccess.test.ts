/**
 * "Users with access" says each person's role that counts, and where it comes from (E38/F12/S01):
 * a row the organization counts for says so, and a market role it makes add nothing is said
 * beneath it. The server decides which counts (`fromOrganization`).
 */
import { describe, expect, it } from 'vitest';
import { MarketRole, type PersonWithAccess } from '@/assets/types/datatypes';
import { alsoWords, roleAddingNothing, roleWords } from '@/utils/peopleWithAccess';

function person(
  role: MarketRole,
  marketRole: MarketRole | null,
  organizationRole: 'admin' | 'member' | null,
  fromOrganization: boolean,
): PersonWithAccess {
  return {
    userId: 'u-1',
    email: 'someone@example.com',
    role,
    marketRole,
    organizationRole,
    fromOrganization,
  };
}

const ORG = 'Seed Test Org';

describe('a row of Users with access', () => {
  it('says the organization when its role counts, and the market role it outranks', () => {
    const admin = person(MarketRole.Admin, MarketRole.Editor, 'admin', true);

    expect(roleWords(admin, ORG)).toBe('Admin, through Seed Test Org');
    expect(roleAddingNothing(admin)).toBe(MarketRole.Editor);
    expect(alsoWords(admin, ORG)).toBe(
      'Also Editor on this market: this adds nothing while they are an admin of Seed Test Org.',
    );
  });

  it("names a member's place", () => {
    const member = person(MarketRole.Viewer, MarketRole.Viewer, 'member', true);

    expect(roleWords(member, ORG)).toBe('Viewer, through Seed Test Org');
    expect(alsoWords(member, ORG)).toBe(
      'Also Viewer on this market: this adds nothing while they are a member of Seed Test Org.',
    );
  });

  it('says only the role from the organization when the market names none', () => {
    const member = person(MarketRole.Viewer, null, 'member', true);

    expect(roleWords(member, ORG)).toBe('Viewer, through Seed Test Org');
    expect(roleAddingNothing(member)).toBeNull();
    expect(alsoWords(member, ORG)).toBe('');
  });

  it("says the market's own role alone when it counts", () => {
    const rows: Array<[PersonWithAccess, string]> = [
      [person(MarketRole.Editor, MarketRole.Editor, 'member', false), 'Editor'],
      [person(MarketRole.Owner, MarketRole.Owner, 'admin', false), 'Owner'],
      [person(MarketRole.Viewer, MarketRole.Viewer, null, false), 'Viewer'],
    ];
    for (const [row, words] of rows) {
      expect(roleWords(row, ORG)).toBe(words);
      expect(roleAddingNothing(row)).toBeNull();
      expect(alsoWords(row, ORG)).toBe('');
    }
  });
});
