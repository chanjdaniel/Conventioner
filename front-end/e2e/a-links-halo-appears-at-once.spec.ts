import type { Locator, Page } from '@playwright/test';
import { test, expect, LoginPage, PasswordResetPage } from './fixtures';
import { EmailVerificationPage } from './pages/EmailVerificationPage';

/**
 * A link's focus halo appears at once, corners and all, as a button's does (T181, T140 review
 * note 2).
 *
 * The global `a` rule eased every property over 0.4s, so a link reached by Tab drew its halo as a
 * square box that rounded off and faded in, while a button's snapped. It eases `color` alone now.
 * The sign-in pages' links on a line of their own are the `.link-alone` primitive, a target
 * `--target-min` tall (44px on a phone), so each is reached here by Tab at a phone's width and a
 * desk's.
 */

/** Each page's link on a line of its own, opened and settled. */
const LINKS: { name: string; open: (page: Page) => Promise<Locator> }[] = [
  {
    name: "sign-in's Forgot password?",
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      return login.forgotPasswordLink;
    },
  },
  {
    name: "asking for a reset's Back to sign in",
    open: async (page) => {
      const reset = new PasswordResetPage(page);
      await reset.gotoRequest();
      return reset.requestBackLink;
    },
  },
  {
    name: "choosing a new password's Back to sign in",
    open: async (page) => {
      const reset = new PasswordResetPage(page);
      await reset.gotoReset('a-token-from-an-email');
      return reset.resetBackLink;
    },
  },
  {
    name: "the verification page's Back to sign in",
    open: async (page) => {
      // An unknown token, so the page settles on its error and the controls that answer it.
      const verification = new EmailVerificationPage(page);
      await verification.goto('a-token-from-an-email');
      await expect(verification.errorMessage).toBeVisible();
      return verification.backLink;
    },
  },
];

/** What a focused element draws, read in the frame after focus and again once settled. */
type Drawn = {
  testid: string | null;
  transitionProperty: string;
  running: string[];
  borderRadius: string;
  boxShadow: string;
  outline: string;
};

/** In the next frame: the focused element, what it draws, and the transitions running on it. */
function readFocused(page: Page): Promise<Drawn> {
  return page.evaluate(
    () =>
      new Promise<Drawn>((resolve) =>
        requestAnimationFrame(() => {
          const el = document.activeElement as HTMLElement;
          const style = getComputedStyle(el);
          resolve({
            testid: el.getAttribute('data-testid'),
            transitionProperty: style.transitionProperty,
            running: el
              .getAnimations()
              .map((a) => (a as CSSTransition).transitionProperty ?? a.constructor.name),
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            outline: `${style.outlineStyle} ${style.outlineWidth}`,
          });
        }),
      ),
  );
}

/** Presses Tab until `link` has focus, and returns what it drew in the first frame after. */
async function tabTo(page: Page, link: Locator): Promise<Drawn> {
  const testid = await link.getAttribute('data-testid');
  for (let presses = 0; presses < 30; presses++) {
    await page.keyboard.press('Tab');
    const drawn = await readFocused(page);
    if (drawn.testid === testid) return drawn;
  }
  throw new Error(`Tab never reached ${testid}`);
}

for (const size of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test.describe(`at ${size.width}px`, () => {
    test.use({ viewport: size });

    for (const { name, open } of LINKS) {
      test(`${name} wears its whole halo the frame it is focused`, async ({ page }) => {
        const link = await open(page);
        await expect(link).toBeVisible();

        const first = await tabTo(page, link);
        expect(first.transitionProperty, 'a link eases its colour alone').toBe('color');
        const easing = first.running.filter((property) =>
          /^(box-shadow|border-.*radius|outline)/.test(property),
        );
        expect(easing, 'nothing of the halo eases in').toEqual([]);

        // The halo the first frame drew is the one it settles on: the corners are already round.
        await expect.poll(async () => (await readFocused(page)).running).toEqual([]);
        const settled = await readFocused(page);
        expect(settled.testid).toBe(first.testid);
        expect(first.borderRadius).toBe(settled.borderRadius);
        expect(first.borderRadius).not.toBe('0px');
        expect(first.boxShadow).toBe(settled.boxShadow);
        expect(first.boxShadow).not.toBe('none');
        expect(first.outline).toBe(settled.outline);

        // A target on a line of its own: 24px at a desk, a thumb's 44px on a phone.
        const box = await link.boundingBox();
        expect(box, 'the link is drawn').not.toBeNull();
        expect(Math.round(box!.height)).toBeGreaterThanOrEqual(size.width <= 640 ? 44 : 24);
      });
    }
  });
}
