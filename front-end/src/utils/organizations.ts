import {
  type Organization,
  type OrganizationRoleType,
  type ThemeObject,
} from '@/assets/types/datatypes';
import { api } from '@/utils/api';

export type RawOrganization = {
  id: string;
  name: string;
  owner: string;
  admins?: string[];
  members?: string[];
  markets?: string[];
  ownerEmail?: string;
  owner_email?: string;
  adminEmails?: string[];
  admin_emails?: string[];
  memberEmails?: string[];
  member_emails?: string[];
  theme?: ThemeObject;
  userRole?: OrganizationRoleType;
  user_role?: OrganizationRoleType;
};

export function parseOrgFromApi(org: RawOrganization): Organization {
  const userRole = org.userRole ?? org.user_role;
  return {
    id: org.id,
    name: org.name,
    owner: org.owner,
    admins: org.admins || [],
    members: org.members || [],
    markets: org.markets || [],
    ownerEmail: org.ownerEmail ?? org.owner_email,
    adminEmails: org.adminEmails ?? org.admin_emails,
    memberEmails: org.memberEmails ?? org.member_emails,
    theme: org.theme,
    userRole: userRole ?? undefined,
  };
}

export async function fetchOrganizations(): Promise<Organization[]> {
  const response = await api.get('/organizations');
  return (response.data.organizations || []).map(parseOrgFromApi);
}
