import { MarketRole } from '@/assets/types/datatypes';

/**
 * Permission hierarchy: Owner > Admin > Editor > Viewer
 */
const roleHierarchy: Record<MarketRole, number> = {
  [MarketRole.Owner]: 4,
  [MarketRole.Admin]: 3,
  [MarketRole.Editor]: 2,
  [MarketRole.Viewer]: 1,
};

/**
 * Check if user role has required permission level.
 */
export function hasPermission(userRole: MarketRole, requiredRole: MarketRole): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Check if user can edit (Owner, Admin, or Editor).
 */
export function canEdit(userRole: MarketRole): boolean {
  return hasPermission(userRole, MarketRole.Editor);
}

/**
 * Check if user can view (all roles).
 */
export function canView(userRole: MarketRole): boolean {
  return hasPermission(userRole, MarketRole.Viewer);
}

/**
 * Check if user can manage roles with target_role.
 * - Owner can manage all roles
 * - Admin can manage Editor and Viewer only
 */
export function canManageRoles(userRole: MarketRole, targetRole: MarketRole): boolean {
  // Owner can manage all roles
  if (userRole === MarketRole.Owner) {
    return true;
  }

  // Admin can manage Editor and Viewer
  if (userRole === MarketRole.Admin) {
    return targetRole === MarketRole.Editor || targetRole === MarketRole.Viewer;
  }

  return false;
}

/**
 * Whether the current user may change the target user's role, as `update_market_role` rules: never
 * an owner's (bug 43 - the owner's own row offered a select the server refused every use of), an
 * admin's only by an owner, and otherwise whoever may manage that role.
 */
export function canChangeRole(currentUserRole: MarketRole, targetRole: MarketRole): boolean {
  if (targetRole === MarketRole.Owner) return false;
  return canManageRoles(currentUserRole, targetRole);
}

/**
 * The roles the target may be changed TO: those the current user may grant, other than the one
 * they hold. Never Owner - a market has one, and handing it on is a transfer, not a role change.
 */
export function getRolesForChange(
  targetRole: MarketRole,
  currentUserRole: MarketRole,
): MarketRole[] {
  return [MarketRole.Admin, MarketRole.Editor, MarketRole.Viewer].filter(
    (role) => role !== targetRole && canManageRoles(currentUserRole, role),
  );
}

/**
 * A role as a human reads it.
 *
 * Takes a plain string, not a `MarketRole`: organization roles are a different enum with the
 * same spelling problem, and Organizations printed the stored lower-case value beside a Markets
 * page that capitalized it. One rule, both callers.
 */
export function getRoleDisplayName(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
