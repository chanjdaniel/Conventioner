import type {
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { expect, TEST_USER, NO_ORG_USER, BACKEND_URL, FloorplanWorkflowPage } from '../fixtures';
import { marketScreenPath, marketSetupPath, oneByOnePath } from './marketScreens';
import { createApplicantLoginChallenge } from './seedApplicantMarket';
import { loginViaApi } from './seeds';
import { seedTheScreens, type TheScreensSeed } from './seedTheScreens';
import { settle } from './settle';

/**
 * Every screen and deliberate state of the app, walked by every sweep: contrast
 * (`contrast-sweep.spec.ts`), what axe can see (`accessibility-sweep.spec.ts`), layout
 * (`layout-sweep.spec.ts`) and focus (`focus-sweep.spec.ts`). Each sweep passes its own `check` and
 * nothing else, so a state added here is walked by all four.
 *
 * **A sweep is only worth the states it walks.** A twenty-screen pass missed the invisible
 * archive-confirmation button, because nobody opened that dialog; a layout trial missed the
 * dashboard's squeezed dates until it opened a market before the dashboard (T67). So the list
 * names the router's routes, the dialogs, menus and drawers, hover states, the dashboard with a
 * market remembered, every phase, settled rules and the signed-out pages, over the stress seed's
 * markets (`seedTheScreens.ts`), and the list is part of the deliverable (`docs/design-system.md`,
 * "What keeps this true").
 */

export interface Size {
  width: number;
  height: number;
}

export const DESKTOP: Size = { width: 1920, height: 1080 };
export const LAPTOP: Size = { width: 1440, height: 900 };
export const PHONE: Size = { width: 390, height: 844 };

/** The sizes each kind of screen ships at: an organizer works at a desk; the rest may be a phone. */
const ORGANIZER = [DESKTOP, LAPTOP];
const PUBLIC = [DESKTOP, PHONE];
/**
 * A route with `meta.fitsAPhone`: an organizer's that works on a phone too, the door (E29/F01),
 * Tools, and `/markets` with its dialogs (T142).
 */
const FITS_A_PHONE = [DESKTOP, LAPTOP, PHONE];

/** Who is signed in to see a screen. */
export type Who = 'organizer' | 'no organization' | 'applicant' | 'nobody';

export interface Screen {
  name: string;
  who: Who;
  sizes: Size[];
  /** A state that cannot be walked narrower than a desk, so a sweep's `alsoAt` passes it by. */
  deskOnly?: true;
  /** Go there and open the state, returning once what it shows has drawn. */
  open: (page: Page, seed: TheScreensSeed) => Promise<void>;
}

const visible = async (page: Page, testId: string) =>
  expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 15000 });

/** Opens `path` and waits for `ready`, then clicks each of `then` in turn, waiting on the last. */
function at(path: (seed: TheScreensSeed) => string, ready: string, ...then: [string, string][]) {
  return async (page: Page, seed: TheScreensSeed) => {
    await page.goto(path(seed));
    await visible(page, ready);
    for (const [click, shows] of then) {
      await page.getByTestId(click).first().click();
      await visible(page, shows);
    }
  };
}

/** The dashboard, remembering the market this browser opened last (E21/F02/S05). */
function dashboardRemembering(market: keyof TheScreensSeed) {
  return async (page: Page, seed: TheScreensSeed) => {
    await page.goto('/dashboard');
    await page.evaluate(
      (id) => localStorage.setItem('lastMarketId', id),
      (seed[market] as { marketId: string }).marketId,
    );
    await page.reload();
    await visible(page, 'dashboard-last-market-card');
  };
}

const setup = (market: keyof TheScreensSeed, page: string) => (seed: TheScreensSeed) =>
  marketSetupPath((seed[market] as { marketId: string }).marketId, page);
/** The review's One by one view: the Applications tab opens on All (E38/F05/S01). */
const oneByOne = (market: keyof TheScreensSeed) => (seed: TheScreensSeed) =>
  oneByOnePath((seed[market] as { marketId: string }).marketId);
