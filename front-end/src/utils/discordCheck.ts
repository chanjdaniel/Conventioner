/**
 * Who is in the market's Discord server (E46/F01/S03): each vendor as the last "Check Discord"
 * found them, kept on the market's Discord connection by application with when it was checked
 * (`back-end/api/discord_connection.py`, `check`), and the words the Vendors page and the history
 * say them in.
 */
import { api } from '@/utils/api';
import { MarketAction, mayTake } from '@/utils/marketActions';
import type { Market } from '@/assets/types/datatypes';

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

export function discordStateChip(state: DiscordState): string {
  return CHIPS[state];
}

/** The state a value names, as the address's `discord` key or a history entry holds it. */
export function discordStateFrom(value: unknown): DiscordState | null {
  return isDiscordState(value) ? value : null;
}

/** Each vendor's state by their application's id; one this build does not know is left out. */
export function discordStates(market: Market | null | undefined): Map<string, DiscordState> {
  const states = new Map<string, DiscordState>();
  for (const vendor of market?.discord?.vendorStates ?? []) {
    if (isDiscordState(vendor.state)) states.set(vendor.applicationId, vendor.state);
  }
  return states;
}

/** How long ago `at` was, in words: just now, then minutes, hours, and days. */
export function agoWords(at: string, now: number): string {
  const minutes = Math.floor(Math.max(now - Date.parse(at), 0) / 60_000);
  const ago = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;
  if (!(minutes >= 1)) return 'just now';
  if (minutes < 60) return ago(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, 'hour');
  return ago(Math.floor(hours / 24), 'day');
}

/** When the check ran, in words: "Checked 5 minutes ago". */
export function checkedAgo(checkedAt: string, now: number): string {
  return `Checked ${agoWords(checkedAt, now)}`;
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

/** Ask the server to check; the page reads the market again for what it found. */
export async function checkDiscord(marketId: string): Promise<void> {
  await api.post(`/markets/${encodeURIComponent(marketId)}/discord/check`);
}
