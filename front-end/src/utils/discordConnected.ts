/**
 * How the tab Connect Discord opened tells the market's own tab how connecting ended (E46/F01/S02).
 *
 * Discord's approval screen opens in a new tab, so the organizer's market stays where it was; the
 * page Discord returns to says on a `BroadcastChannel` whether the market is now connected, and the
 * Discord card re-reads the market, or stops saying Discord is open. A browser without one, or a
 * message that never arrives, still meets the market re-read when its tab is shown again
 * (`useOpenMarket`).
 */
export const DISCORD_CHANNEL = 'conventioner-discord';

/** One market's connecting, ended: connected, or not (cancelled on Discord, or refused). */
type Message = { connected: string } | { notConnected: string };

function post(message: Message): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(DISCORD_CHANNEL);
  channel.postMessage(message);
  channel.close();
}

/** Say that this market is now connected, to every tab of this site. */
export function announceDiscordConnected(marketId: string): void {
  post({ connected: marketId });
}

/** Say that connecting this market ended without a connection. */
export function announceDiscordNotConnected(marketId: string): void {
  post({ notConnected: marketId });
}

/**
 * Hear how another tab's connecting of this market ended; the returned function stops listening.
 */
export function whenDiscordEnds(
  marketId: () => string,
  on: { connected: () => void; notConnected: () => void },
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(DISCORD_CHANNEL);
  channel.onmessage = (event: MessageEvent<Partial<Record<keyof Message, string>>>) => {
    const data = event.data ?? {};
    if ('connected' in data && data.connected === marketId()) on.connected();
    else if ('notConnected' in data && data.notConnected === marketId()) on.notConnected();
  };
  return () => channel.close();
}