type MarketScreen = Parameters<typeof marketScreenPath>[1];
const screen = (market: keyof TheScreensSeed, page: MarketScreen) => (seed: TheScreensSeed) =>
  marketScreenPath((seed[market] as { marketId: string }).marketId, page);
/** A market's address off the bar: its landing, or a flow such as starting from a CSV. */
const marketAddress =
  (market: keyof TheScreensSeed, rest = '') =>
  (seed: TheScreensSeed) =>
    `/markets/${(seed[market] as { marketId: string }).marketId}${rest}`;
const slug =
  (market: keyof TheScreensSeed, rest = '') =>
  (seed: TheScreensSeed) =>
    `/${(seed[market] as { marketSlug: string }).marketSlug}${rest}`;
const fixed = (path: string) => () => path;

/**
 * Manage market on `market`'s own card, found by searching `/markets`: the first card is not
 * always the market whose people the sweep must draw.
 */
const managing = (market: keyof TheScreensSeed) => async (page: Page, seed: TheScreensSeed) => {
  const name = (seed[market] as { marketName: string }).marketName;
  await page.goto('/markets');
  await visible(page, 'markets-result-count');
  await page.getByTestId('markets-search-input').fill(name);
  await page
    .getByTestId('market-card')
    .filter({ hasText: name })
    .getByTestId('market-card-manage-button')
    .click();
  await visible(page, 'manage-market-window');
};

const FORM_STEPS = ['essentials', 'questions', 'preview', 'review'] as const;

/** The floor plan the floorplan specs upload: an 800x600 hall, fixture data. */
const FLOORPLAN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'test-floorplan.png',
);

/**
 * The draft's floorplan wizard with its plan uploaded, at one of its steps (E38/F01/S01). The
 * market-days market's wizard is settled and draws no field, so these walk the draft's; nothing is
 * saved, so the draft's plan is the seed's.
 */
