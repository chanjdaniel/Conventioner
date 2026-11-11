import { type APIRequestContext, type Page, type Request, type Response } from '@playwright/test';
import { BACKEND_URL, TEST_USER, expect } from '../fixtures';
import { ManageMarketPage } from '../pages/ManageMarketPage';
import { OrganizationsPage } from '../pages/OrganizationsPage';
import { detectLayout, gates, minTargetAt, SPACE_SCALE, TYPE_SCALE } from './layoutDetectors';
import { mongoEval } from './mongo';
import { widths } from './phoneWindow';
import { seedApplicationWithStatus, seedPhaseMarket, transitionMarket } from './seedPhaseMarket';
import { loginViaApi } from './seeds';
import { uniqueMarketName } from './uniqueName';

/**
 * What the people-at-scale specs share (T204): a market of one person to measure the seed's
 * against, the way to Manage market and Manage organization, the API requests and the database's
 * reads of `users` a screen's opening makes, and the layout check every width runs. The seed of
 * 150 people itself is `seedPeopleAtScale`.
 */

/** A market like the seed's, in an organization whose only person is the seed owner. */
export async function seedOnePersonMarket(request: APIRequestContext) {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const org = await request.post(`${BACKEND_URL}/organizations`, {
    data: { name: uniqueMarketName('Example One Person Org') },
  });
  expect(org.ok(), await org.text()).toBeTruthy();
  const orgId = (await org.json()).organization_id as string;
  const market = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
    orgId,
  });
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, market.marketId, 'applications');
  for (let n = 1; n <= 5; n++) {
    seedApplicationWithStatus(market.marketId, 'open', `one-person-applicant-${n}@example.com`);
  }
  return { ...market, orgId };
}

/** The Markets page, narrowed to one market, its Manage button ready. */
export async function toTheMarket(page: Page, marketName: string) {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await expect(page.getByTestId('market-card-manage-button')).toHaveCount(1);
}

export async function openManage(page: Page): Promise<ManageMarketPage> {
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

/**
 * Until no request has been in flight for a moment, so a request made late is still counted. `out`
 * holds each API request still out with the time it was sent, so a wait that times out names each
 * one and how long it has been out, the stall's cause (T263).
 */
async function quiet(out: Map<Request, number>): Promise<void> {
  let stillSince = Date.now();
  await expect
    .poll(
      () => {
        const now = Date.now();
        if (out.size > 0) stillSince = now;
        if (now - stillSince >= 750) return 'quiet';
        if (!out.size) return `the last request ended ${now - stillSince}ms ago`;
        const named = [...out].map(([request, sent]) => {
          const { pathname, search } = new URL(request.url());
          return `${request.method()} ${pathname}${search} for ${now - sent}ms`;
        });
        return `still open: ${named.join('; ')}`;
      },
      { message: 'the API went quiet', intervals: [100], timeout: 15_000 },
    )
    .toBe('quiet');
}

/**
 * The API requests the browser makes while `open` runs, each as its method and path, the ids
 * named in `ids` read as their names, so two markets' openings compare.
 */
export async function requestsWhile(
  page: Page,
  ids: Record<string, string>,
  open: () => Promise<void>,
): Promise<string[]> {
  const made: string[] = [];
  const out = new Map<Request, number>();
  const sent = (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    out.set(request, Date.now());
    let path = url.pathname;
    for (const [name, id] of Object.entries(ids)) path = path.replaceAll(id, `<${name}>`);
    made.push(`${request.method()} ${path}`);
  };
  const done = (request: Request) => {
    out.delete(request);
  };
  // A new document in the page (a reload, a `goto`) drops the requests the old one still had out,
  // and Playwright then reports neither their end nor their failure, so the wait would hold them
  // open for good (T284). They leave the wait as the new document's answer arrives, before it
  // sends a request of its own.
  const arrived = (response: Response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) out.clear();
  };
  page.on('request', sent);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.on('response', arrived);
  try {
    await open();
    await quiet(out);
  } finally {
    page.off('request', sent);
    page.off('requestfinished', done);
    page.off('requestfailed', done);
    page.off('response', arrived);
  }
  return made.sort();
}

export interface ProfiledRead {
  op: string;
  filter: unknown;
}

/**
 * The reads of `users` the database makes while `act` runs, by MongoDB's own profiler, on for
 * that collection alone and turned off however `act` ends. The suite runs one worker, so no other
 * spec reads in between.
 */
export async function usersReadsWhile(act: () => Promise<void>): Promise<ProfiledRead[]> {
  try {
    mongoEval(
      'db.setProfilingLevel(0); db.system.profile.drop(); ' +
        'db.setProfilingLevel(2, { filter: { ns: db.getName() + ".users" } })',
    );
    await act();
    return JSON.parse(
      mongoEval(
        'EJSON.stringify(db.system.profile.find({ ns: db.getName() + ".users" }).toArray()' +
          '.map((entry) => ({ op: entry.op, filter: (entry.command || {}).filter ?? (entry.command || {}).q ?? null })))',
      ),
    ) as ProfiledRead[];
  } finally {
    profilerOff();
  }
}

/**
 * The profiler off and its filter unset: a filter, once set, outlives the level and decides
 * which operations the slow-query log writes, in place of `slowms`, until it is unset.
 */
function profilerOff(): void {
  mongoEval("db.setProfilingLevel(0, { filter: 'unset' }); db.system.profile.drop()");
}

/**
 * The reads a screen's opening made, each one a database round trip of its own: a `getmore`, the
 * rest of a cursor's answer past its first batch, is the same read going on. A read per person,
 * whatever its filter (by `id`, `email`, `_id` or `$eq`), shows here as one more per person.
 */
export function readsMade(reads: ProfiledRead[]): ProfiledRead[] {
  return reads.filter((read) => read.op !== 'getmore');
}

/**
 * The ids a read's filter names by `id`: alone, or in an `$in`. A `getmore`, the rest of a cursor's
 * answer past its first batch, names none: it is the same read going on.
 */
export function idsNamed(read: ProfiledRead): { alone: string | null; batch: string[] } {
  const byId = (read.filter as { id?: unknown } | null)?.id;
  if (typeof byId === 'string') return { alone: byId, batch: [] };
  const batch = (byId as { $in?: unknown } | undefined)?.$in;
  return { alone: null, batch: Array.isArray(batch) ? (batch as string[]) : [] };
}

/** Nothing scrolls sideways at the window's width, and the detectors find nothing clipped. */
export async function expectLaidOut(page: Page, what: string): Promise<void> {
  const { width } = page.viewportSize()!;
  expect(await widths(page), `${what} keeps the window's width`).toEqual({
    layout: width,
    sideways: 0,
    zoom: 1,
  });
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  expect(
    findings.filter((finding) => gates(finding, width)),
    `${what}: the layout detectors' gating findings`,
  ).toEqual([]);
}

/** The rows a list frame draws before "Show N more". */
export const PAGE = 50;

/**
 * Manage organization opened from its address, as Manage market's "Manage organization" opens it:
 * the Organizations page reads the reader's organizations, then opens the one named.
 */
export async function openManageOrganization(
  page: Page,
  orgId: string,
  people: { admins: number; members: number },
): Promise<OrganizationsPage> {
  await page.goto(`/organizations?manage=${encodeURIComponent(orgId)}`);
  const orgs = new OrganizationsPage(page);
  await expect(orgs.manageWindow).toBeVisible();
  await expect(orgs.adminEmails).toHaveCount(Math.min(people.admins, PAGE));
  await expect(orgs.memberEmails).toHaveCount(Math.min(people.members, PAGE));
  return orgs;
}
