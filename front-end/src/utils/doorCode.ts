/**
 * The market's door code (ADR 0022): what a vendor scans or types at the entrance to check in.
 *
 * One live code per market, served only by its own endpoint to whoever may check vendors in, and
 * never by the market read. It stays the same until someone presses "New code", which ends it and
 * every poster of it. The QR code opens the vendor page with the code, `<app>/<slug>?door=<code>`,
 * the `url` the server answers. The QR code itself is drawn by `qrDrawing.ts`, kept apart so that
 * the vendor page, which reads and types the code, never loads the encoder.
 */
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { MarketAction, mayTake } from '@/utils/marketActions';

/** A market's door code as the server answers it, or `{ code: null }` before the first. */
export type DoorCode =
  { code: null } | { code: string; madeAt: string; madeBy: string; url: string };

/** How many characters a door code has: the back end's `DOOR_CODE_LENGTH`. */
export const DOOR_CODE_LENGTH = 6;

/** "K7M4QP" as a poster shows it, two groups of three: "K7M 4QP". */
export function doorCodeInWords(code: string): string {
  const half = DOOR_CODE_LENGTH / 2;
  return code.length === DOOR_CODE_LENGTH ? `${code.slice(0, half)} ${code.slice(half)}` : code;
}

/** A typed door code as the poster prints it: upper case, its spaces and dashes dropped. */
export function normalizedDoorCode(typed: string): string {
  return typed.replace(/[\s-]/g, '').toUpperCase();
}

/** Has a typed door code all its characters yet, read as the server reads it? */
export function isWholeDoorCode(typed: string): boolean {
  return normalizedDoorCode(typed).length === DOOR_CODE_LENGTH;
}

/** Whether Attendance offers "Door code": in Market Days, to whoever may check vendors in. The
 *  server is the authority. */
export function offersDoorCode(market: Pick<Market, 'phase' | 'actionRefusals'> | null): boolean {
  return market?.phase === MarketPhase.MarketDays && mayTake(market, MarketAction.CheckIn);
}

function doorCodePath(marketId: string): string {
  return `/markets/${encodeURIComponent(marketId)}/door-code`;
}

/** The market's live door code. */
export async function readDoorCode(marketId: string): Promise<DoorCode> {
  const { data } = await api.get<DoorCode>(doorCodePath(marketId));
  return data;
}

/** A new door code, the first or one that ends the old. */
export async function makeDoorCode(marketId: string): Promise<DoorCode> {
  const { data } = await api.post<DoorCode>(doorCodePath(marketId));
  return data;
}
