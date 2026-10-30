/**
 * How the tab Connect Discord opened tells the market's own tab that it is connected (E46/F01/S02).
 *
 * Discord's approval screen opens in a new tab, so the organizer's market stays where it was; the
 * page Discord returns to says so on a `BroadcastChannel`, and the Discord card re-reads the market.
 * A browser without one, or a message that never arrives, still meets the market re-read when its
 * tab is shown again (`useOpenMarket`).
 */
export const DISCORD_CHANNEL = 'conventioner-discord';

type Message = { connected: string };

/** Say that this market is now connected, to every tab of this site. */
export function announceDiscordConnected(marketId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(DISCORD_CHANNEL);
  channel.postMessage({ connected: marketId } satisfies Message);
  channel.close();
}

/** Call `then` whenever another tab connects this market; the returned function stops listening. */
export function whenDiscordConnected(marketId: () => string, then: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(DISCORD_CHANNEL);
  channel.onmessage = (event: MessageEvent<Partial<Message>>) => {
    if (event.data?.connected === marketId()) then();
  };
  return () => channel.close();
}
