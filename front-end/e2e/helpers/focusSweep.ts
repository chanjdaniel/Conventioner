import { expect, type Page } from '@playwright/test';

/**
 * The focus sweep's machinery: the page's half that judges the focused element, the Tab walk, the
 * menu walk and the dialog windows. `focus-sweep.spec.ts` runs it over every state the sweeps
 * walk; `focus-sweep-detectors.spec.ts` shows it fixtures of the defects it is meant to catch.
 */

/** The halos' outer colours, as the browser computes `--focus-halo` and `--focus-halo-on-dark`. */
const HALO = 'rgba(54, 130, 111, 0.35)';
const HALO_ON_DARK = 'rgba(255, 255, 255, 0.35)';

/** How much wider than its words a text control's box may be: room for a marker before them. */
const WORDS_SLACK = 24;

/** The most Tab presses one state takes before its walk is cut short. */
const MOST_PRESSES = 150;

interface Walk {
  failures: string[];
  checked: number;
  /** How many keyboard stops the state draws, so a state with none is not read as a blank one. */
  stops: number;
}

/** The page's half of the sweep, installed on `window` by `installTheSweep`. */
export interface SweepInPage {
  /** How a box looks: its outline, shadow, border colours and fill. */
  focusSweepLook: (el: Element) => string;
  /** What cuts off the halo `wearer` draws outside its edge, or null when it is drawn whole. */
  focusSweepClipper: (wearer: Element) => string | null;
  /** Judges the focused element: what is wrong with how it shows focus, or null for nothing. */
  focusSweepJudge: (looks: Looks) => Verdict | null;
  /** How a failure names an element: its tag, its test id and its classes. */
  focusSweepName: (el: Element) => string;
}

/** What the sweep looks for, as the page computes it. */
interface Looks {
  halo: string;
  haloOnDark: string;
  wordsSlack: number;
}

export const LOOKS: Looks = { halo: HALO, haloOnDark: HALO_ON_DARK, wordsSlack: WORDS_SLACK };

/** One focused element's verdict: its walk id, its name, and its problems (null: not judged). */
interface Verdict {
  id: string;
  name: string;
  problems: string[] | null;
}

/**
 * Installs the page's half of the sweep: how a box looks, what clips a control's halo, and the
 * verdict on the focused element.
 */