function floorplanAt(stage: 'calibrating' | 'table types' | 'sections' | 'ready' | 'saving') {
  return async (page: Page, seed: TheScreensSeed) => {
    const wizard = new FloorplanWorkflowPage(page);
    await wizard.goto(seed.draft.marketId);
    if (stage === 'calibrating') {
      await wizard.waitForWizard();
      await wizard.uploadFloorplanImage(FLOORPLAN);
      await wizard.waitForUploadComplete();
      await wizard.clickNext();
      await wizard.calibrateStage.waitFor({ state: 'visible', timeout: 10000 });
      await wizard.drawCalibrationLine();
      await visible(page, 'scale-calibration-length-input');
      return;
    }
    if (stage === 'table types') {
      await wizard.reachTableTypes(FLOORPLAN);
      await wizard.tableTypeAddBtn.click();
      await expect(wizard.tableTypeNameInput).toBeVisible();
      return;
    }
    if (stage === 'sections') {
      await wizard.reachTableTypes(FLOORPLAN);
      await wizard.addTableType('6ft Table', '1800', '900');
      await wizard.setAutoPlaceCount(4);
      await wizard.autoPlaceTables();
      await wizard.waitForNextEnabled();
      await wizard.clickNext();
      await wizard.sectionGroupToggle.waitFor({ state: 'visible', timeout: 10000 });
      await wizard.groupAllTablesIntoSection('Main', 'Main Hall');
      await page.getByRole('button', { name: /^Sections/ }).click();
      await expect(page.getByRole('button', { name: /^Sections/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      return;
    }
    await wizard.reachSaveStep(FLOORPLAN);
    if (stage === 'saving') await wizard.openSaveDialog();
  };
}

export const SCREENS: Screen[] = [
  // The organizer's own pages.
  {
    name: 'the dashboard',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(fixed('/dashboard'), 'dashboard-has-markets'),
  },
  {
    name: 'the dashboard, remembering a long-named draft',
    who: 'organizer',
    sizes: ORGANIZER,
    open: dashboardRemembering('draft'),
  },
  {
    name: 'the dashboard, remembering a market in market days',
    who: 'organizer',
    sizes: ORGANIZER,
    open: dashboardRemembering('big'),
  },
  {
    // The count, not "New market": the button is drawn before the list arrives, and on a stack
    // holding thousands of markets the sweep measured "Loading markets..." and nothing else.
    name: 'the markets list',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(fixed('/markets'), 'markets-result-count'),
  },
  {
    name: 'the new-market dialog, where a disabled primary lives',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(fixed('/markets'), 'markets-result-count', [
      'markets-create-button',
      'new-market-name-input',
    ]),
  },
  {
    // With its Permissions section open, which is closed until asked for (E39/F01/S04).
    name: 'the manage-market dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/markets'),
      'markets-result-count',
      ['market-card-manage-button', 'manage-market-window'],
      ['manage-market-permissions-toggle', 'manage-market-permission-source'],
    ),
  },
  {
    // A second member whose address is long (T142): the row gives it its own line rather than
    // squeezing it into a column a few letters wide.
    name: 'the manage-market dialog, a member with a long address',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: managing('dealt'),
  },
  {
    // Its History section, loaded, with an entry opened to its before and after (E40/F01/S03).
    name: "the manage-market dialog's history, an entry open",
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/markets'),
      'markets-result-count',
      ['market-card-manage-button', 'manage-market-history-toggle'],
      ['manage-market-history-toggle', 'market-history-entry'],
      ['market-history-toggle', 'market-history-changes'],
    ),
  },
  {
    // The app's own menu, behind the banner's button on every organizer screen.
    name: 'the navigation drawer',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(fixed('/markets'), 'markets-result-count', ['app-menu-button', 'app-nav']),
  },
  {
    name: 'the organizations',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(fixed('/organizations'), 'organization-card'),
  },
  {
    // With its default permissions for new markets open, closed until asked for (E39/F02/S01).
    name: 'the manage-organization dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      fixed('/organizations'),
      'organization-card',
      ['organizations-manage-button', 'manage-org-window'],
      ['manage-org-permissions-toggle', 'manage-org-permission-source'],
    ),
  },
  {
    // Its History section, loaded, with an entry opened to its before and after (E40/F02/S01):
    // the seeded organization's market, created in it.
    name: "the manage-organization dialog's history, an entry open",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      fixed('/organizations'),
      'organization-card',
      ['organizations-manage-button', 'manage-org-history-toggle'],
      ['manage-org-history-toggle', 'org-history-entry'],
      ['org-history-toggle', 'org-history-changes'],
    ),
  },
  {
    name: 'the start page',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(fixed('/init'), 'init-setup-new-market-button'),
  },

  // A draft with a long name: its plan, its form being written, its applications not yet open.
  {
    name: 'a draft, its plan',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('draft', 'setup'), 'setup-dates-date-display-0'),
  },
  {
    // The densest authoring surface in the product, and unwalked until E17/F03/S01 - which is how
    // a field-type badge shipped at 3.73:1 on it.
    name: 'a draft, its form',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('draft', 'form'), 'form-steps'),
  },
  {
    name: 'a draft, its applications',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('draft', 'applications'), 'market-tab-note'),
  },
  {
    // Opening applications offers the reviewers in the same step (E38/F07/S02).
    name: 'opening applications, choosing reviewers',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('draft', 'setup'), 'setup-dates-date-display-0', [
      'phase-transition-applications',
      'open-applications-window',
    ]),
  },
  {
    name: 'a CSV draft, starting from a Google Form',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(marketAddress('csvDraft', '/start-from-csv'), 'start-from-csv'),
  },

  // Applications open, closed and in review, each with 40 applications in every review state.
  {
    name: 'applications open, one by one',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('open'), 'app-monitor-card'),
  },
  {
    // A status is a tinted chip, on the card's own beige ground as well as on white (bug 43).
    name: 'a review card, and the verdicts already given',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('open'), 'app-monitor-card', [
      'app-monitor-decided-toggle',
      'app-monitor-decided-row',
    ]),
  },
  {
    name: 'the follow-up dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('open'), 'app-monitor-card', [
      'app-monitor-follow-up-button',
      'follow-up-window',
    ]),
  },
  {
    name: 'applications open, all at once',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('open', 'applications'), 'applications-all-tick'),
  },
  {
    // Who reviews which application, chosen from the panel over the views (E38/F07/S02).
    name: 'the reviewers dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('open', 'applications'), 'applications-all-tick', [
      'reviewers-change',
      'reviewers-dialog-window',
    ]),
  },
  // The review divided between the organizer and another reviewer (E38/F07): the organizer lands
  // on their share, which is all decided, and helps with the other's.
  {
    name: 'the review divided, my share at once',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('dealt', 'applications'), 'applications-all-assigned-to'),
  },
  {
    name: "the review divided, another's application in the drawer",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      (seed) =>
        `${setup('dealt', 'applications')(seed)}?reviewer=anyone&vendor=applicant0@example.com`,
      'applications-all-drawer-dealt-warning',
    ),
  },
  {
    name: 'the review divided, my share done',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('dealt'), 'app-monitor-share-done'),
  },
  {
    name: "the review divided, helping with another's share",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('dealt'), 'app-monitor-share-done', [
      'app-monitor-help-others',
      'app-monitor-dealt-warning',
    ]),
  },
  {
    name: 'applications open, the plan settled',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('open', 'setup'), 'setup-dates-date-display-0'),
  },
  {
    name: 'applications open, the form locked',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('open', 'form'), 'form-steps'),
  },
  {
    name: 'not taking applications',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('closed'), 'app-monitor-card'),
  },
  {
    name: 'a Google Form market in review',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(oneByOne('review'), 'app-monitor-card'),
  },
  {
    name: 'a CSV market, redoing its import',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('csv', 'import'), 'import-view'),
  },

  // Assignment, its rules still open and nothing run.
  {
    name: 'in assignment, the rules open',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('assignment', 'settings'), 'assignment-card-priority'),
  },
  {
    name: 'in assignment, nothing placed yet',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('assignment', 'assignments'), 'market-bar-title'),
  },

  // Market days: 36 vendors placed over four dates and three sections.
  {
    name: "a market's own address",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(marketAddress('big'), 'market-bar-title'),
  },
  {
    name: 'the result',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'assignments'), 'tables-count-assigned'),
  },
  {
    // The ledger of bars (E35/F03/S01): a share in muted ink on white.
    name: 'the statistics',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await page.goto(`${marketScreenPath(seed.big.marketId, 'assignments')}?stats=open`);
      await visible(page, 'result-statistics-date');
    },
  },
  {
    // And on a hovered row's beige.
    name: 'a hovered statistics row',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await page.goto(`${marketScreenPath(seed.big.marketId, 'assignments')}?stats=open`);
      await visible(page, 'result-statistics-date');
      await page.getByTestId('result-statistics-date').first().hover();
    },
  },
  {
    name: 'the phase-rail menu',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned')(page, seed);
      await page.getByTestId('phase-rail-menu-button').click();
      await expect(page.locator('.rail-menu-item').first()).toBeVisible();
    },
  },
  {
    // The invisible archive-confirmation button lived here, behind two clicks, and a twenty-screen
    // walk never found it. Opened and never confirmed: archiving is permanent.
    name: 'the archive confirmation',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned')(page, seed);
      await page.getByTestId('phase-rail-menu-button').click();
      await page.locator('.rail-menu-item--end').click();
      await visible(page, 'archive-confirm-window');
      // And the button is actually there, which is the whole of E16/F01/S01.
      const fill = await page
        .getByTestId('archive-confirm-submit-button')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(fill, 'the archive button has no fill').not.toBe('rgba(0, 0, 0, 0)');
    },
  },
  {
    name: 'the change-placement dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'assignments'), 'tables-count-assigned', [
      'tables-seat-change',
      'placement-dialog-window',
    ]),
  },
  {
    // Its swap picker searched, the list open with a choice active on its beige (E38/F08/S03).
    name: 'the swap picker, searched',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned', [
        'tables-seat-change',
        'placement-dialog-window',
      ])(page, seed);
      const field = page.getByTestId('placement-dialog-swap-target-input');
      await field.fill('a');
      await field.press('ArrowDown');
      await visible(page, 'placement-dialog-swap-target-list');
    },
  },
  {
    // And the place picker's groups, open on a free seat.
    name: 'the place picker, open',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned', [
        'tables-seat-empty',
        'placement-dialog-window',
      ])(page, seed);
      await page.getByTestId('placement-dialog-vendor-input').click();
      await visible(page, 'placement-dialog-vendor-list');
    },
  },
  {
    name: 'the placement history',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'assignments'), 'tables-count-assigned', [
      'result-history-button',
      'placement-history-dialog-window',
    ]),
  },
  {
    name: 'the vendors',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'vendors'), 'vendors-list-item'),
  },
  {
    name: 'the vendor drawer',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'vendors'), 'vendors-list-item', [
      'vendors-list-item',
      'vendors-detail-email',
    ]),
  },
  {
    // Its History tab, the market's history narrowed to the vendor (E40/F01/S04).
    name: "the vendor drawer's history",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendor-drawer-tab-history', 'market-history'],
    ),
  },
  {
    // What the vendor owes and paid (E44/F01/S01).
    name: "the vendor drawer's Payment tab",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendor-drawer-tab-payment', 'payment-tab'],
    ),
  },
  {
    name: 'the record-payment dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendor-drawer-tab-payment', 'payment-record'],
      ['payment-record', 'record-payment-window'],
    ),
  },
  {
    // A table-day's "..." menu, and the dialog it opens (E44/F01/S02).
    name: "a Payment tab line's menu",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendor-drawer-tab-payment', 'payment-line-menu-button'],
      ['payment-line-menu-button', 'payment-line-menu'],
    ),
  },
  {
    name: 'the change-owed dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendor-drawer-tab-payment', 'payment-line-menu-button'],
      ['payment-line-menu-button', 'payment-line-menu'],
      ['payment-line-menu-owed', 'change-owed-window'],
    ),
  },
  {
    name: 'the add-vendor dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'vendors'), 'vendors-list-item', [
      'vendors-add-button',
      'add-vendor-name-input',
    ]),
  },
  {
    // The preview's rows, not the dialog: its fields and table arrive with the first preview.
    name: 'the export dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'vendors'), 'vendors-list-item', [
      'vendors-export-button',
      'vendor-export-preview-row',
    ]),
  },
  {
    name: 'the attendance',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'attendance'), 'attendance-row'),
  },
  {
    // Who applied, and a chart per choice question, as ledgers of bars (E45/F01/S01, S02). The
    // two load apart, so it waits for both.
    name: 'the stats',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await at(screen('big', 'stats'), 'stats-status')(page, seed);
      await visible(page, 'stats-answer');
    },
  },
  {
    // The manual tools, Discord's card first (E46/F01/S02); it fits a phone, as the door does.
    name: 'the tools',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'tools'), 'plan-card-discord'),
  },
  // What else the organizer reaches at the door, on the phone in their hand (T82).
  {
    name: 'the navigation drawer, at the door',
    who: 'organizer',
    sizes: [PHONE],
    open: at(screen('big', 'attendance'), 'attendance-row', ['app-menu-button', 'app-nav']),
  },
  {
    name: 'the vendor drawer, at the door',
    who: 'organizer',
    sizes: [PHONE],
    open: at(screen('big', 'attendance'), 'attendance-row', [
      'attendance-vendor',
      'vendors-detail-email',
    ]),
  },
  {
    name: 'the archive confirmation, at the door',
    who: 'organizer',
    sizes: [PHONE],
    open: async (page, seed) => {
      await at(screen('big', 'attendance'), 'attendance-row')(page, seed);
      await page.getByTestId('phase-rail-menu-button').click();
      await page.locator('.rail-menu-item--end').click();
      await visible(page, 'archive-confirm-window');
    },
  },
  {
    name: 'the phase-rail menu, at the door',
    who: 'organizer',
    sizes: [PHONE],
    open: async (page, seed) => {
      await at(screen('big', 'attendance'), 'attendance-row')(page, seed);
      await page.getByTestId('phase-rail-menu-button').click();
      await expect(page.locator('.rail-menu-item').first()).toBeVisible();
    },
  },
  // The rail on a phone in every phase the seed holds, on both intake paths (T142): market days is
  // the attendance above. Each phase draws its own chips and actions, and a squeezed address chip, an
  // overlapping More… (T139) or an action past the window (T104) showed in one phase only.
  ...(
    [
      ['in draft', 'draft'],
      ['taking applications on its own page', 'open'],
      ['in review, from a Google Form', 'review'],
      ['in assignment', 'assignment'],
      ['archived', 'archived'],
    ] as const
  ).map(([phase, market]): Screen => ({
    name: `the rail at the door, ${phase}`,
    who: 'organizer',
    sizes: [PHONE],
    // Before publishing the door is a note, so the rail is what the state waits on.
    open: at(screen(market, 'attendance'), 'phase-rail-current'),
  })),
  {
    name: 'the floorplan',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('big', 'floorplan'), 'market-bar-title'),
  },
  // The floorplan beta's wizard is laid out for a desk: at a phone's width its calibration field
  // is off the screen, so its steps cannot be walked there.
  {
    name: 'the floorplan, calibrating',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: floorplanAt('calibrating'),
  },
  {
    name: 'the floorplan, adding a table type',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: floorplanAt('table types'),
  },
  {
    name: 'the floorplan, its sections listed',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: floorplanAt('sections'),
  },
  {
    name: 'the floorplan, ready to save',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: floorplanAt('ready'),
  },
  {
    name: 'the floorplan, saving',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: floorplanAt('saving'),
  },
  {
    name: 'market days, the plan',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('big', 'setup'), 'setup-dates-date-display-0'),
  },
  ...FORM_STEPS.map((step): Screen => ({
    // The form tab is steps, each its own surface (E33/F01/S01).
    name: `market days, the form, ${step}`,
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('big', 'form'), 'form-steps', [`form-step-${step}`, `form-step-body-${step}`]),
  })),
  {
    name: 'market days, the applications',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('big', 'applications'), 'market-setup-applications-condition'),
  },
  {
    // Hover is a state too: the tab bar's hover once set its label to a 25% near-black on the
    // black bar, invisible under the pointer (E21/F01/S01).
    name: 'a market tab under the pointer',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      await at(setup('big', 'setup'), 'setup-dates-date-display-0')(page, seed);
      await page.getByTestId('market-bar-tab-applications').hover();
    },
  },

  // Settled rules, read as a record (E22/F02/S02), and an archive.
  {
    name: 'the rules, settled',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('rules', 'settings'), 'assignment-rules-settled'),
  },
  {
    name: 'the result of a market with rules',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('rules', 'assignments'), 'tables-count-assigned'),
  },
  {
    name: 'an archive, its result',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('archived', 'assignments'), 'tables-count-assigned'),
  },
  {
    name: 'an archive, its plan',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(setup('archived', 'setup'), 'setup-dates-date-display-0'),
  },

  // The first thing a new organizer sees, and nothing on it is seeded.
  {
    name: 'the dashboard, with no market',
    who: 'no organization',
    sizes: ORGANIZER,
    open: at(fixed('/dashboard'), 'dashboard-no-market-yet'),
  },
  {
    name: 'the markets list, with no market',
    who: 'no organization',
    sizes: FITS_A_PHONE,
    open: at(fixed('/markets'), 'markets-empty'),
  },

  // Signed out: the way in, and what vendors and the door see.
  {
    name: 'sign in',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/login'), 'login-submit-button'),
  },
  {
    name: 'sign in with a code',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/login'), 'login-submit-button', ['login-tab-otp', 'login-otp-form']),
  },
  {
    name: 'create an account',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/login'), 'login-submit-button', ['login-tab-register', 'login-register-form']),
  },
  {
    name: 'ask for a reset link',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/reset-password-request'), 'auth-card'),
  },
  {
    name: 'choose a new password',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/reset-password?token=a-token-from-an-email'), 'auth-card'),
  },
  {
    // An unknown token, so the page settles on its error and the buttons that answer it.
    name: 'verify an email address',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(
      fixed('/verify-email?token=a-token-from-an-email'),
      'email-verification-error-message',
    ),
  },
  {
    name: 'a page that is not there',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/no/such/page'), 'page-not-found'),
  },
  {
    name: "a market's public page",
    who: 'nobody',
    sizes: PUBLIC,
    open: at(slug('open'), 'market-home-name'),
  },
  {
    name: 'the application form',
    who: 'applicant',
    sizes: PUBLIC,
    open: at(slug('open', '/apply'), 'apply-market-name'),
  },
  {
    name: 'applicant sign-in',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(slug('open', '/applicant-login'), 'applicant-login-email-input'),
  },
  {
    name: "an applicant's dashboard",
    who: 'applicant',
    sizes: PUBLIC,
    open: at(slug('open', '/applicant/dashboard'), 'applicant-dashboard-status'),
  },
  {
    name: 'the check-in page',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(slug('big', '/check-in'), 'attendance-checkin-market-name'),
  },
  {
    // What a vendor at the door sees once they have looked themselves up: a card and a Check in
    // button for each of their days.
    name: 'the check-in page, a vendor looked up',
    who: 'nobody',
    sizes: PUBLIC,
    open: async (page, seed) => {
      await at(slug('big', '/check-in'), 'attendance-checkin-email-input')(page, seed);
      await page.getByTestId('attendance-checkin-email-input').fill('vendor0@example.com');
      await page.getByTestId('attendance-checkin-lookup-button').click();
      await visible(page, 'attendance-checkin-checkin-button');
    },
  },
];

