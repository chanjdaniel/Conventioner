/**
 * The market's door code (ADR 0022): what a vendor scans or types at the entrance to check in.
 *
 * One live code per market, served only by its own endpoint to whoever may check vendors in, and
 * never by the market read. It stays the same until someone presses "New code", which ends it and
 * every poster of it. The QR code opens the vendor page with the code, `<app>/<slug>?door=<code>`,
 * the `url` the server answers.
 */
import { create } from 'qrcode';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { MarketAction, mayTake } from '@/utils/marketActions';

/** A market's door code as the server answers it, or `{ code: null }` before the first. */
export type DoorCode =
  { code: null } | { code: string; madeAt: string; madeBy: string; url: string };

/** "K7M4QP" as a poster shows it, two groups of three: "K7M 4QP". */
export function doorCodeInWords(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Whether Attendance offers "Door code": in Market Days, to whoever may check vendors in. The
 *  server is the authority. */
export function offersDoorCode(market: Pick<Market, 'phase' | 'actionRefusals'> | null): boolean {
  return market?.phase === MarketPhase.MarketDays && mayTake(market, MarketAction.CheckIn);
}

/** The white border a QR reader needs round the code, in modules: the standard's four. */
export const QUIET_ZONE = 4;

/** A QR code as one SVG path: its `viewBox` side in modules, quiet zone included, and the path
 *  of its dark modules, one rectangle per run of them along a row. */
export interface QrDrawing {
  side: number;
  path: string;
}

/**
 * The QR code of `text`, drawn as one path. The `qrcode` package encodes it; the app draws it, so
 * nothing is put into the page as markup. Error correction "M" survives a smudged or creased
 * poster and keeps the modules large enough to scan from a phone held at arm's length.
 */
export function qrDrawing(text: string): QrDrawing {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const runs: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    let column = 0;
    while (column < modules.size) {
      if (!modules.get(row, column)) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < modules.size && modules.get(row, column)) column += 1;
      const length = column - start;
      runs.push(`M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${length}v1h-${length}z`);
    }
  }
  return { side: modules.size + 2 * QUIET_ZONE, path: runs.join('') };
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
