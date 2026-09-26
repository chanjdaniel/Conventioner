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
 *
 * What it does NOT see, so that the next reader does not assume otherwise:
 *
 * - Only `.vue` files, and only their own `<style>`. A cover painted from a shared stylesheet, or
 *   by a component library, is invisible here - which is why PrimeVue's modal `Dialog` is matched
 *   by markup below instead.
 * - `\{[^{}]*\}` matches innermost blocks only, so a rule containing a nested block (CSS nesting,
 *   which this repo does not use yet) would hide the declarations around it.
 * - Wiring is counted per FILE, not per modal. `PhaseRail` holds two dialogs and would pass on one
 *   call; it has two, but nothing here would notice if it did not.
 */

// Resolved from the project root rather than `import.meta.url`, for the reason `contrast.test.ts`
// gives: vitest transforms this module, so its `import.meta.url` is not a file: URL.
const SRC = resolvePath(process.cwd(), 'src');

/** The spellings of "cover the whole viewport" a hand-rolled modal uses. */
function coversTheViewport(block: string): boolean {
  if (!/position:\s*fixed/.test(block)) return false;
  if (/\binset:\s*0\b/.test(block)) return true;
  const sides = (...names: string[]) =>
    names.every((n) => new RegExp(`\\b${n}:\\s*0\\b`).test(block));
  if (sides('top', 'right', 'bottom', 'left')) return true;
  return sides('top', 'left') && /\bwidth:\s*100%/.test(block) && /\bheight:\s*100%/.test(block);
}

/**
 * A PrimeVue `<Dialog :modal="true">` is a modal too, and it is invisible to the rule above: its
 * full-viewport mask is painted by the library's own stylesheet, never by the component's scoped
 * `<style>`. It does not need `useInertBehind` - PrimeVue applies its own focus trap on exactly that
 * prop (`[_directive_focustrap, { disabled: !modal }]` in `primevue/dialog`) - but it does need to
 * be recognised, or the rule below would be claiming something it had not checked.
 */
function usesALibraryModal(source: string): boolean {
  return /<Dialog\b[^>]*:modal="true"/s.test(source);
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
        wired: /use(InertBehind|ModalRoot)\s*\(/.test(source),
      };
    })
    .filter((entry) => entry.selectors.length > 0);
}

describe('every modal holds the page inert', () => {
  it('finds the covers, so the rule below is not passing on an empty list', () => {
    /*
     * A FLOOR, and one that falls on purpose. Every dialog rebuilt on `AppDialog` (E20/F01) stops
     * painting its own cover, because the shell paints it - so the honest number goes DOWN as the
     * idiom spreads, and lowering it is a migration landing rather than a rule being weakened.
     * What must never fall is the shell itself, which is why it is named below.
     */
    expect(fullViewportCovers().length).toBeGreaterThanOrEqual(7);
  });

  it('includes the dialog shell, which paints the cover for every dialog built on it', () => {
    // If this stops matching, every dialog that delegates to `AppDialog` silently leaves the rule's
    // sight at once - the covers list would shrink and the suite would still be green.
    const shell = fullViewportCovers().find((entry) => entry.file.endsWith('AppDialog.vue'));
    expect(shell, 'AppDialog no longer paints a full-viewport cover').toBeDefined();
    expect(shell!.wired, 'AppDialog paints a cover without holding the page inert').toBe(true);
  });

  /**
   * The one shape the CSS rule cannot see, so it is pinned by name instead. A new library modal
   * fails this and has to be looked at: today the answer is that PrimeVue's own focus trap covers
   * it, and that answer should be re-checked rather than assumed for whatever arrives next.
   */
  it('accounts for the modals whose mask is painted from outside the component', () => {
    const libraryModals = vueFiles(SRC)
      .filter((file) => usesALibraryModal(readFileSync(file, 'utf-8')))
      .map((file) => relative(SRC, file))
      .sort();

    expect(libraryModals).toEqual([
      'components/floorplan/TableTypePanel.vue',
      'components/floorplan/TemplatePanel.vue',
    ]);
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