/** Signs the page's browser in as `who`, over the API: the sign-in pages are screens of their own. */
export async function signIn(page: Page, who: Who, seed: TheScreensSeed): Promise<void> {
  if (who === 'nobody') return;
  if (who === 'applicant') {
    // A code planted as the email would carry it, used once, so each sign-in plants its own.
    const email = seed.applicant.email;
    createApplicantLoginChallenge(seed.open.marketId, email, '424242');
    const res = await page.request.post(
      `${BACKEND_URL}/public/markets/${seed.open.marketSlug}/applicant-login/verify-code`,
      { data: { email, code: '424242' } },
    );
    expect(res.ok(), `the applicant's sign-in: ${res.status()}`).toBe(true);
    const { token } = (await res.json()) as { token: string };
    // The tab keeps a vendor's sign-in (`stores/application.ts`).
    const session = {
      marketId: seed.open.marketId,
      marketSlug: seed.open.marketSlug,
      applicantEmail: email,
      token,
    };
    await page.addInitScript(
      (kept) => sessionStorage.setItem('conventioner.applicantSession', kept),
      JSON.stringify(session),
    );
    return;
  }
  const user = who === 'organizer' ? TEST_USER : NO_ORG_USER;
  await loginViaApi(page.request, BACKEND_URL, user.email, user.password);
  // The shell keeps who is signed in here, and the router reads it before any probe (`App.vue`).
  await page.addInitScript(
    (email) => localStorage.setItem('user', JSON.stringify(email)),
    user.email,
  );
}

