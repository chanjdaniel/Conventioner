import type {
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import { expect, TEST_USER, NO_ORG_USER, BACKEND_URL, APP_API, CsvImportPage } from '../fixtures';
import { EmailVerificationPage } from '../pages/EmailVerificationPage';
import { LayoutPage } from '../pages/LayoutPage';
import { MarketsPage } from '../pages/MarketsPage';
import { OrganizationsPage } from '../pages/OrganizationsPage';
import { marketScreenPath, marketSetupPath, oneByOnePath } from './marketScreens';
import { mongoEval } from './mongo';
import { createApplicantLoginChallenge } from './seedApplicantMarket';
import { loginViaApi, UPPER_HALL_TABLES } from './seeds';
import { calendarToday } from './vendorSignIn';
import {
  FIRST_IMPORT,
  LATER_IMPORT,
  SCREENS_EDITOR,
  seedTheScreens,
  type TheScreensSeed,
} from './seedTheScreens';
import { settle } from './settle';

/**
 * Every screen and deliberate state of the app, walked by every sweep: contrast
 * (`contrast-sweep.spec.ts`), what axe can see (`accessibility-sweep.spec.ts`), layout
 * (`layout-sweep.spec.ts`) and focus (`focus-sweep.spec.ts`). Each sweep passes its own `check` and
 * nothing else, so a state added here is walked by all four.
 *
 * **A sweep is only worth the states it walks.** A twenty-screen pass missed the invisible
 * archive-confirmation button, because nobody opened that dialog; a layout trial missed a row's
 * squeezed dates until it opened a market first (T67). So the list names the router's routes, the
 * dialogs, menus and drawers, hover states, Markets with a market remembered, every phase, settled rules and the signed-out pages, over the stress seed's
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
 * A route with `meta.fitsAPhone`: an organizer's that works on a phone too, with the dialogs, menus
 * and drawers that open over it. One place a line, each with the work that brought it:
 *
 * - the door (E29/F01);
 * - Tools, and the Discord return page;
 * - `/markets`, where signing in lands (T142);
 * - the Assignments page (T142), so "Change assignment" at the door lands on a page that fits the
 *   phone it was tapped on;
 * - Organizations (T148);
 * - Vendors (T180), with its drawer and dialogs, so a vendor is looked up and corrected at the door;
 * - Payments (T180), so who still owes is read at the door;
 * - the Applications page (T180), the one page of Market Setup's view that fits, both its views,
 *   its drawer and dialogs, so a late application is decided, the review dealt and a vendor's
 *   answer corrected from a phone;
 * - Stats (T180), so how the day stands is read at the market.
 */
const FITS_A_PHONE = [DESKTOP, LAPTOP, PHONE];

/** Who is signed in to see a screen. */
export type Who = 'organizer' | 'editor' | 'no organization' | 'applicant' | 'nobody';

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

/** Markets, in a browser that remembers `id` as the market it opened last (E21/F02/S05). */
async function openRemembering(page: Page, id: string, ready: string) {
  await page.goto('/markets');
  await page.evaluate((remembered) => localStorage.setItem('lastMarketId', remembered), id);
  await page.reload();
  await visible(page, ready);
}

/** Markets, with the market this browser opened last on its one line. */
function marketsRemembering(market: keyof TheScreensSeed) {
  return (page: Page, seed: TheScreensSeed) =>
    openRemembering(
      page,
      (seed[market] as { marketId: string }).marketId,
      'markets-previously-opened',
    );
}

/** Markets, saying once that the market this browser opened last has gone. */
const marketsRememberingOneGone = (page: Page) =>
  openRemembering(page, 'a-market-that-has-gone', 'markets-last-market-gone');

/**
 * `market`'s Questions tab as the start from a Google Form's confirm lands on it (T205/F20): the
 * file's name in the entry's history state, under the key `utils/draftedFrom.ts` reads. Planted and
 * reloaded rather than confirmed, since a confirm writes the seeded draft every other state reads.
 */
function landedFromAFile(market: keyof TheScreensSeed) {
  return async (page: Page, seed: TheScreensSeed) => {
    await page.goto(setup(market, 'form')(seed));
    await visible(page, 'form-steps');
    await page.evaluate(() =>
      history.replaceState({ ...history.state, draftedFrom: 'five-day-grid.csv' }, ''),
    );
    await page.reload();
    await visible(page, 'drafted-from');
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
  const markets = new MarketsPage(page);
  await markets.goto();
  await markets.narrowTo(name);
  await markets.card(name).getByTestId('market-card-manage-button').click();
  await visible(page, 'manage-market-window');
};

/**
 * Manage organization on the screens' own organization (T148), its admin's and member's long
 * addresses drawn and both its add rows open.
 */
const managingTheOrganization = async (page: Page, seed: TheScreensSeed) => {
  const orgs = new OrganizationsPage(page);
  await orgs.goto();
  await (
    await orgs.findCard(seed.organization.name)
  )
    .getByTestId('organizations-manage-button')
    .click();
  await visible(page, 'manage-org-member-email');
  await page.getByTestId('manage-org-add-admin-button').click();
  await visible(page, 'manage-org-add-admin-input');
  await page.getByTestId('manage-org-add-member-button').click();
  await visible(page, 'manage-org-add-member-input');
};

/**
 * Manage organization on the screens' own organization, its member's Remove asking first
 * (E38/F15/S01): the confirmation names their long address and what they lose.
 */
const removingFromTheOrganization = async (page: Page, seed: TheScreensSeed) => {
  const orgs = new OrganizationsPage(page);
  await orgs.goto();
  await (
    await orgs.findCard(seed.organization.name)
  )
    .getByTestId('organizations-manage-button')
    .click();
  await visible(page, 'manage-org-member-email');
  await page.getByTestId('manage-org-remove-member-button').first().click();
  await visible(page, 'manage-org-remove-consequence');
};

/**
 * Manage market on the organization's market, its admin's Editor role's Remove asking first
 * (E38/F15/S01): the role they lose, and that they still run it through the organization.
 */
const removingAMarketRole = async (page: Page, seed: TheScreensSeed) => {
  await managing('organizationMarket')(page, seed);
  // The admin's row: its one Remove is the one beneath "Also Editor on this market".
  await page
    .getByTestId('manage-market-person')
    .filter({ has: page.getByTestId('manage-market-also') })
    .getByTestId('manage-market-remove-user-button')
    .click();
  await visible(page, 'manage-market-remove-keeps');
};

/**
 * Manage market on the divided market, its Viewer's select choosing Admin (T211): the longest list
 * the confirmation has, every row above Viewer up to Admin, in a body that scrolls.
 */
const changingAMarketRole = async (page: Page, seed: TheScreensSeed) => {
  await managing('dealt')(page, seed);
  await page.getByTestId('manage-market-role-select').selectOption('admin');
  await visible(page, 'manage-market-role-change-gains');
};

const FORM_STEPS = ['essentials', 'questions', 'preview', 'review'] as const;

/**
 * A location's layout (T257) at one of its steps: the draft's first location, whose layout has not
 * begun, on its upload's drop zone; and the layout seed's Upper Hall, its floorplan uploaded and its
 * scale not yet set, calibrating; and the laid-out seed's Upper Hall, drawn as its map, 20 tables
 * over the faded floorplan with the panel's list of sections: the editor at a desk and the map read
 * on a phone, then, at a desk, with a table selected, with every table selected, with a section's
 * colours open, with Add table's options open, with a table picked up by keyboard, with the
 * panel's list of keys open, with a row being drawn by the crosshair, with a curve drawn by hand
 * waiting with its points, with an L-shaped area's
 * corners clicked for Fill an area, with that area closed and its dialog open, with a table type's
 * dialog open, and with the image being replaced. Nothing is
 * saved, so each walk finds them as seeded.
 */
function layoutAt(
  stage:
    | 'upload'
    | 'calibrating'
    | 'map'
    | 'selected'
    | 'several'
    | 'colours'
    | 'adding'
    | 'pickedUp'
    | 'keys'
    | 'row'
    | 'drawn'
    | 'fillShape'
    | 'fillDialog'
    | 'typeDialog'
    | 'replacing',
) {
  return async (page: Page, seed: TheScreensSeed) => {
    const layout = new LayoutPage(page);
    if (stage === 'upload') {
      await layout.goto(seed.draft.marketId);
      await expect(layout.uploadDropzone).toBeVisible();
      return;
    }
    if (stage !== 'calibrating') {
      await layout.goto(seed.laidOut.marketId, seed.laidOut.upper.id);
      await expect(layout.mapImage).toHaveAttribute('href', /^blob:/);
      await expect(layout.tables).toHaveCount(UPPER_HALL_TABLES.length);
      if (stage === 'selected') {
        // Silver aisle's first table, pressed: outlined, the turn handle over it, its card filled.
        await layout.clickAt([10_000, 11_000]);
        await expect(layout.selectionTitle).toHaveText('Silver aisle 1');
        await expect(layout.turnKnob).toBeVisible();
      }
      if (stage === 'several') {
        // Every table selected: the card's count, its first ten codes, its fields reading
        // "Mixed", and the Align menu beside its buttons.
        await layout.clickAt([10_000, 11_000]);
        await page.keyboard.press('Control+a');
        await expect(layout.selectionTitle).toHaveText(
          `${UPPER_HALL_TABLES.length} tables selected`,
        );
        await expect(layout.selectionAlign).toBeVisible();
      }
      if (stage === 'colours') {
        // Gold row's colours, open under its row of the Sections card.
        await layout.sectionColour('Gold row').click();
        await expect(layout.paletteColour('Gold')).toBeFocused();
      }
      if (stage === 'adding') {
        await layout.toolAdd.click();
        await expect(layout.addSection).toBeVisible();
      }
      if (stage === 'pickedUp') {
        // Gold row's first table, reached by Tab and picked up by Enter: drawn lifted, the map
        // wearing the halo, and the hint saying the keys that move it.
        await layout.tabToTheMap();
        await page.keyboard.press('Enter');
        await expect(layout.hint).toContainText('Picked up');
      }
      if (stage === 'row') {
        // Row of tables on, its options strip open, and a path of three points laid by the
        // crosshair round a corner: the row it would place drawn dashed, with its count.
        await layout.toolRow.click();
        await layout.tabToTheMap();
        await page.keyboard.press('Enter');
        for (let press = 0; press < 5; press += 1) await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press('Enter');
        for (let press = 0; press < 5; press += 1) await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Enter');
        await expect(layout.rowCount).toBeVisible();
        await expect(layout.rowTables.first()).toBeVisible();
      }
      if (stage === 'drawn') {
        // Row of tables on, and a quarter of a 5 m circle drawn by hand over the clear floor
        // south of the tables: let go, it waits as a path with its points, its row and its count.
        await layout.toolRow.click();
        const places = Array.from({ length: 41 }, (_, i): [number, number] => {
          const turn = ((i / 40 - 1) * Math.PI) / 2;
          return [13_000 + 5000 * Math.cos(turn), 20_500 + 5000 * Math.sin(turn)];
        });
        await layout.drawThrough(places);
        await expect(layout.rowPoints.first()).toBeVisible();
        await expect(layout.rowTables.first()).toBeVisible();
        await expect(layout.hint).toContainText('Drag a point to adjust the curve.');
      }
      if (stage === 'fillShape' || stage === 'fillDialog') {
        // Fill an area on, and an L's corners clicked over the clear floor south of the tables.
        await layout.toolFill.click();
        const corners: [number, number][] = [
          [12_000, 13_500],
          [22_000, 13_500],
          [22_000, 16_500],
          [16_000, 16_500],
          [16_000, 21_000],
          [12_000, 21_000],
        ];
        for (const corner of corners) await layout.clickAt(corner);
        await expect(layout.fillPoints).toHaveCount(corners.length);
        // The pointer on the first corner, which wears its ring: a click there closes the shape.
        await layout.hoverAt(corners[0]);
        await expect(layout.fillClose).toBeVisible();
        if (stage === 'fillDialog') {
          await layout.clickAt(corners[0]);
          await expect(layout.fillDialog).toBeVisible();
          await expect(layout.fillSection).toBeFocused();
        }
      }
      if (stage === 'typeDialog') {
        // Standard 6 ft's dialog, opened from its row's menu of the Table types card.
        await layout.chooseForType('Standard 6 ft', 'Edit');
        await expect(layout.typeDialog).toBeVisible();
        await expect(layout.typeName).toBeFocused();
      }
      if (stage === 'replacing') {
        // "Replace the image": the upload's drop zone in the map's place, and the way back.
        await layout.replaceImage.click();
        await expect(layout.uploadDropzone).toBeVisible();
        await expect(layout.replaceCancel).toBeVisible();
      }
      if (stage === 'keys') {
        await layout.keyboardSummary.click();
        await expect(layout.keyboard.getByText('Put them back')).toBeVisible();
      }
      return;
    }
    await layout.goto(seed.layout.marketId, seed.layout.upper.id);
    await expect(layout.calibrationMap.locator('image')).toHaveAttribute('href', /^blob:/);
  };
}

export const SCREENS: Screen[] = [
  // The organizer's own pages.
  {
    // The count, not "New market": the button is drawn before the list arrives, and on a stack
    // holding thousands of markets the sweep measured "Loading markets..." and nothing else.
    name: 'the markets list',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(fixed('/markets'), 'markets-result-count'),
  },
  {
    name: 'the markets list, remembering a long-named draft',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: marketsRemembering('draft'),
  },
  {
    name: 'the markets list, remembering a market in market days',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: marketsRemembering('big'),
  },
  {
    name: 'the markets list, a remembered market gone',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: marketsRememberingOneGone,
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
    // With its Permissions dialog open over it (E39/F01/S04, T217).
    name: 'the manage-market dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/markets'),
      'markets-result-count',
      ['market-card-manage-button', 'manage-market-window'],
      ['manage-market-permissions-open', 'manage-market-permission-source'],
    ),
  },
  {
    // Its "Add user" row open (T142): on a phone the row squeezed its email field and its role
    // to 66px each beside Add and Cancel, and no state opened it.
    name: 'the manage-market dialog, adding a user',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/markets'),
      'markets-result-count',
      ['market-card-manage-button', 'manage-market-window'],
      ['manage-market-add-user-button', 'manage-market-add-user-input'],
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
    // A market of an organization with an admin and a member, the admin also Editor on it
    // (E38/F12/S01): rows "through" the organization, the line beneath a market role that adds
    // nothing, and the note that links to Manage organization.
    name: "the manage-market dialog, an organization's people",
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: managing('organizationMarket'),
  },
  {
    // Its Remove asking first (E38/F15/S01), on the admin's market role.
    name: 'the manage-market dialog, removing a market role',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: removingAMarketRole,
  },
  {
    // Its role select asking first (T211), Viewer to Admin, the confirmation's longest list.
    name: 'the manage-market dialog, changing a market role',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: changingAMarketRole,
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
    // Its "Who" open, the list lying over the filters below it (T204).
    name: "the manage-market dialog's history, Who open",
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/markets'),
      'markets-result-count',
      ['market-card-manage-button', 'manage-market-history-toggle'],
      ['manage-market-history-toggle', 'market-history-who-input'],
      ['market-history-who-input', 'market-history-who-list'],
    ),
  },
  {
    // The app's own menu, behind the bar's button on a phone.
    name: 'the sheet',
    who: 'organizer',
    sizes: [PHONE],
    open: at(fixed('/markets'), 'markets-result-count', ['app-bar-menu-button', 'app-bar-sheet']),
  },
  {
    // The bar's account menu, on every organizer screen at a desk.
    name: 'the account menu',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: at(fixed('/markets'), 'markets-result-count', [
      'app-bar-account-button',
      'app-bar-account',
    ]),
  },
  {
    name: 'the organizations',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(fixed('/organizations'), 'organization-card'),
  },
  {
    // With its default permissions for new markets open over it (E39/F02/S01, T217).
    name: 'the manage-organization dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/organizations'),
      'organization-card',
      ['organizations-manage-button', 'manage-org-window'],
      ['manage-org-permissions-open', 'manage-org-permission-source'],
    ),
  },
  {
    // Its History section, loaded, with an entry opened to its before and after (E40/F02/S01):
    // the seeded organization's market, created in it.
    name: "the manage-organization dialog's history, an entry open",
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/organizations'),
      'organization-card',
      ['organizations-manage-button', 'manage-org-history-toggle'],
      ['manage-org-history-toggle', 'org-history-entry'],
      ['org-history-toggle', 'org-history-changes'],
    ),
  },
  {
    name: 'the new-organization dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(fixed('/organizations'), 'organization-card', [
      'organizations-create-button',
      'organizations-create-name-input',
    ]),
  },
  {
    // On the organization the seed's markets are made in: markets under way stop it, and it names
    // them. Never confirmed.
    name: 'the delete-organization dialog, refused while markets are under way',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      fixed('/organizations'),
      'organization-card',
      ['organizations-manage-button', 'manage-org-window'],
      ['manage-org-delete-button', 'delete-org-blocked'],
    ),
  },
  {
    // An admin and a member whose addresses are long (T148), and both add rows open.
    name: 'the manage-organization dialog, its people and both add rows',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: managingTheOrganization,
  },
  {
    // Its Remove asking first (E38/F15/S01), on the member with a long address.
    name: 'the manage-organization dialog, removing a member',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: removingFromTheOrganization,
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
    sizes: FITS_A_PHONE,
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
    // The same dialog from the rail over the draft's Applications page, which fits a phone while
    // the plan keeps the desk floor (T180): the organizer deals the review from a phone.
    name: 'opening applications from the applications page, choosing reviewers',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(setup('draft', 'applications'), 'market-tab-note', [
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
  {
    // A bare draft's first import lists everything it waits on, each with its link (T205/F09).
    name: "a CSV draft's first import, refused for what its plan lacks",
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('csvDraft', 'import'), 'blocker-item'),
  },
  {
    // What the start drafted and what the first import still waits on, said once (T205/F20, F09).
    name: 'a CSV draft, its Questions tab after drafting from a Google Form',
    who: 'organizer',
    sizes: ORGANIZER,
    open: landedFromAFile('csvDraft'),
  },

  // Applications open, closed and in review, each with 40 applications in every review state.
  {
    name: 'applications open, one by one',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(oneByOne('open'), 'app-monitor-card'),
  },
  {
    // A status is a tinted chip, on the card's own beige ground as well as on white (bug 43).
    name: 'a review card, and the verdicts already given',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(oneByOne('open'), 'app-monitor-card', [
      'app-monitor-decided-open',
      'app-monitor-decided-row',
    ]),
  },
  {
    name: 'the follow-up dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(oneByOne('open'), 'app-monitor-card', [
      'app-monitor-follow-up-button',
      'follow-up-window',
    ]),
  },
  {
    // What leads the card, in a dialog over it (T217).
    name: 'the dialog of what leads the card',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(oneByOne('open'), 'app-monitor-card', [
      'app-monitor-choose-highlights',
      'choose-highlights-window',
    ]),
  },
  {
    name: 'applications open, all at once',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(setup('open', 'applications'), 'applications-all-tick'),
  },
  {
    // Update info opens inside a phone's window over the All view as it does over Vendors (T180);
    // T122 found it cut there.
    name: 'the Update info dialog, over the applications',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      setup('open', 'applications'),
      'applications-all-tick',
      ['applications-all-row', 'vendors-detail-update-info'],
      ['vendors-detail-update-info', 'update-info-window'],
    ),
  },
  {
    // Who reviews which application, chosen from the panel over the views (E38/F07/S02).
    name: 'the reviewers dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
    open: at(setup('dealt', 'applications'), 'applications-all-assigned-to'),
  },
  {
    name: 'the review divided, "Assigned to" open',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(setup('dealt', 'applications'), 'applications-all-assigned-to', [
      'applications-all-assigned-to-input',
      'applications-all-assigned-to-list',
    ]),
  },
  {
    name: "the review divided, another's application in the drawer",
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      (seed) =>
        `${setup('dealt', 'applications')(seed)}?reviewer=anyone&vendor=applicant0@example.com`,
      'applications-all-drawer-dealt-warning',
    ),
  },
  {
    name: 'the review divided, my share done',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(oneByOne('dealt'), 'app-monitor-share-done'),
  },
  {
    name: "the review divided, helping with another's share",
    who: 'organizer',
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
    open: at(oneByOne('closed'), 'app-monitor-card'),
  },
  {
    name: 'a Google Form market in review',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(oneByOne('review'), 'app-monitor-card'),
  },
  {
    name: 'a CSV market, redoing its import',
    who: 'organizer',
    sizes: ORGANIZER,
    open: at(screen('csv', 'import'), 'import-view'),
  },
  {
    // A later file on a saved mapping: restored and new columns, a grid, values waiting on a column
    // and on the grid, and every required question ticked, each on its own ground (T223).
    name: 'a CSV market, Map columns with values waiting',
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      const importing = new CsvImportPage(page);
      await page.goto(screen('csv', 'import')(seed));
      await expect(importing.view).toBeVisible({ timeout: 15000 });
      await importing.chooseFile(LATER_IMPORT.csv);
      await expect(importing.groupRows.getByTestId('import-restored-badge')).toBeVisible();
      await expect(importing.columnRows.getByTestId('import-new-badge')).toBeVisible();
      await expect(importing.allMapped).toBeVisible();
      await expect(importing.groupRows.getByTestId('import-unmatched-value')).toHaveCount(2);
      await expect(importing.unresolvedWarning).toBeVisible();
    },
  },
  {
    // The first import offers the reviewers on its preview, as "Open applications" does on a
    // market's own form (E38/F07/S02); nothing is imported, so every run finds it the same.
    name: "a CSV draft's first import, choosing reviewers",
    who: 'organizer',
    sizes: ORGANIZER,
    open: async (page, seed) => {
      const importing = new CsvImportPage(page);
      await page.goto(screen('csvFirst', 'import')(seed));
      await expect(importing.view).toBeVisible({ timeout: 15000 });
      await importing.chooseFile(FIRST_IMPORT.csv);
      await importing.mapColumns(FIRST_IMPORT.headers, FIRST_IMPORT.mapping);
      await expect(importing.allMapped).toBeVisible();
      await importing.clickPreview();
      await expect(importing.previewCounts).toContainText('3 of 3 rows');
      await expect(importing.reviewers).toBeVisible();
    },
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
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'assignments'), 'tables-count-assigned'),
  },
  {
    // A section past the fold of 20 tables, unfolded, its button now "Show fewer" (T223).
    name: 'the result, a section unfolded',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      await at(screen('longSection', 'assignments'), 'tables-count-assigned')(page, seed);
      await page
        .getByRole('button', { name: /^Show all 24 in / })
        .first()
        .click();
      await expect(page.getByRole('button', { name: /^Show fewer in / }).first()).toBeVisible();
    },
  },
  {
    // The ledger of bars (E35/F03/S01): a share in muted ink on white.
    name: 'the statistics',
    who: 'organizer',
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'assignments'), 'tables-count-assigned', [
      'tables-seat-change',
      'placement-dialog-window',
    ]),
  },
  {
    // Its swap picker searched, the list open with a choice active on its beige (E38/F08/S03).
    name: 'the swap picker, searched',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned', [
        'tables-seat-change',
        'placement-dialog-window',
      ])(page, seed);
      await page.getByTestId('placement-dialog-action-swap').check();
      const field = page.getByTestId('placement-dialog-swap-target-input');
      await field.fill('a');
      await field.press('ArrowDown');
      await visible(page, 'placement-dialog-swap-target-list');
    },
  },
  {
    // A taken seat's move picker open (T208): the day's empty seats, grouped by section.
    name: 'the move picker, open',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned', [
        'tables-seat-change',
        'placement-dialog-window',
      ])(page, seed);
      await page.getByTestId('placement-dialog-action-move').check();
      await page.getByTestId('placement-dialog-move-target-input').click();
      await visible(page, 'placement-dialog-move-target-list');
    },
  },
  {
    // And the place picker's groups, open on a free seat: its market has vendors seated already,
    // so the last is "Seated elsewhere today (moves them)" (T208).
    name: 'the place picker, open',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      await at(screen('big', 'assignments'), 'tables-count-assigned', [
        'tables-seat-empty',
        'placement-dialog-window',
      ])(page, seed);
      await page.getByTestId('placement-dialog-vendor-input').click();
      await visible(page, 'placement-dialog-vendor-list');
      await visible(page, 'placement-dialog-seated-elsewhere');
    },
  },
  {
    // Whoever holds a seat opens their drawer over the page, on its Assignments tab: on a phone it
    // is where "Change assignment" at the door leads back to (T142).
    name: 'the vendor drawer, over the assignments',
    who: 'organizer',
    sizes: [PHONE],
    open: at(
      screen('big', 'assignments'),
      'tables-count-assigned',
      ['tables-seat-vendor', 'vendors-detail-email'],
      ['vendor-drawer-tab-assignments', 'vendors-detail-assignment-item'],
    ),
  },
  {
    name: 'the assignment history',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'assignments'), 'tables-count-assigned', [
      'result-history-button',
      'assignment-history-dialog-window',
    ]),
  },
  {
    name: 'the vendors',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'vendors'), 'vendors-list-item'),
  },
  {
    // Who a Discord run reached, in a dialog over the vendors (T217): each group, a reason in words
    // and a vendor no longer listed. The seed's other markets connect no Discord.
    name: 'the dialog of who the role report names',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('roleReport', 'vendors'), 'vendors-role-report', [
      'vendors-role-report-open',
      'vendors-role-report-who-window',
    ]),
  },
  {
    name: 'the vendor drawer',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'vendors'), 'vendors-list-item', [
      'vendors-list-item',
      'vendors-detail-email',
    ]),
  },
  {
    // An Editor corrects a vendor's answer at the door (T180), so it opens inside a phone's window.
    name: 'the Update info dialog, over the vendors',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendors-detail-update-info', 'update-info-window'],
    ),
  },
  {
    // An Editor's Update info (E41/F01/S02): the answers the assignment reads are an Admin's to
    // update, so they are locked, the essential questions drawn as the market's own locked ones
    // are (T181). It opens on `big`, whose plan asks the tiers, the table and the section ranking.
    name: "an Editor's update-info dialog, the essentials locked",
    who: 'editor',
    sizes: FITS_A_PHONE,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-list-item', 'vendors-detail-email'],
      ['vendors-detail-update-info', 'update-info-essentials'],
    ),
  },
  {
    // Its History tab, the market's history narrowed to the vendor (E40/F01/S04).
    name: "the vendor drawer's history",
    who: 'organizer',
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'vendors'), 'vendors-list-item', [
      'vendors-add-button',
      'add-vendor-name-input',
    ]),
  },
  {
    // The cart's count, not the dialog: its fields and its cart arrive with the first preview. A
    // phone folds the preview's rows away.
    name: 'the export dialog',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'vendors'), 'vendors-list-item', [
      'vendors-export-button',
      'vendor-export-summary',
    ]),
  },
  {
    name: 'the export dialog, its cart unfolded',
    who: 'organizer',
    sizes: [PHONE],
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-export-button', 'vendor-export-summary'],
      ['vendor-export-cart-toggle', 'vendor-export-preview-row'],
    ),
  },
  {
    // Every filter, a seat's among them.
    name: 'the export dialog, its filters unfolded',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(
      screen('big', 'vendors'),
      'vendors-list-item',
      ['vendors-export-button', 'vendor-export-summary'],
      ['vendor-export-filters-toggle', 'vendor-export-search'],
    ),
  },
  {
    // Who owes (E44/F02/S01): the list, on a market that sets no prices, so it draws no figures.
    name: 'the payments',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'payments'), 'payments-row'),
  },
  {
    // A priced market (T180): its money by tier and by date, laid out as blocks on a phone.
    name: 'the payments, priced',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      await at(screen('rules', 'payments'), 'payments-row')(page, seed);
      await visible(page, 'payments-by-date-row');
    },
  },
  {
    // A vendor's line opens their drawer on its Payment tab (E44/F02/S01), over the page.
    name: 'the vendor drawer, over the payments',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'payments'), 'payments-row', ['payments-row-open', 'payment-tab']),
  },
  {
    name: 'the attendance',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'attendance'), 'attendance-row'),
  },
  {
    // The headlines, who applied, and a chart per choice question, as ledgers of bars (E45/F01/S01
    // to S03); it fits a phone (T180). The two load apart, so it waits for both.
    name: 'the stats',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      await at(screen('big', 'stats'), 'stats-status')(page, seed);
      await visible(page, 'stats-answer');
    },
  },
  {
    // A priced market's Stats (T180): the money's headlines too, set apart from the placements by
    // a rule, beside them at a desk and above them on a phone.
    name: 'the stats, priced',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('rules', 'stats'), 'stats-headline-stillOwed'),
  },
  {
    // The manual tools, Discord's card first (E46/F01/S02); it fits a phone, as the door does.
    name: 'the tools',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'tools'), 'plan-card-discord'),
  },
  // The door code over the attendance (ADR 0022), on the tablet or laptop at the entrance or the
  // phone in the organizer's hand: before one is made, full screen, and New code's confirmation.
  {
    name: 'the door code, none made yet',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      mongoEval(
        `db.markets.updateOne({ id: '${seed.big.marketId}' }, { $unset: { doorCode: 1 } })`,
      );
      await at(screen('big', 'attendance'), 'attendance-row', [
        'attendance-door-code',
        'door-code-make',
      ])(page, seed);
    },
  },
  ...(
    [
      ['full screen', []],
      ["New code's confirmation", [['door-code-new', 'door-code-new-confirm-window']]],
    ] as const
  ).map(([state, then]): Screen => ({
    name: `the door code, ${state}`,
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: async (page, seed) => {
      const made = await page.request.post(`${APP_API}/markets/${seed.big.marketId}/door-code`);
      expect(made.ok(), await made.text()).toBeTruthy();
      await at(
        screen('big', 'attendance'),
        'attendance-row',
        ['attendance-door-code', 'door-code-qr'],
        ...then.map(([click, shows]): [string, string] => [click, shows]),
      )(page, seed);
    },
  })),
  // What else the organizer reaches at the door, on the phone in their hand (T82).
  {
    name: 'the sheet, at the door',
    who: 'organizer',
    sizes: [PHONE],
    open: at(screen('big', 'attendance'), 'attendance-row', [
      'app-bar-menu-button',
      'app-bar-sheet',
    ]),
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
  // Its other tabs, each read on the phone in the organizer's hand (T142, T82 re-check note 8):
  // "Change assignment" on the Assignments tab is the way from the door to the Assignments page.
  ...(
    [
      ['assignments', 'vendors-detail-assignment-item'],
      ['payment', 'payment-tab'],
      ['history', 'market-history'],
    ] as const
  ).map(([tab, ready]): Screen => ({
    name: `the vendor drawer's ${tab}, at the door`,
    who: 'organizer',
    sizes: [PHONE],
    open: at(
      screen('big', 'attendance'),
      'attendance-row',
      ['attendance-vendor', 'vendors-detail-email'],
      [`vendor-drawer-tab-${tab}`, ready],
    ),
  })),
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
  // A layout past draft, with no floorplan: read, with nothing to upload.
  {
    name: 'the layout, past draft',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: at(screen('big', 'layout'), 'layout-no-floorplan'),
  },
  // Its upload step is the app's one drop zone (T205), and the page fits a phone (T257).
  {
    name: 'the layout, its upload step',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: layoutAt('upload'),
  },
  {
    name: 'the layout, calibrating',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: layoutAt('calibrating'),
  },
  // The layout drawn (T257): the map's tables, names and zones, and the panel's sections.
  {
    name: 'the layout, its map',
    who: 'organizer',
    sizes: FITS_A_PHONE,
    open: layoutAt('map'),
  },
  // The editor (T257), at a desk alone: a table selected, and Add table's options strip.
  {
    name: 'the layout, a table selected',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('selected'),
  },
  // Several at once (T257): every table selected, and a section's colours open in the panel, with
  // the one table in no section counted under the sections.
  {
    name: 'the layout, several tables selected',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('several'),
  },
  {
    name: "the layout, a section's colours",
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('colours'),
  },
  {
    name: 'the layout, adding a table',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('adding'),
  },
  // By keyboard (T257): a table picked up, and the panel's list of the editor's keys.
  {
    name: 'the layout, a table picked up',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('pickedUp'),
  },
  {
    name: 'the layout, its keys listed',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('keys'),
  },
  // A row along a drawn path (T257): the options strip, the pending path and the crosshair.
  {
    name: 'the layout, a row being drawn',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('row'),
  },
  // A row's line drawn by hand (T257): the smoothed path waiting with its points.
  {
    name: 'the layout, a curve drawn by hand',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('drawn'),
  },
  // Fill an area (T257): a shape's corners clicked over the map, then its dialog.
  {
    name: 'the layout, an area being drawn',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('fillShape'),
  },
  {
    name: 'the layout, the Fill dialog',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('fillDialog'),
  },
  {
    name: "the layout, a table type's dialog",
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('typeDialog'),
  },
  {
    name: 'the layout, its image being replaced',
    who: 'organizer',
    sizes: ORGANIZER,
    deskOnly: true,
    open: layoutAt('replacing'),
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
    sizes: FITS_A_PHONE,
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
    sizes: FITS_A_PHONE,
    open: at(screen('rules', 'assignments'), 'tables-count-assigned'),
  },
  {
    name: 'an archive, its result',
    who: 'organizer',
    sizes: FITS_A_PHONE,
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
    name: 'the markets list, with no market',
    who: 'no organization',
    sizes: FITS_A_PHONE,
    open: at(fixed('/markets'), 'markets-no-market-yet'),
  },
  {
    name: 'the markets list, its only remembered market gone',
    who: 'no organization',
    sizes: FITS_A_PHONE,
    open: marketsRememberingOneGone,
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
    // Where the bar's Change password leads, with the address filled in and the full bar over it.
    name: 'ask for a reset link, signed in',
    who: 'organizer',
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
    name: 'choose a new password, signed in',
    who: 'organizer',
    sizes: PUBLIC,
    open: at(fixed('/reset-password?token=a-token-from-an-email'), 'auth-card'),
  },
  {
    // An unknown token, so the page settles on its error and the form that answers it.
    name: 'verify an email address',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(
      fixed('/verify-email?token=a-token-from-an-email'),
      'email-verification-error-message',
    ),
  },
  {
    // "Send the link again" with nothing typed: the field's own message, in red under it (T181).
    // The pointer then leaves the button: this state is the message, not a hovered button.
    name: 'verify an email address, no address typed',
    who: 'nobody',
    sizes: PUBLIC,
    open: async (page, seed) => {
      await at(
        fixed('/verify-email?token=a-token-from-an-email'),
        'email-verification-error-message',
        ['email-verification-resend-button', 'email-verification-email-error'],
      )(page, seed);
      await page.mouse.move(0, 0);
    },
  },
  {
    // An address with no account: the server answers as for any, and the page says a link is on
    // its way (T181).
    name: 'verify an email address, the link sent again',
    who: 'nobody',
    sizes: PUBLIC,
    open: async (page) => {
      const verification = new EmailVerificationPage(page);
      await verification.goto('a-token-from-an-email');
      await expect(verification.emailInput).toBeVisible({ timeout: 15000 });
      await verification.sendTheLinkAgain('e2e-screens-nobody@example.com');
      await expect(verification.resentMessage).toBeVisible({ timeout: 15000 });
    },
  },
  {
    name: 'a page that is not there',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(fixed('/no/such/page'), 'page-not-found'),
  },
  {
    // A signed-in organizer keeps the full bar on a public page, and is offered Markets here.
    name: 'a page that is not there, signed in',
    who: 'organizer',
    sizes: PUBLIC,
    open: at(fixed('/no/such/page'), 'page-not-found'),
  },
  {
    // A market's vendor page, signed out (ADR 0022): its name and the email step.
    name: 'the vendor page, signed out',
    who: 'nobody',
    sizes: PUBLIC,
    open: at(slug('open'), 'vendor-sign-in-email-input'),
  },
  {
    name: 'the vendor page, an organizer signed in',
    who: 'organizer',
    sizes: PUBLIC,
    open: at(slug('open'), 'vendor-sign-in-email-input'),
  },
  {
    name: 'the vendor page, the code step',
    who: 'nobody',
    sizes: PUBLIC,
    open: async (page, seed) => {
      await at(slug('open'), 'vendor-sign-in-email-input')(page, seed);
      // An address of its own each time: every sweep opens this at every size, past the limit of
      // codes one address may ask for (`sign_in_limits`).
      const address = `e2e-screens-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      await page.getByTestId('vendor-sign-in-email-input').fill(address);
      await page.getByTestId('vendor-sign-in-request-btn').click();
      await visible(page, 'vendor-sign-in-code-input');
    },
  },
  {
    // A code that no longer works (T191 F22): the field and Sign in give way to Send a new code.
    name: 'the vendor page, a used-up code',
    who: 'nobody',
    sizes: PUBLIC,
    open: async (page, seed) => {
      await at(slug('open'), 'vendor-sign-in-email-input')(page, seed);
      const address = `e2e-screens-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      await page.getByTestId('vendor-sign-in-email-input').fill(address);
      await page.getByTestId('vendor-sign-in-request-btn').click();
      await visible(page, 'vendor-sign-in-code-input');
      // Four of its five tries used, so one wrong try uses it up through the real verify.
      createApplicantLoginChallenge(seed.open.marketId, address, '424242', { attempts: 4 });
      await page.getByTestId('vendor-sign-in-code-input').fill('000000');
      await page.getByTestId('vendor-sign-in-verify-btn').click();
      await visible(page, 'vendor-sign-in-send-new-code-btn');
    },
  },
  {
    name: 'the vendor page, signed in',
    who: 'applicant',
    sizes: PUBLIC,
    open: at(slug('open'), 'vendor-page-status'),
  },
  {
    // The form, opened in place on the vendor page by Edit (ADR 0022).
    name: 'the vendor page, the application form',
    who: 'applicant',
    sizes: PUBLIC,
    open: async (page, seed) => {
      await at(slug('open'), 'vendor-page-edit-btn')(page, seed);
      await page.getByTestId('vendor-page-edit-btn').click();
      await visible(page, 'apply-form');
    },
  },
  {
    // A question of more than 12 options (T223), which only a long form reaches: the fixture's
    // questions stand in for the market's, one in error, one with a chip and its list open.
    name: 'the vendor page, a long question',
    who: 'applicant',
    sizes: PUBLIC,
    open: async (page, seed) => {
      await page.route(
        `**/public/markets/${seed.open.marketSlug}/application-form`,
        async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          const fields = [...body.application_form.fields, ...LONG_QUESTIONS];
          await route.fulfill({
            response,
            json: { ...body, application_form: { ...body.application_form, fields } },
          });
        },
      );
      await at(slug('open'), 'vendor-page-edit-btn')(page, seed);
      await page.getByTestId('vendor-page-edit-btn').click();
      await visible(page, 'apply-form');
      await page.getByTestId('apply-submit-button').click();
      await visible(page, 'apply-error-long_one');
      const several = page.getByTestId('apply-input-long_several-input');
      await several.click();
      await page.getByTestId('apply-input-long_several-option').first().click();
      await visible(page, 'apply-input-long_several-chip');
      // The answers typed here are kept in this tab (T271), and the tab is shared by the next size,
      // which would reopen the form on them with no Edit to click. Only the draft goes: the tab's
      // sign-in is kept there too.
      await page.evaluate(() => sessionStorage.removeItem('conventioner.applicationDraft'));
    },
  },
  {
    // A vendor on a market day (ADR 0022): today's seat on top, with the door code's field.
    name: 'the vendor page, on a market day',
    who: 'nobody',
    sizes: PUBLIC,
    open: asAVendorAt(
      'big',
      (today) => [seatOn(today), seatOn('2099-08-22')],
      'vendor-check-in-btn',
    ),
  },
  {
    name: 'the vendor page, checked in',
    who: 'nobody',
    sizes: PUBLIC,
    open: asAVendorAt(
      'big',
      (today) => [seatOn(today, `${today}T09:41:00+00:00`), seatOn('2099-08-22')],
      'vendor-check-in-undo-btn',
    ),
  },
  {
    // Archived after it ran: each seat, and when they came.
    name: 'the vendor page, the record',
    who: 'nobody',
    sizes: PUBLIC,
    open: asAVendorAt(
      'archived',
      () => [seatOn('2099-05-01', '2099-05-01T09:41:00+00:00'), seatOn('2099-05-02')],
      'vendor-check-in-record',
    ),
  },
];

