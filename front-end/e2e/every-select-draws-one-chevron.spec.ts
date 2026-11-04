import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { eachWindow, openEntry } from './helpers/componentLibrary';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import { savePlan } from './helpers/savePlan';
import { seedApprovedVendor } from './helpers/seedApplication';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
  PLAN_DATES,
  PLAN_SECTIONS,
} from './helpers/seedApplicantMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationFormPage } from './pages/ApplicationFormPage';
import { ApplyPage } from './pages/ApplyPage';
import { FloorplanWorkflowPage } from './pages/FloorplanWorkflowPage';
import { UpdateInfoDialog } from './pages/UpdateInfoDialog';

/**
 * Every select draws the app's own chevron (F06 of the 2026-11-02 walk): `.field--select`, read off
 * the component library's primitives entry, whose panels hold each state of it. No sign-in, no
 * seed. A browser lays out what a stylesheet test cannot, so this measures what comes to the page:
 * the computed look, and that the files named really load. Then the screens whose selects had a
 * look of their own until they moved onto it, and what each kept: `everySelectWearsThePrimitive`
 * holds the class from the source, and this holds what a browser makes of the likeliest to drift.
 */

const STATES = [
  { panel: 'Select: empty', file: '/icons/select-chevron.svg', disabled: false },
  { panel: 'Select: filled', file: '/icons/select-chevron.svg', disabled: false },
  { panel: 'Select: disabled', file: '/icons/select-chevron-disabled.svg', disabled: true },
  {
    panel: 'Select: with error, as Pricing marks it',
    file: '/icons/select-chevron.svg',
    disabled: false,
  },
  {
    panel: 'Select: a long option, cut before the chevron',
    file: '/icons/select-chevron.svg',
    disabled: false,
  },
] as const;

const selectIn = (page: Page, panel: string): Locator =>
  page.getByRole('region', { name: panel, exact: true }).locator('select');

const lookOf = (select: Locator) =>
  select.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      appearance: style.appearance,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      textOverflow: style.textOverflow,
      opacity: style.opacity,
    };
  });

/** The image a computed `background-image` names, by its path, so an origin does not matter. */
const pathOf = (backgroundImage: string): string =>
  new URL(/^url\("(.+)"\)$/.exec(backgroundImage)?.[1] ?? 'about:blank').pathname;

eachWindow('a select draws the chevron', () => {
  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'primitives');
  });

  for (const { panel, file, disabled } of STATES) {
    test(`${panel}: the chevron and its room`, async ({ page }) => {
      const look = await lookOf(selectIn(page, panel));
      expect(look.appearance).toBe('none');
      expect(look.paddingLeft).toBe('12px');
      expect(look.paddingRight).toBe('36px');
      expect(pathOf(look.backgroundImage)).toBe(file);
      expect(look.backgroundPosition).toBe('calc(100% - 12px) 50%');
      expect(look.textOverflow).toBe('ellipsis');
      if (disabled) expect(look.opacity).toBe('1');
    });
  }

  test('both files load from the app itself', async ({ page }) => {
    for (const file of new Set(STATES.map((state) => state.file))) {
      const naturalWidth = await page.evaluate(
        (src) =>
          new Promise<number>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth);
            image.onerror = () => resolve(0);
            image.src = src;
          }),
        file,
      );
      expect(naturalWidth, file).toBeGreaterThan(0);
    }
  });
});

test.describe('a select in forced colours', () => {
  test.use({ forcedColors: 'active' });

  test("keeps the browser's own arrow, which the forced palette can see", async ({ page }) => {
    await openEntry(page, 'primitives');
    for (const { panel } of STATES) {
      const look = await lookOf(selectIn(page, panel));
      expect(look.appearance, panel).toBe('auto');
      expect(look.backgroundImage, panel).toBe('none');
      expect(look.paddingRight, panel).toBe('12px');
    }
  });
});

const CHEVRON = '/icons/select-chevron.svg';
const CHEVRON_DISABLED = '/icons/select-chevron-disabled.svg';

/** The primitive's look on a select out on a screen, for a scoped rule that out-ranked it. */
async function expectTheChevron(select: Locator, file = CHEVRON): Promise<void> {
  await expect(select).toBeVisible({ timeout: 15000 });
  const look = await lookOf(select);
  expect(look.appearance).toBe('none');
  expect(look.paddingLeft).toBe('12px');
  expect(look.paddingRight).toBe('36px');
  expect(pathOf(look.backgroundImage)).toBe(file);
}

const WINDOWS = [
  { name: 'at 1280', desk: true, use: { viewport: { width: 1280, height: 800 } } },
  { name: 'at 390', desk: false, use: PHONE_AND_DESK[0].use },
] as const;

