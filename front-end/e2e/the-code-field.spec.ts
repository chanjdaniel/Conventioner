import type { Locator, Page } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER, LoginPage, VendorPage } from './fixtures';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';

/**
 * The sign-in code's field, one for both sign-ins (T191 F21).
 *
 * Its six digits sat 6px left of the box's centre: a browser adds letter-spacing after every
 * character, the last one too, so the centred run carried a trailing space. An indent of the same
 * width takes it back. The vendor page's code step and the organizer's "Sign-in code" step use the
 * one field, so both are measured, at a desk and on two phones.
 *
 * An input's text has no range to measure, so the digits' run is computed from the field's own
 * computed font, spacing, indent and alignment, with a canvas `measureText` for the glyphs.
 */
const WINDOWS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];
const TYPED = '418203';

/** Where the six digits are drawn across the field, and the box they are drawn in. */
function digitRun(field: Locator) {
  return field.evaluate((input: HTMLInputElement) => {
    const style = getComputedStyle(input);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = input.value;
    const spacing = parseFloat(style.letterSpacing) || 0;
    const indent = parseFloat(style.textIndent) || 0;
    const glyphs = context.measureText(text).width;
    // The line a browser lays out carries the spacing after the last digit too; what is seen ends
    // at the last digit.
    const line = glyphs + spacing * text.length;
    const seen = glyphs + spacing * (text.length - 1);

    const box = input.getBoundingClientRect();
    const contentLeft = box.left + input.clientLeft + parseFloat(style.paddingLeft);
    const contentWidth =
      input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    // The indent comes off the line's start, and a centred line is centred in what is left.
    const free = contentWidth - indent - line;
    const start = contentLeft + indent + (style.textAlign === 'center' ? free / 2 : 0);
    return {
      runCentre: start + seen / 2,
      boxCentre: box.left + box.width / 2,
      runStart: start,
      runEnd: start + seen,
      contentLeft,
      contentRight: contentLeft + contentWidth,
      tabular: style.fontVariantNumeric,
      spacingMatchesIndent: style.letterSpacing === style.textIndent,
    };
  });
}

async function expectInside(inner: Locator, outer: Locator, what: string) {
  const a = (await inner.boundingBox())!;
  const b = (await outer.boundingBox())!;
  expect(a.x, `${what} starts inside its card`).toBeGreaterThanOrEqual(b.x);
  expect(a.x + a.width, `${what} ends inside its card`).toBeLessThanOrEqual(b.x + b.width);
}

async function expectCentredDigits(page: Page, field: Locator) {
  await field.fill(TYPED);
  const run = await digitRun(field);
  expect(run.spacingMatchesIndent, 'letter-spacing and text-indent share one value').toBe(true);
  expect(run.tabular).toBe('tabular-nums');
  expect(run.runStart, 'the digits start inside the field').toBeGreaterThanOrEqual(run.contentLeft);
  expect(run.runEnd, 'the digits end inside the field').toBeLessThanOrEqual(run.contentRight);
  expect(Math.abs(run.runCentre - run.boxCentre), 'the digits are centred').toBeLessThanOrEqual(1);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, 'nothing runs past the window').toBeLessThanOrEqual(0);
}

/** Each line of a paragraph centred on it, within 1px. */
async function expectCentredLines(paragraph: Locator) {
  const offsets = await paragraph.evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const box = p.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    return [...range.getClientRects()].map((line) => line.left + line.width / 2 - centre);
  });
  expect(offsets.length).toBeGreaterThan(0);
  for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1);
}

for (const size of WINDOWS) {
  test.describe(`at ${size.width}px`, () => {
    test.use({ viewport: size });

    test("the vendor page's code field centres its digits inside the sign-in", async ({
      page,
      request,
    }) => {
      const market = await seedApplicantMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      );
      const vendorPage = new VendorPage(page);
      await vendorPage.goto(market.marketSlug);
      await vendorPage.requestCode(`code-field-${size.width}-${Date.now()}@example.com`);

      await expectInside(vendorPage.codeInput, page.getByTestId('vendor-sign-in'), 'the field');
      await expectCentredDigits(page, vendorPage.codeInput);
      await expectCentredLines(vendorPage.codeInstruction);
    });

    test("the organizer's code field is the vendor's, centred inside its card", async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.goto();
      // No email leaves the stack: the code step opens on the answer a sent code gets.
      await page.route('**/request-otp', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ msg: 'A sign-in code has been sent to your email.' }),
        }),
      );
      await login.switchToOtp();
      await login.otpEmailInput.fill(TEST_USER.email);
      await login.otpSubmitButton.click();
      await expect(login.otpCodeInput).toBeVisible();

      await expect(login.otpCodeInput).toHaveAttribute('placeholder', '000000');
      await expectInside(login.otpCodeInput, page.getByTestId('auth-card'), 'the field');
      await expectCentredDigits(page, login.otpCodeInput);
    });
  });
}

test('the empty field shows no placeholder once focused, so the caret is never drawn inside it', async ({
  page,
}) => {
  const login = new LoginPage(page);
  await login.goto();
  await page.route('**/request-otp', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ msg: 'A sign-in code has been sent to your email.' }),
    }),
  );
  await login.switchToOtp();
  await login.otpEmailInput.fill(TEST_USER.email);
  await login.otpSubmitButton.click();
  const placeholderColour = () =>
    login.otpCodeInput.evaluate((input) => getComputedStyle(input, '::placeholder').color);

  await login.otpCodeInput.blur();
  const unfocused = await placeholderColour();
  await login.otpCodeInput.focus();

  expect(unfocused).not.toBe('rgba(0, 0, 0, 0)');
  expect(await placeholderColour()).toBe('rgba(0, 0, 0, 0)');
});
