import type { Locator, Page } from '@playwright/test';
import { test, expect, LoginPage, TEST_USER } from './fixtures';
import { widths } from './helpers/phoneWindow';

/**
 * The sign-in page on the narrowest phone (T211). An input in a flex row keeps its intrinsic width
 * unless it is told otherwise, about 207px, where a field's box holds 198px at 320. So the
 * password's Show button ran past the box and the card, and every other field ran into its box's
 * padding.
 *
 * A phone's own emulation, for the reason `helpers/phoneWindow.ts` gives; 320 is WCAG 1.4.10's
 * reflow width, and 390 is the phone the other phone specs use. Each also runs at a desk, where
 * nothing may move.
 */

const phone = (width: number) => ({
  viewport: { width, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

const WINDOWS = [
  { name: 'on a phone 320 wide', width: 320, use: phone(320) },
  { name: 'on a phone 390 wide', width: 390, use: phone(390) },
  { name: 'at a desk', width: 1280, use: { viewport: { width: 1280, height: 800 } } },
];

type Span = { left: number; right: number };

const spanOf = async (locator: Locator): Promise<Span> => {
  const box = (await locator.boundingBox())!;
  return { left: box.x, right: box.x + box.width };
};

/** A field's box less its border and padding, where its input and its Show button belong. */
const insideOf = (box: Locator): Promise<Span> =>
  box.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const px = (value: string) => parseFloat(value) || 0;
    return {
      left: rect.left + px(style.borderLeftWidth) + px(style.paddingLeft),
      right: rect.right - px(style.borderRightWidth) - px(style.paddingRight),
    };
  });

function expectWithin(inner: Span, outer: Span, what: string) {
  expect(inner.left, `${what} starts inside`).toBeGreaterThanOrEqual(outer.left);
  expect(inner.right, `${what} ends inside`).toBeLessThanOrEqual(outer.right);
}

/** The tab shows this many fields, each holding what is in it, and the card holds each field. */
async function expectEachFieldInItsBox(page: Page, login: LoginPage, fields: number) {
  await expect(login.fieldBoxes).toHaveCount(fields);
  const card = await spanOf(page.getByTestId('auth-card'));
  for (const box of await login.fieldBoxes.all()) {
    const inside = await insideOf(box);
    for (const part of await box.locator(':scope > *').all()) {
      const name = await part.getAttribute('data-testid');
      expectWithin(await spanOf(part), inside, `${name} in its box`);
    }
    expectWithin(await spanOf(box), card, 'the box in the card');
  }
}

async function expectTheWindowsWidth(page: Page, width: number) {
  expect(await widths(page), 'the page keeps the window').toEqual({
    layout: width,
    sideways: 0,
    zoom: 1,
  });
}

/** The Show button is a whole target, and still shows and hides what was typed. */
async function expectShowWorks(page: Page, toggle: Locator, password: Locator) {
  const minimumWidth = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-min')),
  );
  expect((await toggle.boundingBox())!.width, 'Show is a whole target').toBeGreaterThanOrEqual(
    minimumWidth,
  );
  await password.fill('fixture-password');
  await expect(password).toHaveAttribute('type', 'password');
  await toggle.click();
  await expect(toggle).toHaveText('Hide');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('fixture-password');
  await toggle.click();
  await expect(toggle).toHaveText('Show');
  await expect(password).toHaveAttribute('type', 'password');
}

for (const { name, width, use } of WINDOWS) {
  test.describe(`the sign-in page ${name}`, () => {
    test.use(use);

    test('the three tabs keep to the column the fields stand in', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      const column = await spanOf(login.loginForm);
      for (const tab of [login.tabLogin, login.tabRegister, login.tabOtp]) {
        expectWithin(await spanOf(tab), column, `${await tab.textContent()} in the column`);
      }
    });

    test('Sign in: the email and the password keep to their boxes, and Show works', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.goto();
      await expectEachFieldInItsBox(page, login, 2);
      await expectTheWindowsWidth(page, width);
      await expectShowWorks(page, login.togglePassword, login.passwordInput);
    });

    test('Register: the email and both passwords keep to their boxes, and Show works', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToRegister();
      await expectEachFieldInItsBox(page, login, 3);
      await expectTheWindowsWidth(page, width);
      await expectShowWorks(page, login.registerTogglePassword, login.registerPasswordInput);
    });

    test('Sign-in code: the email and the code keep to their boxes', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToOtp();
      await expectEachFieldInItsBox(page, login, 1);
      await expectTheWindowsWidth(page, width);

      // No email leaves the stack: the code field only needs the server to have said yes.
      await page.route('**/request-otp', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ msg: 'A sign-in code has been sent to your email.' }),
        }),
      );
      await login.otpEmailInput.fill(TEST_USER.email);
      await login.otpSubmitButton.click();
      await expect(login.otpCodeInput).toBeVisible();
      // The code field is `CodeInput`, its own box: the email keeps to its box, and the code to the
      // card, as `the-code-field.spec.ts` also holds.
      await expectEachFieldInItsBox(page, login, 1);
      expectWithin(
        await spanOf(login.otpCodeInput),
        await spanOf(page.getByTestId('auth-card')),
        'the code field',
      );
      await expectTheWindowsWidth(page, width);
    });
  });
}