/** A Section Setup row, its location's name as long as an organizer's own is likely to be. */
const LOCATION = 'Example Hall East';
const TIER = 'Gold';
const PLAN_WITH_A_SECTION = {
  priority: [],
  marketDates: [{ date: PLAN_DATES[0] }],
  tiers: [{ id: 0, name: TIER }],
  locations: [{ name: LOCATION }],
  sections: [
    { name: 'Section A', location: { name: LOCATION }, tier: { id: 0, name: TIER }, count: 31 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
};

/** A question the form asks with a select, and the vendor whose answer to it the prices read. */
const SELECT_KEY = 'selling';
const SELECT_FIELD = {
  key: SELECT_KEY,
  label: 'What will you sell?',
  type: 'select',
  required: true,
  options: ['Prints', 'Ceramics'],
  order: 0,
};
const VENDOR = 'e2e-select-vendor@example.com';
const CODE = '246810';
const EDITOR = { email: 'e2e-select-editor@example.com', password: 'e2epassword123' };

/** Sign a new vendor in on the market's page, as the vendor would, and land on the form. */
async function applyAsAVendor(page: Page, marketId: string, marketSlug: string) {
  const login = new ApplicantLoginPage(page);
  await page.goto(`/${marketSlug}/applicant-login?redirect=apply`);
  await login.requestCode(VENDOR);
  await expect(login.codeInput).toBeVisible();
  createApplicantLoginChallenge(marketId, VENDOR, CODE);
  await login.enterCode(CODE);
  const apply = new ApplyPage(page);
  await expect(apply.form).toBeVisible({ timeout: 30000 });
  return apply;
}

const seedTheFormsMarket = (request: APIRequestContext) =>
  seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    fields: [SELECT_FIELD],
  });

/** A market in Assignment whose prices read the select, so an Editor reads the answer locked. */
async function seedALockedAnswer(request: APIRequestContext): Promise<string> {
  const prices = [
    { tier: 'Gold', cents: 3000 },
    { tier: 'Silver', cents: 2000 },
  ];
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    {
      fields: [SELECT_FIELD],
      setupObject: {
        ...planSetupObject(),
        pricing: {
          currency: 'CAD',
          halfTablePercent: 50,
          groups: [
            {
              name: 'Printmakers',
              conditions: [{ key: SELECT_KEY, answers: ['Prints'] }],
              prices,
            },
          ],
          everyoneElse: prices,
        },
      },
    },
  );
  seedApprovedVendor(marketId, VENDOR, {
    dates: [PLAN_DATES[0]],
    tiers: ['Gold'],
    sections: [PLAN_SECTIONS[0]],
    fullName: 'Fixture Vendor',
    extra: { [SELECT_KEY]: 'Prints' },
  });
  const market = `${BACKEND_URL}/markets/${marketId}`;
  const moved = await request.post(`${market}/transition`, { data: { toPhase: 'assignment' } });
  expect(moved.ok(), await moved.text()).toBeTruthy();
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  const granted = await request.post(`${market}/roles`, {
    data: { user_email: EDITOR.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();
  return marketId;
}

for (const size of WINDOWS) {
  test.describe(`the selects that moved onto the primitive, ${size.name}`, () => {
    test.use(size.use);

    test("Section Setup's Location and Tier", async ({ authenticatedPage: page, request }) => {
      const { marketId } = await seedDraftMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
        { intakeMode: 'form' },
      );
      await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN_WITH_A_SECTION);
      await page.goto(marketSetupPath(marketId, 'setup'));

      const location = page.getByTestId('setup-section-location-select-0');
      const tier = page.getByTestId('setup-section-tier-select-0');
      await expectTheChevron(location);
      await expectTheChevron(tier);
      await expect(location.locator('option:checked')).toHaveText(LOCATION);
      await expect(tier.locator('option:checked')).toHaveText(TIER);

      // A pill is for chips: this is the control's own radius.
      const radius = (select: Locator) =>
        select.evaluate((element) => getComputedStyle(element).borderRadius);
      expect(await radius(location)).toBe(await radius(tier));
      expect(await radius(location)).not.toBe('999px');

      // The row's other fields sit on the same centre line.
      const middle = async (control: Locator) => {
        const box = (await control.boundingBox())!;
        return box.y + box.height / 2;
      };
      const line = await middle(location);
      for (const other of [
        tier,
        page.getByTestId('setup-section-name-input-0'),
        page.getByTestId('setup-section-count-input-0'),
      ]) {
        expect(Math.abs((await middle(other)) - line)).toBeLessThanOrEqual(1);
      }

      if (size.desk) {
        // The whole of each name, against the room the chevron leaves.
        for (const select of [location, tier]) {
          const fit = await select.evaluate((element: HTMLSelectElement) => {
            const style = getComputedStyle(element);
            const pen = document.createElement('canvas').getContext('2d')!;
            pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            return {
              text: pen.measureText(element.selectedOptions[0].text).width,
              room:
                element.getBoundingClientRect().width -
                2 -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight),
            };
          });
          expect(fit.text).toBeLessThanOrEqual(fit.room);
        }
      }
    });

    test("the apply page's select, and its error", async ({ page, request }) => {
      const market = await seedTheFormsMarket(request);
      const apply = await applyAsAVendor(page, market.marketId, market.marketSlug);

      const select = apply.input(SELECT_KEY);
      await expectTheChevron(select);

      await apply.submit();
      const error = page.getByTestId(`apply-error-${SELECT_KEY}`);
      await expect(error).toBeVisible();
      const [border, red] = await Promise.all([
        select.evaluate((element) => getComputedStyle(element).borderTopColor),
        error.evaluate((element) => getComputedStyle(element).color),
      ]);
      expect(border).toBe(red);
      await expectTheChevron(select);
    });

    test("an Editor's locked answer, in the one disabled state", async ({ browser, request }) => {
      const marketId = await seedALockedAnswer(request);
      await withUser(
        browser,
        EDITOR.email,
        EDITOR.password,
        async (page) => {
          const query = new URLSearchParams({ vendor: VENDOR, vendorTab: 'application' });
          await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
          const dialog = new UpdateInfoDialog(page);
          await dialog.open();

          const select = dialog.input(SELECT_KEY);
          await expect(select).toBeDisabled();
          await expect(select).toHaveValue('Prints');
          await expectTheChevron(select, CHEVRON_DISABLED);

          const look = await select.evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, opacity: style.opacity };
          });
          const beige = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.color = 'var(--mm-beige)';
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          });
          expect(look).toEqual({ background: beige, opacity: '1' });
        },
        size.use,
      );
    });
  });
}