/** What a sweep asserts of the page as it stands, named for the state it is in. */
export type Check = (state: string) => Promise<void>;

/** A test whose `check` fixture is the sweep's own. */
export type SweepTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & { check: Check },
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

/**
 * One test per screen, running the sweep's `check` on it: at every size it ships at with
 * `everySize`, else at the first, and at `alsoAt` as well when that is given. Returns the seed, for
 * a sweep's own test over several screens.
 */
export function walkTheScreens(
  test: SweepTest,
  { everySize, alsoAt }: { everySize: boolean; alsoAt?: Size },
): { seed: () => TheScreensSeed } {
  let seed: TheScreensSeed;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    seed = await seedTheScreens(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  for (const s of SCREENS) {
    const sizes = everySize ? s.sizes : s.sizes.slice(0, 1);
    // `alsoAt` adds a size the screen does not ship at, when the sweep's question holds there too.
    if (alsoAt && !s.deskOnly && !sizes.some((size) => size.width === alsoAt.width)) {
      sizes.push(alsoAt);
    }
    test(s.name, async ({ page, check }) => {
      test.setTimeout(60_000 * sizes.length);
      await signIn(page, s.who, seed);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await openScreen(page, s, seed);
        await check(s.name);
      }
    });
  }

  return { seed: () => seed };
}

/** Opens a screen and lets it come to rest: its fonts loaded and its transitions run. */
export async function openScreen(page: Page, s: Screen, seed: TheScreensSeed): Promise<void> {
  await s.open(page, seed);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
}