export async function installTheSweep(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sweep = window as unknown as SweepInPage;
    sweep.focusSweepClipper = (wearer) => {
      // How far the halo reaches outside the edge: the widest of its rings not drawn inset.
      const reach = Math.max(
        0,
        ...getComputedStyle(wearer)
          .boxShadow.split(/,(?![^(]*\))/)
          .filter((ring) => !ring.includes('inset'))
          .map((ring) => Number(ring.match(/0px 0px 0px ([\d.]+)px/)?.[1] ?? 0)),
      );
      if (reach === 0) return null;
      const halo = wearer.getBoundingClientRect();
      // A box that is the containing block of what is placed fixed inside it, and so of what is
      // placed absolutely too: one transformed or filtered, or about to be (`will-change`), one
      // whose layout or paint is contained, or a size container for queries.
      const holdsWhatIsPlaced = (b: CSSStyleDeclaration) =>
        [b.transform, b.translate, b.rotate, b.scale, b.perspective].some((v) => v !== 'none') ||
        b.filter !== 'none' ||
        b.backdropFilter !== 'none' ||
        /transform|translate|rotate|scale|perspective|filter/.test(b.willChange) ||
        /layout|paint|strict|content/.test(b.contain) ||
        /size/.test(b.containerType);
      // Up the chain of containing blocks: a box only clips what is placed inside it.
      let child: Element = wearer;
      for (let box = wearer.parentElement; box && box !== document.body; box = box.parentElement) {
        const placed = getComputedStyle(child).position;
        const b = getComputedStyle(box);
        if (placed === 'fixed' && !holdsWhatIsPlaced(b)) continue;
        if (placed === 'absolute' && b.position === 'static' && !holdsWhatIsPlaced(b)) continue;
        child = box;
        if (b.overflowX === 'visible' && b.overflowY === 'visible') continue;
        // What `overflow` clips to: the box inside its border.
        const edge = box.getBoundingClientRect();
        const cut = [
          halo.left - reach < edge.left + parseFloat(b.borderLeftWidth) - 0.5,
          halo.right + reach > edge.right - parseFloat(b.borderRightWidth) + 0.5,
          halo.top - reach < edge.top + parseFloat(b.borderTopWidth) - 0.5,
          halo.bottom + reach > edge.bottom - parseFloat(b.borderBottomWidth) + 0.5,
        ];
        if (cut.some(Boolean)) {
          const name = box.tagName.toLowerCase() + (box.className ? `.${box.className}` : '');
          const sides = ['left', 'right', 'top', 'bottom'].filter((_, i) => cut[i]).join(' ');
          return `${name} (overflow ${b.overflowX} ${b.overflowY}), at its ${sides}`;
        }
      }
      return null;
    };
    sweep.focusSweepJudge = ({ halo, haloOnDark, wordsSlack }) => {
      const { focusSweepLook: look, focusSweepClipper: clipper } = sweep;
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Every transition run to its end, so what is read is the focused look, not a frame of it.
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
      }
      el.dataset.focusWalkId ??= String(Math.random());
      const id = el.dataset.focusWalkId;
      const name = sweep.focusSweepName(el);
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return { id, name, problems: null };

      const problems: string[] = [];
      // A file input is no field: nothing is typed into it, and it is drawn invisible inside the
      // drop zone that stands for it (`FileDropZone.vue`), so it is a control whose zone wears
      // its halo (T205).
      const isField =
        el.matches('textarea, select') ||
        (el.matches('input') &&
          !el.matches('[type=button], [type=submit], [type=reset], [type=image], [type=file]'));
      if (isField) {
        let node: Element | null = el;
        for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
          const atRest = (node as HTMLElement).dataset.lookAtRest;
          const now = look(node);
          // A field drawn after the snapshot has nothing to compare, but draws no outline either.
          if (atRest === undefined) {
            if (depth === 0 && !now.startsWith('none |')) problems.push(`a field drew ${now}`);
            continue;
          }
          if (now !== atRest) {
            const which = depth === 0 ? 'the field' : `the box ${depth} up`;
            problems.push(`${which} changed on focus: ${atRest} -> ${now}`);
          }
        }
        return { id, name, problems };
      }

      const s = getComputedStyle(el);
      if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') {
        problems.push(`a control drew an outline: ${s.outlineStyle} ${s.outlineWidth}`);
      }
      // The ground the halo is drawn on: the first ancestor with a fill.
      let ground: number[] = [255, 255, 255];
      for (let node = el.parentElement; node; node = node.parentElement) {
        const fill = getComputedStyle(node)
          .backgroundColor.match(/[\d.]+/g)
          ?.map(Number);
        if (fill && (fill[3] ?? 1) > 0.5) {
          ground = fill;
          break;
        }
      }
      const dark = 0.2126 * ground[0] + 0.7152 * ground[1] + 0.0722 * ground[2] < 96;
      const wanted = dark ? haloOnDark : halo;
      // A control with no shadow of its own may have a box up to four levels around it wear
      // the halo, as a market card does for its name.
      const wears = (node: Element) => getComputedStyle(node).boxShadow.includes(wanted);
      let worn = wears(el);
      for (
        let node = el.parentElement, up = 1;
        !worn && s.boxShadow === 'none' && node && up <= 4;
        node = node.parentElement, up++
      ) {
        worn = wears(node);
      }
      if (!worn) {
        const which = dark ? 'halo for a dark ground' : 'halo';
        problems.push(`a control drew no ${which}: box-shadow ${s.boxShadow}`);
        return { id, name, problems };
      }

      // The halo hugs what it marks: rounded, and around a text control's words rather than
      // the row it sits in.
      let wearer: Element = el;
      while (!wears(wearer) && wearer.parentElement) wearer = wearer.parentElement;
      const w = getComputedStyle(wearer);
      const corners = [
        w.borderTopLeftRadius,
        w.borderTopRightRadius,
        w.borderBottomRightRadius,
        w.borderBottomLeftRadius,
      ];
      if (corners.some((corner) => parseFloat(corner) === 0)) {
        problems.push(`a halo with square corners: border-radius ${corners.join(' ')}`);
      }
      const clippedBy = clipper(wearer);
      if (clippedBy) problems.push(`a halo cut off by ${clippedBy}`);
      const unfilled = (w.backgroundColor.match(/[\d.]+/g)?.map(Number)[3] ?? 1) === 0;
      const unbordered = ['top', 'right', 'bottom', 'left'].every(
        (side) => parseFloat(w.getPropertyValue(`border-${side}-width`)) === 0,
      );
      // A box held at a tap target's least width is that wide for the thumb, not the row.
      const atLeast = parseFloat(w.minWidth) || 0;
      if (wearer === el && unfilled && unbordered && box.width > atLeast + 0.5) {
        const words = document.createRange();
        words.selectNodeContents(el);
        const room =
          box.width -
          parseFloat(w.paddingLeft) -
          parseFloat(w.paddingRight) -
          words.getBoundingClientRect().width;
        // A marker drawn before the words, as a disclosure's is, takes about 16px.
        if (room > wordsSlack) {
          problems.push(`a text control's halo runs ${Math.round(room)}px past its words`);
        }
      }
      return { id, name, problems };
    };
    sweep.focusSweepName = (el) =>
      el.tagName.toLowerCase() +
      (el instanceof HTMLElement && el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : '') +
      (typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).join('.')}`
        : '');
    sweep.focusSweepLook = (el) => {
      const s = getComputedStyle(el);
      return [
        s.outlineStyle === 'none'
          ? 'none'
          : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        s.boxShadow,
        s.borderTopColor,
        s.borderRightColor,
        s.borderBottomColor,
        s.borderLeftColor,
        s.backgroundColor,
      ].join(' | ');
    };
  });
}

/**
 * Marks every field and the two boxes around it with how they look with nothing focused, and
 * says how many keyboard stops the state draws.
 */
export async function rememberFieldsAtRest(page: Page): Promise<number> {
  await installTheSweep(page);
  return page.evaluate(() => {
    const sweep = window as unknown as SweepInPage;
    (document.activeElement as HTMLElement | null)?.blur();
    for (const field of document.querySelectorAll('input, textarea, select')) {
      let el: Element | null = field;
      for (let depth = 0; el && depth < 3; depth++, el = el.parentElement) {
        (el as HTMLElement).dataset.lookAtRest = sweep.focusSweepLook(el);
      }
    }
    const stops =
      'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>(stops)).filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && !el.closest('[inert]') && !el.matches(':disabled');
    }).length;
  });
}

/** Presses Tab through the state and judges each element it lands on. */
export async function walkByTab(page: Page, state: string): Promise<Omit<Walk, 'stops'>> {
  const failures: string[] = [];
  let checked = 0;
  const seen = new Set<string>();
  for (let press = 0; press < MOST_PRESSES; press++) {
    await page.keyboard.press('Tab');
    const verdict = await page.evaluate(
      (looks) => (window as unknown as SweepInPage).focusSweepJudge(looks),
      LOOKS,
    );
    if (!verdict) continue;
    if (seen.has(verdict.id)) break;
    seen.add(verdict.id);
    if (!verdict.problems) continue;
    checked++;
    for (const problem of verdict.problems) failures.push(`${state}: ${verdict.name}: ${problem}`);
  }
  return { failures, checked };
}

/**
 * Opens each menu the state shows with Enter on its button, walks its items with ArrowDown, and
 * judges each. A menu's items are no Tab stop, so the Tab walk never reaches them, and a menu's
 * box clips what is drawn past its edge, which hid the phase rail's and the Payment tab's halos.
 */
export async function walkTheMenus(page: Page, state: string): Promise<string[]> {
  const failures: string[] = [];
  const buttons = page.locator("[aria-haspopup='menu']:visible:not(:disabled)");
  const count = await buttons.count();
  for (let b = 0; b < count; b++) {
    const button = buttons.nth(b);
    // A menu behind an open dialog is out of reach, as the page behind it is.
    if (await button.evaluate((el) => !!el.closest('[inert]'))) continue;
    if ((await button.getAttribute('aria-expanded')) === 'true') await button.click();
    // Focus after a Tab is `:focus-visible`, so Enter opens the menu as the keyboard would.
    await button.focus();
    await page.keyboard.press('Enter');
    const menuId = await button.getAttribute('aria-controls');
    const opener = await button.evaluate((el) =>
      (window as unknown as SweepInPage).focusSweepName(el),
    );
    const menu = page.locator(`[id='${menuId}']`);
    await expect(menu, `${state}: a menu did not open from the keyboard`).toBeVisible();
    const items = await menu.locator("[role='menuitem']").count();
    for (let i = 0; i < items; i++) {
      // Each key lands focus on an item of the menu it opened, so a menu that keeps focus on its
      // button cannot pass with the button judged in its items' place.
      const focus = await menu.evaluate((list) => {
        const el = document.activeElement;
        return {
          onAnItem: !!el && list.contains(el) && el.matches("[role='menuitem']"),
          name: el ? (window as unknown as SweepInPage).focusSweepName(el) : 'nothing',
        };
      });
      if (!focus.onAnItem) {
        failures.push(
          `${state}: the menu ${menuId}, opened by ${opener}, left item ${i + 1} unfocused: ` +
            `focus is on ${focus.name}`,
        );
        await page.keyboard.press('ArrowDown');
        continue;
      }
      const verdict = await page.evaluate(
        (looks) => (window as unknown as SweepInPage).focusSweepJudge(looks),
        LOOKS,
      );
      if (!verdict?.problems) {
        failures.push(`${state}: a menu's ${focus.name} drew no box to judge`);
      } else {
        for (const problem of verdict.problems) {
          failures.push(`${state}: a menu's ${verdict.name}: ${problem}`);
        }
      }
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  return failures;
}

/**
 * Focuses each dialog window the state shows, as AppDialog does when it opens with no control
 * ready, and says which drew an outline. Focus moved by a script after a Tab is `:focus-visible`,
 * so the window is focused as a keyboard user's would be.
 */
export async function windowsFocused(page: Page, state: string): Promise<string[]> {
  return page.evaluate((state) => {
    const failures: string[] = [];
    const windows = [...document.querySelectorAll<HTMLElement>("[role='dialog'][tabindex='-1']")];
    const onTop = windows.some((win) => !win.closest('[inert]'));
    for (const win of windows) {
      // A window behind another dialog is inert and takes no focus, as Manage organization's
      // behind Delete organization. With no window on top, an inert one is a dialog that inerted
      // itself, and is checked: it fails, as it should.
      if (onTop && win.closest('[inert]')) continue;
      win.focus();
      if (!win.matches(':focus-visible')) {
        failures.push(`${state}: a dialog window was focused, but not as a keyboard user's`);
        continue;
      }
      const s = getComputedStyle(win);
      if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') {
        failures.push(
          `${state}: a dialog window drew an outline: ${s.outlineStyle} ${s.outlineWidth}`,
        );
      }
    }
    return failures;
  }, state);
}
