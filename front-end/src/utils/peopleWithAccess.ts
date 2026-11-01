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