const FLOORPLAN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'test-floorplan.png',
);

/** The form builder and the floorplan are desk pages: on a phone they lay out at the app's floor. */
test.describe('the editors, at a desk', () => {
  test.use(WINDOWS[0].use);

  test("the form builder's Type, on the column of its fields", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { fields: [SELECT_FIELD], draft: true },
    );
    await page.goto(marketSetupPath(marketId, 'form'));
    const form = new ApplicationFormPage(page);
    await form.openStep('questions');

    const type = form.typeSelect(0);
    await expectTheChevron(type);

    const textStart = (control: Locator) =>
      control.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.getBoundingClientRect().left +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.paddingLeft)
        );
      });
    const start = await textStart(type);
    for (const field of [form.labelInput(0), form.keyInput(0), form.helpTextInput(0)]) {
      expect(await textStart(field)).toBeCloseTo(start, 1);
      expect((await field.boundingBox())!.height).toBe(28);
    }
    expect((await type.boundingBox())!.height).toBe(28);

    // The preview's, muted, as tall as the preview's other fields.
    await form.openStep('preview');
    const preview = form.previewField(SELECT_KEY).locator('select');
    await expectTheChevron(preview, CHEVRON_DISABLED);
    expect((await preview.boundingBox())!.height).toBe(32);
  });

  test('its Unit and the fields around it are one kind of field', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const floorplan = new FloorplanWorkflowPage(page);
    await floorplan.goto(marketId);
    await floorplan.reachTableTypes(FLOORPLAN_PATH);
    await floorplan.tableTypeAddBtn.click();

    const fields = [
      floorplan.tableTypeNameInput,
      floorplan.tableTypeWidthInput,
      floorplan.tableTypeHeightInput,
    ];
    const unit = page.locator('#tt-unit');
    await expectTheChevron(unit);

    const drawn = (control: Locator) =>
      control.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          border: style.borderTopWidth,
          color: style.borderTopColor,
          radius: style.borderRadius,
          background: style.backgroundColor,
          height: element.getBoundingClientRect().height,
          paddingLeft: style.paddingLeft,
        };
      });
    const look = await drawn(unit);
    for (const field of fields) expect(await drawn(field)).toEqual(look);

    // A refused size marks the three fields red, and the Unit stays as it was.
    await floorplan.tableTypeNameInput.fill('Six-foot');
    await floorplan.tableTypeWidthInput.fill('-1');
    await floorplan.tableTypeHeightInput.fill('1');
    await floorplan.tableTypeSaveBtn.click();
    const error = page.locator('.tt-error');
    await expect(error).toHaveText('Width must be a positive number.');
    const red = await error.evaluate((element) => getComputedStyle(element).color);
    for (const field of fields) expect((await drawn(field)).color).toBe(red);
    expect((await drawn(unit)).color).toBe(look.color);
  });
});
