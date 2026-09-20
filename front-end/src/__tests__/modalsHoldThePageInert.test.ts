import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';

/**
 * Every modal takes the page out of the tab order, and a modal added later cannot quietly skip it
 * (E14/F02/S04).
 *
 * A scrim stops the mouse and nothing stopped the keyboard: the vendor drawer declared
 * `aria-modal="true"` while fourteen controls behind it stayed tabbable, and `E14/F02/S02` fixed
 * that one. Every other modal in the product had it too.
 *
 * Wiring each is not enough on its own, because the next one will be written by someone who has not
 * read any of this. So the rule is enforced from the shape of the CSS rather than from a list that
 * has to be maintained: a component that paints a full-viewport cover is a modal, and a modal calls
 * `useInertBehind`.
 *
 * This is the test that found the gap in the first place. A hand survey of the overlays - by the
 * classes they use and by which of them call `useEscapeToClose` - found ten surfaces and missed
 * three: `VendorsModal`, `SaveFlow`, and the app's own navigation drawer.
 */

// Resolved from the project root rather than `import.meta.url`, for the reason `contrast.test.ts`
// gives: vitest transforms this module, so its `import.meta.url` is not a file: URL.
const SRC = resolvePath(process.cwd(), 'src');

/** The two spellings of "cover the whole viewport" this codebase uses. */
function coversTheViewport(block: string): boolean {
  if (!/position:\s*fixed/.test(block)) return false;
  if (/\binset:\s*0\b/.test(block)) return true;
  return (
    /\btop:\s*0\b/.test(block) &&
    /\bleft:\s*0\b/.test(block) &&
    /\bwidth:\s*100%/.test(block) &&
    /\bheight:\s*100%/.test(block)
  );
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return vueFiles(full);
    return full.endsWith('.vue') ? [full] : [];
  });
}

/** Files that paint a full-viewport cover, by the selectors that do it. */
function fullViewportCovers(): { file: string; selectors: string[]; wired: boolean }[] {
  return vueFiles(SRC)
    .map((file) => {
      const source = readFileSync(file, 'utf-8');
      const selectors: string[] = [];
      for (const match of source.matchAll(/\{[^{}]*\}/g)) {
        if (!coversTheViewport(match[0])) continue;
        const before = source.slice(0, match.index).trimEnd().split('\n');
        selectors.push(before[before.length - 1].trim());
      }
      return {
        file: relative(SRC, file),
        selectors,
        // A CALL, not a mention: the import line carries the name too, so `source.includes(...)`
        // reported a component as wired after its call had been deleted. Found by deleting one.
        wired: /useInertBehind\s*\(/.test(source),
      };
    })
    .filter((entry) => entry.selectors.length > 0);
}

describe('every modal holds the page inert', () => {
  it('finds the covers, so the rule below is not passing on an empty list', () => {
    expect(fullViewportCovers().length).toBeGreaterThanOrEqual(13);
  });

  it('has no full-viewport cover that leaves the page behind it reachable', () => {
    const unwired = fullViewportCovers()
      .filter((entry) => !entry.wired)
      .map((entry) => `${entry.file} (${entry.selectors.join(', ')})`);

    expect(
      unwired,
      'a component painting a full-viewport cover is a modal, and a modal calls useInertBehind: ' +
        'a scrim stops the mouse but leaves every control behind it in the tab order',
    ).toEqual([]);
  });
});
