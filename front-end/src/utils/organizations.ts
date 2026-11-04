import {
  type Organization,
  type OrganizationPerson,
  type OrganizationRoleType,
  type PermissionTableRow,
  type ThemeObject,
} from '@/assets/types/datatypes';
import { api } from '@/utils/api';

export type RawOrganization = {
  id: string;
  name: string;
  owner: string;
  admins?: string[];
  members?: string[];
  ownerEmail?: string;
  owner_email?: string;
  adminPeople?: OrganizationPerson[];
  memberPeople?: OrganizationPerson[];
  theme?: ThemeObject;
  userRole?: OrganizationRoleType;
  user_role?: OrganizationRoleType;
  defaultPermissionTable?: PermissionTableRow[];
  marketCount: number;
  marketsWithOwnRole: Record<string, number>;
};

export function parseOrgFromApi(org: RawOrganization): Organization {
  const userRole = org.userRole ?? org.user_role;
  return {
    id: org.id,
    name: org.name,
    owner: org.owner,
    admins: org.admins || [],
    members: org.members || [],
    ownerEmail: org.ownerEmail ?? org.owner_email,
    adminPeople: org.adminPeople ?? [],
    memberPeople: org.memberPeople ?? [],
    theme: org.theme,
    userRole: userRole ?? undefined,
    defaultPermissionTable: org.defaultPermissionTable,
    marketCount: org.marketCount,
    marketsWithOwnRole: org.marketsWithOwnRole,
  };
}

export async function fetchOrganizations(): Promise<Organization[]> {
  const response = await api.get('/organizations');
  return (response.data.organizations || []).map(parseOrgFromApi);
}

/** "11 markets", "1 market". */
function markets(count: number): string {
  return `${count} market${count === 1 ? '' : 's'}`;
}

/**
 * What Manage organization's Remove asks, and what the person loses (E38/F15/S01): its markets,
 * which they reach through it, less any they hold a role on of their own, which removing them
 * leaves. The counts are the organization read's.
 */
export function organizationRemoval(
  org: Organization,
  userId: string,
  email: string,
): { title: string; loses: string } {
  const title = `Remove ${email} from ${org.name}?`;
  const count = org.marketCount;
  if (count === 0) return { title, loses: 'It has no markets yet.' };
  const kept = Math.min(org.marketsWithOwnRole[userId] ?? 0, count);
  if (kept === 0) return { title, loses: `They lose access to its ${markets(count)}.` };
  if (kept === count) {
    return { title, loses: `They keep its ${markets(count)}, each through a role of their own.` };
  }
  return {
    title,
    loses:
      `They lose access to ${count - kept} of its ${markets(count)}, ` +
      `and keep the ${kept} they hold a role on of their own.`,
  };
}
