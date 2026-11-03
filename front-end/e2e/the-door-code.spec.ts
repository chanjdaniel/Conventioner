import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, APP_API } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { LoginPage } from './pages/LoginPage';

/**
 * The door code on Attendance (ADR 0022): shown full screen on whatever stands at the entrance, or
 * printed as a one-page poster, and replaced on demand.
 *
 * An Editor, who may check vendors in, makes the code, reads it full screen with its QR code, makes
 * a new one behind a confirmation and sees it change; a Viewer is offered no Door code, and the
 * server refuses them the code itself.
 */
const VIEWER = { email: 'e2e-door-code-viewer@example.com', password: 'e2epassword123' };
const EDITOR = { email: 'e2e-door-code-editor@example.com', password: 'e2epassword123' };
const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3} [23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}$/;

const SIZES = [
  {
    name: 'on a phone',
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  { name: 'on a laptop', use: { viewport: { width: 1280, height: 800 } } },
] as const;

let marketId: string;
let marketSlug: string;
let marketName: string;

async function signIn(page: Page, person: { email: string; password: string }, width: number) {
  const login = new LoginPage(page);
  await login.login(person.email, person.password);
  await login.waitForDashboardRedirect();
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
}

/** The code on screen, without its space, as the address carries it. */
async function shownCode(door: AttendanceStatusPage): Promise<string> {
  await expect(door.doorCodeValue).toHaveText(CODE);
  return (await door.doorCodeValue.innerText()).replace(' ', '');
}

/** Nothing scrolls sideways, every control is a phone's 44px, and the QR code is a square in the
 *  window, as large as what is around it allows. */
async function expectItFits(page: Page, door: AttendanceStatusPage, phone: boolean) {
  const { innerWidth, innerHeight, scrollWidth } = await door.doorCode.evaluate((el) => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: el.scrollWidth,
  }));
  expect(scrollWidth, 'nothing scrolls sideways').toBeLessThanOrEqual(innerWidth);
  for (const control of [door.doorCodeClose, door.doorCodePrint, door.doorCodeNew]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(phone ? 44 : 36);
    expect(box.x + box.width).toBeLessThanOrEqual(innerWidth);
  }
  const qr = (await door.doorCodeQr.boundingBox())!;
  expect(qr.x).toBeGreaterThanOrEqual(0);
  expect(qr.x + qr.width).toBeLessThanOrEqual(innerWidth);
  expect(qr.y + qr.height).toBeLessThanOrEqual(innerHeight);
  // The drawn square is the smaller side of its box; on a phone that is near the window's width.
  expect(Math.min(qr.width, qr.height)).toBeGreaterThanOrEqual(phone ? 300 : 360);
  // The instruction is one line, as is the code, and with who made it all is in the window: at 390
  // the instruction's last word once fell to a line of its own.
  for (const [line, name] of [
    [page.getByText("Scan with your phone's camera to check in"), 'the instruction'],
    [door.doorCodeValue, 'the code'],
  ] as const) {
    const lines = await line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
    expect(lines, `${name} is one line`).toBe(1);
  }
  const made = (await page.getByTestId('door-code-made').boundingBox())!;
  expect(made.y + made.height, 'everything is in the window').toBeLessThanOrEqual(innerHeight);
}

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  ({ marketId, marketSlug } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));
  for (const [person, role] of [
    [VIEWER, 'viewer'],
    [EDITOR, 'editor'],
  ] as const) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  marketName = (await read.json()).market.name;
});

