import type { Locator, Page } from '@playwright/test';
import { test, expect, LoginPage, TEST_USER } from './fixtures';
import { widths } from './helpers/phoneWindow';

/**
 * The sign-in page on the narrowest phone (T211, F01). An input in a flex row keeps its intrinsic
 * width unless it is told otherwise, about 207px, where a field's box holds 198px at 320. So the
 * password's Show button ran past the box and the card, and every other field ran into its box's
 * padding.
 *
 * A phone's own emulation, for the reason `helpers/phoneWindow.ts` gives; 320 is WCAG 1.4.10's
 * reflow width, and 390 is the phone the other phone specs use.
 */

/** A field's box less its border and padding, where its input and its Show button belong. */
const insideOf = (box: Locator) =>
  box.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const px = (value: string) => parseFloat(value) || 0;
    return {
      left: rect.left + px(style.borderLeftWidth) + px(style.paddingLeft),
      right: rect.right - px(style.borderRightWidth) - px(style.paddingRight),
    };
  });

/** Each field holds what is in it, and the card holds each field. */
async function expectEachFieldInItsBox(page: Page, fields: Locator[]) {
  const card = (await page.getByTestId('auth-card').boundingBox())!;
  for (const field of fields) {
    const name = await field.getAttribute('data-testid');
    await expect(field, `${name} is showing`).toBeVisible();
    const box = field.locator('..');
    const inside = await insideOf(box);
    for (const part of await box.locator(':scope > *').all()) {
      const what = `${await part.getAttribute('data-testid')} in its box`;
      const drawn = (await part.boundingBox())!;
      expect(drawn.x, `${what} starts inside it`).toBeGreaterThanOrEqual(inside.left);
      expect(drawn.x + drawn.width, `${what} ends inside it`).toBeLessThanOrEqual(inside.right);
    }
    const drawn = (await box.boundingBox())!;
    expect(drawn.x, `the box of ${name} starts inside the card`).toBeGreaterThanOrEqual(card.x);
    expect(drawn.x + drawn.width, `the box of ${name} ends inside the card`).toBeLessThanOrEqual(
      card.x + card.width,
    );
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
  const target = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-min')),
  );
  expect((await toggle.boundingBox())!.width, 'Show is a whole target').toBeGreaterThanOrEqual(
    target,
  );
  await password.fill('fixture-password');
  await expect(password).toHaveAttribute('type', 'password');
  await toggle.tap();
  await expect(toggle).toHaveText('Hide');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('fixture-password');
  await toggle.tap();
  await expect(toggle).toHaveText('Show');
  await expect(password).toHaveAttribute('type', 'password');
}

for (const width of [320, 390]) {
  test.describe(`the sign-in page on a phone ${width} wide`, () => {
    test.use({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    test('the three tabs keep to the column the fields stand in', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      const column = (await login.loginForm.boundingBox())!;
      for (const tab of [login.tabLogin, login.tabRegister, login.tabOtp]) {
        const name = await tab.textContent();
        const drawn = (await tab.boundingBox())!;
        expect(drawn.x, `${name} starts in the column`).toBeGreaterThanOrEqual(column.x);
        expect(drawn.x + drawn.width, `${name} ends in the column`).toBeLessThanOrEqual(
          column.x + column.width,
        );
      }
    });

    test('Sign in: the email and the password keep to their boxes, and Show works', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.goto();
      await expectEachFieldInItsBox(page, [login.emailInput, login.passwordInput]);
      await expectTheWindowsWidth(page, width);
      await expectShowWorks(page, login.togglePassword, login.passwordInput);
    });

    test('Register: the email and both passwords keep to their boxes, and Show works', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToRegister();
      await expectEachFieldInItsBox(page, [
        login.registerEmailInput,
        login.registerPasswordInput,
        login.registerPasswordConfirmInput,
      ]);
      await expectTheWindowsWidth(page, width);
      await expectShowWorks(page, login.registerTogglePassword, login.registerPasswordInput);
    });

    test('Sign-in code: the email and the code keep to their boxes', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToOtp();
      await expectEachFieldInItsBox(page, [login.otpEmailInput]);
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
      await expectEachFieldInItsBox(page, [login.otpEmailInput, login.otpCodeInput]);
      await expectTheWindowsWidth(page, width);
    });
  });
}
