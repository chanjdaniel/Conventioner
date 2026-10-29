import { type Market, MarketRole } from '@/assets/types/datatypes';
import { MarketAction, mayTake } from '@/utils/marketActions';

type Answered = Pick<Market, 'actionRefusals'> | null | undefined;

/**
 * The row of the table that gives and takes each role, as `roles_row` rules on the server: Editor
 * and Viewer roles one, Admin roles another. None for the Owner: a market has one, and nobody
 * changes or takes it through Manage market (bug 43 - the owner's own row offered a select the
 * server refused every use of); handing it on is a transfer, not a role change.
 */
const ROW_OF_ROLE: Record<MarketRole, MarketAction | null> = {
  [MarketRole.Owner]: null,
  [MarketRole.Admin]: MarketAction.ManageAdmins,
  [MarketRole.Editor]: MarketAction.ManageEditorsAndViewers,
  [MarketRole.Viewer]: MarketAction.ManageEditorsAndViewers,
};

/** The roles Manage market gives, in the order it offers them. */
export const GIVEN_ROLES: MarketRole[] = [MarketRole.Admin, MarketRole.Editor, MarketRole.Viewer];

/**
 * Whether the person looking may give, take or change `role` on this market: the table's answer
 * for the row that gives it.
 */
export function canManageRoles(market: Answered, role: MarketRole): boolean {
  const row = ROW_OF_ROLE[role];
  return row !== null && mayTake(market, row);
}

/**
 * The roles someone holding `targetRole` may be changed TO: those the person looking may give,
 * other than the one held, and none when the role held is not theirs to take, as
 * `update_market_role` asks the row of both.
 */
export function getRolesForChange(market: Answered, targetRole: MarketRole): MarketRole[] {
  if (!canManageRoles(market, targetRole)) return [];
  return GIVEN_ROLES.filter((role) => role !== targetRole && canManageRoles(market, role));
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
