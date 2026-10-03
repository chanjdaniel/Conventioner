/**
 * A colour a canvas can paint.
 *
 * The floorplan draws with Konva, on a `<canvas>`, and a canvas does not resolve CSS custom
 * properties: `var(--mm-red)` is not a colour there. It is not an error either - the canvas keeps
 * painting with whatever colour it last had, so the calibration line, its markers, a wall's handles
 * and a table type given a token from the palette all drew in some other colour, silently (found
 * fixing bug 38). The design tokens are still the colours to use; this resolves one to the value
 * the stylesheet gives it, at the moment of drawing.
 *
 * Anything that is not exactly `var(--name)` - a hex, an rgba - is already a colour and passes
 * through. A token the stylesheet does not define passes through unchanged rather than becoming a
 * guess, which leaves it as visibly wrong as before instead of quietly another colour.
 */
export function canvasColor(value: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!token) return value;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim();
  return resolved || value;
}