/** One seat, as the vendor's own read lists it. */
function seatOn(date: string, checkedInAt: string | null = null) {
  return {
    date,
    tableCode: 'Indoors 12',
    tableChoice: 'Full Table',
    section: 'Indoors',
    location: 'Indoors - the old cannery warehouse',
    checkedInAt,
  };
}

/**
 * A vendor signed in at `market`'s page, their own read answered with `seats` (today's date given):
 * every sweep opens each state at every size, and a real sign-in each time would pass the limits a
 * caller and an address may sign in by (`sign_in_limits`). The page's own read is the server's.
 */
function asAVendorAt(
  market: 'big' | 'archived',
  seats: (today: string) => ReturnType<typeof seatOn>[],
  ready: string,
) {
  return async (page: Page, seed: TheScreensSeed) => {
    const { marketId, marketSlug } = seed[market];
    const session = {
      marketId,
      marketSlug,
      applicantEmail: 'vendor0@example.com',
      token: 'a-sweep-sign-in',
    };
    await page.addInitScript(
      (kept) => sessionStorage.setItem('conventioner.applicantSession', kept),
      JSON.stringify(session),
    );
    const application = {
      id: 'sweep-application',
      marketId,
      applicantEmail: session.applicantEmail,
      status: 'open',
      applicationType: 'main',
      submittedAt: '2099-06-01T00:00:00+00:00',
      updatedAt: '2099-06-01T00:00:00+00:00',
      outcome: 'has_a_table',
      seats: seats(calendarToday()),
      vendorName: 'Maximilian Alexander Featherstonehaugh-Montgomery',
    };
    await page.route(`**/public/markets/${marketSlug}/applicant/application`, (route) =>
      route.fulfill({ json: { application } }),
    );
    await page.goto(`/${marketSlug}`);
    await visible(page, ready);
  };
}