test('an Editor makes the door code, reads it full screen and makes a new one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, EDITOR, 1280);
  const door = new AttendanceStatusPage(page);
  await door.goto(marketId);
  await expect(door.rows.first()).toBeVisible({ timeout: 15000 });

  await door.doorCodeButton.click();
  await expect(door.doorCode).toBeVisible();
  await expect(door.doorCodeMarket).toHaveText(marketName);
  await expect(door.doorCodeClose).toBeFocused();
  // No code yet: the screen offers to make one, and nothing to print or replace.
  await expect(door.doorCodeQr).toHaveCount(0);
  await expect(door.doorCodePrint).toHaveCount(0);
  await door.doorCodeMake.click();

  const first = await shownCode(door);
  await expect(door.doorCodeQr).toHaveAttribute(
    'data-url',
    new RegExp(`^https?://[^/]+/${marketSlug}\\?door=${first}$`),
  );
  await expect(door.doorCode).toContainText("Scan with your phone's camera to check in");
  await expect(page.getByTestId('door-code-made')).toContainText('by you');
  // The page behind is out of play, the app's frame and the roster with it.
  expect(
    await page.getByTestId('attendance-search').evaluate((el) => el.closest('[inert]') !== null),
  ).toBe(true);

  // New code asks first, on Cancel; cancelling keeps the code.
  await door.doorCodeNew.click();
  await expect(door.newCodeConfirm).toContainText('Make a new door code?');
  await expect(door.newCodeConfirm).toContainText(
    'The current code and every printed poster of it stop working.',
  );
  await expect(door.newCodeCancel).toBeFocused();
  await door.newCodeCancel.click();
  await expect(door.newCodeConfirm).toBeHidden();
  expect(await shownCode(door)).toBe(first);

  await door.doorCodeNew.click();
  await door.newCodeConfirmButton.click();
  await expect(door.newCodeConfirm).toBeHidden();
  await expect(door.doorCodeValue).not.toHaveText(`${first.slice(0, 3)} ${first.slice(3)}`);
  const second = await shownCode(door);
  expect(second).not.toBe(first);
  await expect(door.doorCodeQr).toHaveAttribute(
    'data-url',
    new RegExp(`/${marketSlug}\\?door=${second}$`),
  );

  // Closed and opened again, it is the new code the server holds.
  await door.doorCodeClose.click();
  await expect(door.doorCode).toHaveCount(0);
  await expect(door.doorCodeButton).toBeFocused();
  await door.doorCodeButton.click();
  expect(await shownCode(door)).toBe(second);
  // Escape closes it too.
  await page.keyboard.press('Escape');
  await expect(door.doorCode).toHaveCount(0);
});

test('the poster prints on one page, with nothing of the app on it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, EDITOR, 1280);
  const made = await page.request.post(`${APP_API}/markets/${marketId}/door-code`);
  expect(made.ok(), await made.text()).toBeTruthy();
  const door = new AttendanceStatusPage(page);
  await door.goto(marketId);
  await door.doorCodeButton.click();
  const code = await shownCode(door);

  await page.emulateMedia({ media: 'print' });
  await expect(door.doorCodeQr).toBeVisible();
  await expect(door.doorCodeMarket).toBeVisible();
  await expect(door.doorCodeValue).toBeVisible();
  for (const hidden of [
    door.doorCodeClose,
    door.doorCodePrint,
    door.doorCodeNew,
    page.getByTestId('attendance-search'),
    page.getByTestId('phase-rail-current'),
  ]) {
    await expect(hidden).toBeHidden();
  }

  // The poster's own size, not the window's: a QR code 14cm across, at CSS's 96 px to the inch.
  const qr = (await door.doorCodeQr.boundingBox())!;
  expect(Math.round(qr.width)).toBe(529);
  expect(Math.round(qr.height)).toBe(529);

  for (const format of ['Letter', 'A4']) {
    const pdf = (await page.pdf({ format })).toString('latin1');
    expect(pdf.match(/\/Type\s*\/Page[^s]/g) ?? [], `one ${format} page`).toHaveLength(1);
  }
  await page.emulateMedia({ media: 'screen' });
  expect(await shownCode(door)).toBe(code);
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);
    const width = size.use.viewport.width;
    const phone = width < 640;

    test('the door code fits the window', async ({ page }) => {
      await signIn(page, EDITOR, width);
      const made = await page.request.post(`${APP_API}/markets/${marketId}/door-code`);
      expect(made.ok(), await made.text()).toBeTruthy();
      const door = new AttendanceStatusPage(page);
      await door.goto(marketId);
      await expect(door.doorCodeButton).toBeVisible({ timeout: 15000 });
      if (phone) {
        expect((await door.doorCodeButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await door.doorCodeButton.click();
      await shownCode(door);

      await expectItFits(page, door, phone);
    });

    test('a Viewer is offered no Door code, and is refused the code', async ({ page }) => {
      await signIn(page, VIEWER, width);
      const door = new AttendanceStatusPage(page);
      await door.goto(marketId);
      await expect(door.rows.first()).toBeVisible({ timeout: 15000 });

      await expect(door.doorCodeButton).toHaveCount(0);
      for (const ask of [page.request.get, page.request.post]) {
        const res = await ask.call(page.request, `${APP_API}/markets/${marketId}/door-code`);
        expect(res.status()).toBe(403);
        expect(await res.json()).not.toHaveProperty('code');
      }
    });
  });
}
