/**
 * Every weight the product asks for is a weight it actually loaded (E15/F01/S02).
 *
 * `main.css` declared one `@font-face` per family, one weight each, neither carrying a
 * `font-weight` descriptor - while the source asked for a heavier weight **65 times**: `500` x27,
 * `600` x24, `bold` x14, plus `100` x2. With no matching face the browser synthesises the weight by
 * smearing the regular outline, which is why emphasis across the product read as muddy rather than
 * crisp. `document.fonts` confirmed it: one face per family, both `weight: normal`.
 *
 * Nothing needed downloading. `public/fonts/Outfit/static/` had shipped Medium, SemiBold and Bold
 * all along, and `public/fonts/Outfit-VariableFont_wght.ttf` covers the whole axis for the same
 * 108KB two static weights would have cost.
 *
 * Two things are asserted, because either alone lets the bug back:
 *
 *   1. Every weight any rule asks for is inside a declared face's range.
 *   2. The product only asks for the weights the design language names, so the set stays small
 *      enough to keep honest. `docs/design-system.md` names 400 and 600.
 *
 * It is family-aware, and has to be. Merge One ships one weight and always will; Outfit is a
 * variable font covering the whole axis. A check that only asked "is this weight loaded somewhere"
 * would wave through `font-family: 'Merge One'; font-weight: bold`, which is six real rules in this
 * repo and is synthesised exactly as before.
 *
 * What it does NOT see: a `font-weight` set from TypeScript (the Konva canvas does this), a weight
 * applied by a component library's own stylesheet, and the family of a rule that sets a weight
 * without naming a family - that one inherits, which no static read can resolve, so it is measured
 * against the body face.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(process.cwd(), 'src');
const MAIN_CSS = readFileSync(join(SRC, 'assets/main.css'), 'utf8');

/** The weights `docs/design-system.md` names. Anything else is drift, not emphasis. */
const ALLOWED_WEIGHTS = new Set([400, 600]);

/** `bold` is 700 and `normal` is 400; everything else in the wild here is already numeric. */
function asNumber(weight: string): number | null {
  const named: Record<string, number> = { normal: 400, bold: 700 };
  const cleaned = weight.trim().toLowerCase();
  if (named[cleaned] !== undefined) return named[cleaned];
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** The family every non-heading surface inherits, when a rule names no family of its own. */
const BODY_FACE = 'Outfit';

function familyOf(declaration: string): string {
  return declaration
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

/** Per family, the weight ranges its declared faces cover. */
function declaredRanges(css: string): Map<string, [number, number][]> {
  const byFamily = new Map<string, [number, number][]>();
  for (const block of css.matchAll(/@font-face\s*\{([^{}]*)\}/g)) {
    const family = block[1].match(/font-family:\s*([^;]+);/);
    if (!family) continue;
    const name = familyOf(family[1]);

    const descriptor = block[1].match(/font-weight:\s*([^;]+);/);
    // No descriptor means the face claims `normal` alone - the defect this story fixes.
    let range: [number, number] = [400, 400];
    if (descriptor) {
      const parts = descriptor[1].trim().split(/\s+/).map(asNumber);
      if (parts.length === 2 && parts[0] !== null && parts[1] !== null)
        range = [parts[0], parts[1]];
      else if (parts[0] !== null) range = [parts[0], parts[0]];
    }
    byFamily.set(name, [...(byFamily.get(name) ?? []), range]);
  }
  return byFamily;
}

function sourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full, extensions);
    return extensions.some((e) => entry.endsWith(e)) ? [full] : [];
  });
}

/** Every `font-weight` a rule asks for, with the family it asks it of. */
function requestedWeights(): { weight: number; family: string; file: string }[] {
  const asked: { weight: number; family: string; file: string }[] = [];
  for (const file of sourceFiles(SRC, ['.css', '.vue'])) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Innermost rule blocks, so a weight is read beside the family declared with it.
    for (const chunk of source.split('}')) {
      const opens = chunk.lastIndexOf('{');
      if (opens === -1) continue;
      // Inside `@font-face` a weight is a descriptor declaring what the file IS, not a request.
      if (/@font-face\s*$/.test(chunk.slice(0, opens).trim())) continue;

      const body = chunk.slice(opens + 1);
      const weightMatch = body.match(/font-weight:\s*([^;]+);/);
      if (!weightMatch) continue;
      const weight = asNumber(weightMatch[1]);
      if (weight === null) continue;

      // `inherit` is not a family, it is the absence of one - so the weight is asked of whatever
      // the element inherits, which for everything but a heading is the body face. The primitives
      // say `font-family: inherit` deliberately, and reading that as a family name reported them
      // as asking a face called "inherit" for a weight it could not have.
      const familyMatch = body.match(/font-family:\s*([^;]+);/);
      const declared = familyMatch ? familyOf(familyMatch[1]) : '';
      asked.push({
        weight,
        family: declared && declared !== 'inherit' ? declared : BODY_FACE,
        file: relative(SRC, file),
      });
    }
  }
  return asked;
}

describe('every weight the product asks for was actually loaded', () => {
  it('covers each requested weight with a declared face', () => {
    const byFamily = declaredRanges(MAIN_CSS);
    expect(byFamily.size, 'main.css should declare at least one @font-face').toBeGreaterThan(0);

    const covered = (family: string, weight: number) =>
      (byFamily.get(family) ?? []).some(([lo, hi]) => weight >= lo && weight <= hi);

    const synthesised = requestedWeights()
      .filter(({ family, weight }) => !covered(family, weight))
      .map(({ weight, family, file }) => `${file} asks ${family} for ${weight}`);

    expect([...new Set(synthesised)]).toEqual([]);
  });

  it('asks only for the weights the design language names', () => {
    // Without this, the first fix holds while the number of weights creeps back up - and a variable
    // font would cover all of them, so nothing would ever look broken enough to notice.
    const strays = requestedWeights()
      .filter(({ weight }) => !ALLOWED_WEIGHTS.has(weight))
      .map(({ weight, file }) => `${file} asks for ${weight}`);

    expect([...new Set(strays)]).toEqual([]);
  });
});
