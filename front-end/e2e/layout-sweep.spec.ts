import { test, expect } from './fixtures';
import {
  detectLayout,
  gates,
  minTargetAt,
  misplacedBars,
  PHONE_MAX_WIDTH,
  PINNED_MAX,
  pinnedBottom,
  SPACE_SCALE,
  TYPE_SCALE,
  type Finding,
  type Pinned,
} from './helpers/layoutDetectors';
import { openScreen, SCREENS, signIn, walkTheScreens, type Check } from './helpers/screens';
import type { TheScreensSeed } from './helpers/seedTheScreens';
import type { Page, TestInfo } from '@playwright/test';

/**
 * No screen's layout is broken, at any size it ships at (T79, from T67's trial).
 *
 * Every state in the shared inventory (`helpers/screens.ts`) is measured at each of its sizes by
 * the detectors in `helpers/layoutDetectors.ts`, and the test fails on any finding of a gating kind:
 * the page or an element past the window, a child outside its parent, text clipped, text or
 * controls overlapping, text squeezed into a column, type off the scale, and a tap target under
 * 44px on a phone (T82). Each failure names the state, the size, the element and the measurement.
 *
 * The noisier kinds (spacing off the scale, uneven gaps, near-miss edges, empty bands, truncated
 * names, nested scrollers, small targets on a desktop) are real drift mixed with what is by design,
 * so they are attached to each test as `layout report`, never failed on.
 *
 * Then, across screens: the market bar stands at the same x and width on every market screen of one
 * size, which is what no screen can see alone (bug 12: the frame at x 0 on the floorplan, x 16
 * elsewhere); and on a phone no market screen pins more than `PINNED_MAX` of the window's top
 * (T142: the door pinned 409px of 844, half the screen).
 */

/** Where each market screen put its market bar, by window width: screen -> [x, width]. */
const bars = new Map<number, Map<string, [number, number]>>();
/** On a phone, how much of the window's top each market screen pins: screen -> what. */
const pinned = new Map<string, Pinned>();
/** Every screen measured for a bar, by window width, the ones with none among them. */
const measured = new Map<number, Set<string>>();

/**
 * Records where the open screen put its bar, or that it has none, and on a phone what it pins, so
 * it is not opened again.
 */
async function measureBar(page: Page, state: string): Promise<void> {
  const width = page.viewportSize()!.width;
  if (!measured.has(width)) measured.set(width, new Set());
  measured.get(width)!.add(state);
  // The screen has come to rest (`openScreen`), so a bar it has is drawn.
  const bar = page.getByTestId('market-bar');
  if (!(await bar.count())) return;
  const box = await bar.first().boundingBox();
  if (!box) return;
  if (!bars.has(width)) bars.set(width, new Map());
  bars.get(width)!.set(state, [Math.round(box.x), Math.round(box.width)]);
  if (width <= PHONE_MAX_WIDTH) pinned.set(state, await page.evaluate(pinnedBottom));
}

/** Measures each organizer screen at each of its sizes no wider than `upTo` that the walk missed. */
async function measureTheRest(page: Page, seed: TheScreensSeed, upTo = Infinity): Promise<void> {
  // The walk measured each screen it passed; a screen it never reached (a failure moves the run to
  // a new worker, and these maps start empty there) is measured now.
  await signIn(page, 'organizer', seed);
  for (const s of SCREENS.filter((x) => x.who === 'organizer')) {
    for (const size of s.sizes.filter((x) => x.width <= upTo)) {
      if (measured.get(size.width)?.has(s.name)) continue;
      await page.setViewportSize(size);
      await openScreen(page, s, seed);
      await measureBar(page, s.name);
    }
  }
}

const line = (f: Finding) => `${f.kind} ${f.el}: ${f.detail} (box ${f.box.join(', ')})`;

/** At most this many lines of one state's failure: one overflow drags its whole subtree along. */
const MAX_LINES = 25;

async function expectLaidOut(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  const { width, height } = page.viewportSize()!;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  await measureBar(page, state);

  const failing = findings.filter((f) => gates(f, width));
  const reported = findings.filter((f) => !gates(f, width));
  if (reported.length) {
    await testInfo.attach(`layout report, ${width}x${height}`, {
      body: JSON.stringify(reported, null, 1),
      contentType: 'application/json',
    });
  }
  const lines = failing.map(line);
  expect
    .soft(
      lines.length > MAX_LINES
        ? [...lines.slice(0, MAX_LINES), `... and ${lines.length - MAX_LINES} more`]
        : lines,
      `${state} at ${width}x${height} has layout findings`,
    )
    .toEqual([]);
}

const layoutTest = test.extend<{ check: Check }>({
  check: async ({ page }, use, testInfo) => {
    await use((state) => expectLaidOut(page, state, testInfo));
  },
});

layoutTest.describe('No screen is laid out wrong', () => {
  const { seed } = walkTheScreens(layoutTest, { everySize: true });

  layoutTest('the market bar stands in one place on every market screen', async ({ page }) => {
    layoutTest.setTimeout(10 * 60_000);
    await measureTheRest(page, seed());

    // A check that measured no bars passes on nothing: a renamed test id would leave it green.
    const most = Math.max(0, ...[...bars.values()].map((screens) => screens.size));
    expect(
      most,
      'the market bar was measured on two market screens of one size',
    ).toBeGreaterThanOrEqual(2);

    for (const { width, usual, apart } of misplacedBars(bars)) {
      expect
        .soft(apart, `at ${width}px the market bar stands at ${usual} on the other market screens`)
        .toEqual([]);
    }
  });

  layoutTest(
    `on a phone no market screen pins more than ${PINNED_MAX}px of the window`,
    async ({ page }) => {
      layoutTest.setTimeout(10 * 60_000);
      await measureTheRest(page, seed());

      // The door, Tools and what opens over them: a check that measured none passes on nothing.
      expect(pinned.size, 'the pinned area was measured on a phone market screen').toBeGreaterThan(
        0,
      );
      const over = [...pinned]
        .filter(([, p]) => p.bottom > PINNED_MAX)
        .map(([state, p]) => `${state}: ${p.bottom}px, to the bottom of ${p.el}`);
      expect(over, `on a phone a market screen pins at most ${PINNED_MAX}px of the window`).toEqual(
        [],
      );
    },
  );
});
