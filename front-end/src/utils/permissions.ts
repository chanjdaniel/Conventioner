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
 * Check if current user can change the target user's role.
 */
export function canChangeRole(currentUserRole: MarketRole, targetRole: MarketRole): boolean {
    return canManageRoles(currentUserRole, targetRole);
}

/**
 * Get roles that the target can be changed to (based on current user's permissions).
 */
export function getRolesForChange(targetRole: MarketRole, currentUserRole: MarketRole): MarketRole[] {
    if (currentUserRole === MarketRole.Owner) {
        return [MarketRole.Admin, MarketRole.Editor, MarketRole.Viewer];
    }
    if (currentUserRole === MarketRole.Admin) {
        return [MarketRole.Admin, MarketRole.Editor, MarketRole.Viewer];
    }
    return [];
}

/**
 * Get role display name.
 */
export function getRoleDisplayName(role: MarketRole): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
}