/** Two questions of more than 12 options, one choice and several, both unanswered and required. */
const LONG_QUESTIONS = (['long_one', 'long_several'] as const).map((key, at) => ({
  key,
  label: at === 0 ? 'What do you sell most of?' : 'Which clubs do you belong to?',
  type: at === 0 ? 'select' : 'multi_select',
  required: true,
  options: Array.from({ length: 60 }, (_, option) => `Answer ${option + 1}`),
  order: 100 + at,
}));

/** Signs the page's browser in as `who`, over the API: the sign-in pages are screens of their own. */
export async function signIn(page: Page, who: Who, seed: TheScreensSeed): Promise<void> {
  if (who === 'nobody') return;
  if (who === 'applicant') {
    // A code planted as the email would carry it, used once, so each sign-in plants its own.
    const email = seed.applicant.email;
    createApplicantLoginChallenge(seed.open.marketId, email, '424242');
    const res = await page.request.post(
      `${APP_API}/public/markets/${seed.open.marketSlug}/applicant-login/verify-code`,
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
  const user = { organizer: TEST_USER, editor: SCREENS_EDITOR, 'no organization': NO_ORG_USER }[
    who
  ];
  // At the page's own address for the API (`APP_API`), as its sign-in page would sign in.
  await loginViaApi(page.request, APP_API, user.email, user.password);
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
    // A copy, since screens share their sizes' arrays and `alsoAt` adds to it.
    const sizes = everySize ? [...s.sizes] : s.sizes.slice(0, 1);
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

/**
 * Opens a screen and lets it come to rest: its requests answered, its fonts loaded and its
 * transitions run. A row can draw before its name arrives on a second request (a payments row's
 * name and address come from the market's tables), so a sweep that measured it then would hold the
 * one-line box and judge the two-line box that follows as focus resizing it.
 */
export async function openScreen(page: Page, s: Screen, seed: TheScreensSeed): Promise<void> {
  await s.open(page, seed);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
}
