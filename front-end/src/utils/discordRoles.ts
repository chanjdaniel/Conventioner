/**
 * Giving the market's Discord role to the assigned vendors (E46/F01/S04): who may run it, what its
 * confirmation asks, and the last run's report, kept on the market's Discord connection by
 * application (`back-end/api/discord_connection.py`, `give_roles`).
 */
import { api } from '@/utils/api';
import { mayCheckDiscord } from '@/utils/discordCheck';
import type { DiscordRoleRun, Market } from '@/assets/types/datatypes';

/**
 * Given, already had it, not found (no member has the username), no username, not given yet (the
 * run's time ended first, so a second run gives it), or failed with its reason in words.
 */
export type RoleOutcome =
  'given' | 'already_had' | 'not_found' | 'no_username' | 'not_yet' | 'failed';

/** The outcomes in the order the report counts them. */
export const ROLE_OUTCOMES: readonly RoleOutcome[] = [
  'given',
  'already_had',
  'not_found',
  'no_username',
  'not_yet',
  'failed',
];

/** The outcomes whose vendors are grouped by the reason the server gave. */
const REASONED: readonly RoleOutcome[] = ['not_yet', 'failed'];

const LABELS: Record<RoleOutcome, string> = {
  given: 'Given',
  already_had: 'Already had it',
  not_found: 'Not found',
  no_username: 'No username',
  not_yet: 'Not given yet',
  failed: 'Failed',
};

/**
 * Each outcome's chip: given and already had it are done, not found and not given yet ask the
 * organizer to act, failed went wrong.
 */
const CHIPS: Record<RoleOutcome, string> = {
  given: 'chip chip--positive',
  already_had: 'chip chip--positive',
  not_found: 'chip chip--attention',
  no_username: 'chip chip--neutral',
  not_yet: 'chip chip--attention',
  failed: 'chip chip--destructive',
};

export function isRoleOutcome(value: unknown): value is RoleOutcome {
  return typeof value === 'string' && (ROLE_OUTCOMES as readonly string[]).includes(value);
}

export function roleOutcomeLabel(outcome: RoleOutcome): string {
  return LABELS[outcome];
}

export function roleOutcomeChip(outcome: RoleOutcome): string {
  return CHIPS[outcome];
}

/**
 * Whether "Give roles" is offered: as "Check Discord" is, and with a role chosen on the card. The
 * server judges the role, the question and the seats again.
 */
export function mayGiveRoles(market: Market | null | undefined): boolean {
  return mayCheckDiscord(market) && !!market?.discord?.roleId;
}

/** What the confirmation asks: "Give Vendor Nov 2026 to 54 assigned vendors?" */
export function giveRolesQuestion(roleName: string, assigned: number | null): string {
  const role = roleName || 'the role';
  if (assigned === null) return `Give ${role} to every assigned vendor?`;
  return `Give ${role} to ${assigned} assigned ${assigned === 1 ? 'vendor' : 'vendors'}?`;
}

/** Ask the server to give the role; the page reads the market again for the report. */
export async function giveRoles(marketId: string): Promise<void> {
  await api.post(`/markets/${encodeURIComponent(marketId)}/discord/role-run`);
}

/**
 * One group of the report: an outcome, and for a failure or a vendor not given it yet its reason,
 * with the vendors in it.
 */
export interface RoleRunGroup {
  outcome: RoleOutcome;
  reason: string;
  applicationIds: string[];
}

/**
 * The last run's vendors by outcome, in the report's order; a failure, and a vendor not given it
 * yet, is grouped by its reason, so a reason every grant shared is said once. An outcome this
 * build does not know is left out.
 */
export function roleRunGroups(run: DiscordRoleRun | null | undefined): RoleRunGroup[] {
  const groups: RoleRunGroup[] = [];
  for (const outcome of ROLE_OUTCOMES) {
    for (const each of run?.outcomes ?? []) {
      if (each.outcome !== outcome) continue;
      const reason = REASONED.includes(outcome) ? (each.reason ?? '') : '';
      let group = groups.find((g) => g.outcome === outcome && g.reason === reason);
      if (!group) {
        group = { outcome, reason, applicationIds: [] };
        groups.push(group);
      }
      group.applicationIds.push(each.applicationId);
    }
  }
  return groups;
}

/** How many of the last run's vendors ended in each outcome. */
export function roleRunCounts(run: DiscordRoleRun | null | undefined): Map<RoleOutcome, number> {
  const counts = new Map(ROLE_OUTCOMES.map((outcome) => [outcome, 0]));
  for (const each of run?.outcomes ?? []) {
    if (isRoleOutcome(each.outcome)) counts.set(each.outcome, (counts.get(each.outcome) ?? 0) + 1);
  }
  return counts;
}

/** The counts in words, each outcome that holds anyone: "2 given, 1 already had it". */
export function roleRunSummary(counts: Map<RoleOutcome, number>): string {
  const said = ROLE_OUTCOMES.filter((outcome) => (counts.get(outcome) ?? 0) > 0).map(
    (outcome) => `${counts.get(outcome)} ${roleOutcomeLabel(outcome).toLowerCase()}`,
  );
  return said.length ? said.join(', ') : 'no assigned vendors';
}
