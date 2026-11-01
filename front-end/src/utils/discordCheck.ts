/**
 * Who is in the market's Discord server (E46/F01/S03): each vendor as the last "Check Discord"
 * found them, kept on the market's Discord connection by application with when it was checked
 * (`back-end/api/discord_connection.py`, `check`), and the words the Vendors page and the history
 * say them in.
 */
import { api } from '@/utils/api';
import { MarketAction, mayTake } from '@/utils/marketActions';
import type { DiscordPossibleMatch, Market } from '@/assets/types/datatypes';

/**
 * Has the role (in the server, holding the market's role), in the server, not found (no member has
 * the username: not joined yet, or the username is wrong, which cannot be told apart), or no
 * username (the form's question has no answer).
 */
export type DiscordState = 'has_role' | 'in_server' | 'not_found' | 'no_username';

/** The states in the order the page offers and counts them. */
export const DISCORD_STATES: readonly DiscordState[] = [
  'has_role',
  'in_server',
  'not_found',
  'no_username',
];

const LABELS: Record<DiscordState, string> = {
  has_role: 'Has the role',
  in_server: 'In the server',
  not_found: 'Not found',
  no_username: 'No username',
};

/** Each state's chip: the role given is done, in the server is nearly, not found asks a fix. */
const CHIPS: Record<DiscordState, string> = {
  has_role: 'chip chip--positive',
  in_server: 'chip chip--informational',
  not_found: 'chip chip--attention',
  no_username: 'chip chip--neutral',
};

export function isDiscordState(value: unknown): value is DiscordState {
  return typeof value === 'string' && (DISCORD_STATES as readonly string[]).includes(value);
}

export function discordStateLabel(state: DiscordState): string {
  return LABELS[state];
}

/** The state a value names, as a history entry holds it. */
export function discordStateFrom(value: unknown): DiscordState | null {
  return isDiscordState(value) ? value : null;
}

/** When the check ran, in words: just now, then minutes, hours, and days. */
export function checkedAgo(checkedAt: string, now: number): string {
  const minutes = Math.floor(Math.max(now - Date.parse(checkedAt), 0) / 60_000);
  const ago = (count: number, unit: string) =>
    `Checked ${count} ${unit}${count === 1 ? '' : 's'} ago`;
  if (!(minutes >= 1)) return 'Checked just now';
  if (minutes < 60) return ago(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, 'hour');
  return ago(Math.floor(hours / 24), 'day');
}

/**
 * Whether "Check Discord" is offered: to whoever the table's "Connect Discord and give roles" row
 * allows, on a market connected to a server, with a username question chosen, on a Conventioner
 * with Discord's values. The server judges the question again, since the form may have lost it.
 */
export function mayCheckDiscord(market: Market | null | undefined): boolean {
  return (
    !!market?.discordSetUp &&
    !!market.discord?.guildId &&
    !!market.discord.usernameQuestion &&
    mayTake(market, MarketAction.ConnectDiscord)
  );
}

/**
 * What the page shows of a vendor (E46/F01/S05): the check's state, or one of two things that
 * tell the organizer more. "Possible match" is a vendor not found who was offered a member whose
 * name looks like the username on file, for the organizer to confirm or decline; "Check again" is
 * a vendor whose username was updated after the check, which the state was not read for.
 */
export type DiscordShown = DiscordState | 'possible_match' | 'check_again';

/** What the page shows, in the order its filter offers and counts them. */
export const DISCORD_SHOWN: readonly DiscordShown[] = [
  'has_role',
  'in_server',
  'possible_match',
  'not_found',
  'no_username',
  'check_again',
];

const SHOWN_LABELS: Record<DiscordShown, string> = {
  ...LABELS,
  possible_match: 'Possible match',
  check_again: 'Check again',
};

/** A possible match asks the organizer's answer, as not found asks a fix; check again says only
 *  that the state is old. */
const SHOWN_CHIPS: Record<DiscordShown, string> = {
  ...CHIPS,
  possible_match: 'chip chip--attention',
  check_again: 'chip chip--neutral',
};

export function discordShownLabel(shown: DiscordShown): string {
  return SHOWN_LABELS[shown];
}

export function discordShownChip(shown: DiscordShown): string {
  return SHOWN_CHIPS[shown];
}

/** What a value names, as the address's `discord` key holds it. */
export function discordShownFrom(value: unknown): DiscordShown | null {
  return typeof value === 'string' && (DISCORD_SHOWN as readonly string[]).includes(value)
    ? (value as DiscordShown)
    : null;
}

/** One vendor as the page shows them: the check's state, what is shown, the members offered, and
 *  how many more looked alike than were kept. */
export interface DiscordVendor {
  state: DiscordState;
  shown: DiscordShown;
  /** The members offered as possible matches, less any declined since; none once checked again. */
  matches: DiscordPossibleMatch[];
  /** How many more members looked alike than the check kept, past its cap of five. */
  moreMatches: number;
}

/**
 * Each vendor as the page shows them, by application id, as the market read serves them
 * (`discordVendors`): the server works out "Possible match" and "Check again" against the
 * applications as the organizer reads them now (`shown_vendors` in
 * `back-end/api/discord_connection.py`), so this page, the drawer and the export agree. A value
 * this build does not know is left out.
 */
export function discordVendors(market: Market | null | undefined): Map<string, DiscordVendor> {
  const shown = new Map<string, DiscordVendor>();
  for (const vendor of market?.discordVendors ?? []) {
    const what = discordShownFrom(vendor.shown);
    if (!what || !isDiscordState(vendor.state)) continue;
    shown.set(vendor.applicationId, {
      state: vendor.state,
      shown: what,
      matches: vendor.possibleMatches ?? [],
      moreMatches: vendor.moreMatches ?? 0,
    });
  }
  return shown;
}

/** Whether the check asks something of the organizer about this vendor: an offer to answer, or a
 *  username updated since that it was not read for. */
export function discordAsks(vendor: DiscordVendor | null | undefined): boolean {
  return vendor?.shown === 'possible_match' || vendor?.shown === 'check_again';
}

/** The names a member offered goes by in the server, their nickname first: what the organizer
 *  recognises them by beside their username. */
export function matchNames(match: DiscordPossibleMatch): string[] {
  return [...new Set([match.nick, match.displayName].filter((name): name is string => !!name))];
}

/** Say a member offered is not this vendor: never offered to them again on this server. */
export async function declineMatch(
  marketId: string,
  applicationId: string,
  username: string,
): Promise<void> {
  await api.post(
    `/markets/${encodeURIComponent(marketId)}/discord/possible-matches/${encodeURIComponent(
      applicationId,
    )}/declined`,
    { username },
  );
}

/** Ask the server to check; the page reads the market again for what it found. */
export async function checkDiscord(marketId: string): Promise<void> {
  await api.post(`/markets/${encodeURIComponent(marketId)}/discord/check`);
}
