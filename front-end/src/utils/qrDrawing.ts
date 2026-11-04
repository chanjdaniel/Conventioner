/**
 * A QR code drawn by the app as one SVG path, for the door code's poster (ADR 0022). Its own module
 * so the `qrcode` encoder loads only where a code is drawn, never on the vendor page.
 */
import { create } from 'qrcode';

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
