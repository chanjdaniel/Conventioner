/**
 * A colour a canvas can paint (found fixing bug 38).
 *
 * Konva draws on a <canvas>, which does not resolve CSS custom properties: handed `var(--mm-red)` it
 * kept painting in its previous colour, silently, so the calibration line, its markers, a wall's
 * handles and a table type given a token from the palette all drew in some other colour.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canvasColor } from '@/utils/canvasColor';

afterEach(() => document.documentElement.style.removeProperty('--test-red'));

describe('canvasColor', () => {
  it('resolves a design token to the colour the stylesheet gives it', () => {
    document.documentElement.style.setProperty('--test-red', '#b23a2a');

    expect(canvasColor('var(--test-red)')).toBe('#b23a2a');
  });

  it('passes a colour through as it is', () => {
    expect(canvasColor('#4A90D9')).toBe('#4A90D9');
    expect(canvasColor('rgba(180, 130, 100, 0.4)')).toBe('rgba(180, 130, 100, 0.4)');
  });

  it('leaves a token the stylesheet does not define as it was, rather than guessing', () => {
    expect(canvasColor('var(--never-defined)')).toBe('var(--never-defined)');
  });
});
