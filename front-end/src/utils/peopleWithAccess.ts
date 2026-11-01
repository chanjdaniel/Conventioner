import type { PersonWithAccess } from '@/assets/types/datatypes';
import { getRoleDisplayName } from '@/utils/permissions';

/**
 * A person's role in Manage market's "Users with access", and where it comes from when that is
 * the organization (E38/F12/S01): "Admin, through Seed Test Org". The server decides which counts
 * (`fromOrganization`), so no screen ranks a role.
 */
export function roleWords(person: PersonWithAccess, organizationName: string): string {
  const role = getRoleDisplayName(person.role);
  return person.fromOrganization ? `${role}, through ${organizationName}` : role;
}

/** The market role a person's place in the organization makes add nothing, or null for none: its
 *  Remove only tidies it away. */
export function roleAddingNothing(person: PersonWithAccess) {
  return person.fromOrganization ? person.marketRole : null;
}

/** The line beneath a row whose market role adds nothing, or '' for none. */
export function alsoWords(person: PersonWithAccess, organizationName: string): string {
  const role = roleAddingNothing(person);
  if (!role) return '';
  const place = person.organizationRole === 'admin' ? 'an admin' : 'a member';
  return (
    `Also ${getRoleDisplayName(role)} on this market: this adds nothing while they ` +
    `are ${place} of ${organizationName}.`
  );
}

/**
 * What Manage market's Remove asks, and what the person loses (E38/F15/S01): Remove takes only the
 * market's own role, so a place in the organization stays, and is said, as the market's
 * organization line says it: its admins run it, its members can view it.
 */
export function marketRemoval(
  person: PersonWithAccess,
  marketName: string,
  organizationName: string,
): { title: string; loses: string; keeps: string } {
  const role = getRoleDisplayName(person.marketRole ?? person.role);
  const keeps =
    person.organizationRole === 'admin'
      ? `They can still run it as an admin of ${organizationName}.`
      : person.organizationRole === 'member'
        ? `They can still view it as a member of ${organizationName}.`
        : '';
  return {
    title: `Remove ${person.email} from ${marketName}?`,
    loses: `They lose their ${role} role on it.`,
    keeps,
  };
}
