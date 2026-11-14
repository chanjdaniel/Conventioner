/**
 * The door's roster stays fresh (T318): Attendance reads itself again while it is in view.
 *
 * It was read on load and after the organizer's own tap, so a vendor who scanned themselves in, or
 * a second organizer's check-in, showed only after the next tap or a reload, and "who is missing"
 * was stale at exactly the moment it was asked. Two taps close together ran two unguarded re-reads,
 * the older could land last and show a vendor just checked in as not here, and one row at a time
 * was held busy.
 *
 * Now it reads every `REREAD_MS` while the tab is in view, at once when the tab comes back or the
 * browser comes back online, only the newest read lands, a write's answer shows on its row at once,
 * and each row is held busy on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { reactive, ref } from 'vue';

import AttendanceStatusView, { REREAD_MS } from '@/views/AttendanceStatusView.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { calendarToday } from '@/utils/marketGuide';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: ref(marketNow), status: ref('loaded'), refresh: vi.fn() }),
}));
vi.mock('@/utils/vendorDetails', () => ({
  useVendorDetails: () => ({ loaded: { value: false }, load: vi.fn() }),
}));

const route = reactive({ params: { marketId: 'market-1' }, query: {} });

const ORGANIZER = 'org@example.com';
const ANA = 'ana@example.com';
const BEN = 'ben@example.com';
const TODAY = calendarToday();
const ARRIVED = '2099-08-01T09:41:00Z';

const MARKET = {
  id: 'market-1',
  name: 'Spring Market',
  phase: MarketPhase.MarketDays,
  actionRefusals: answersRefusing(),
} as unknown as Market;
/** The market the page opens, `MARKET` unless a test says. */
let marketNow: Market = MARKET;

interface Row {
  date: string;
  vendorEmail: string;
  vendorName: string;
  tableCode: string | null;
  tableChoice: string | null;
  section: string | null;
  location: string | null;
  state: 'expected' | 'here' | 'here_elsewhere' | 'here_without_seat';
  checkedInTableCode: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkedInVia: string | null;
}

function row(email: string, tableCode: string, arrived: Partial<Row> = {}): Row {
  return {
    date: TODAY,
    vendorEmail: email,
    vendorName: '',
    tableCode,
    tableChoice: 'Full Table',
    section: 'Main Hall',
    location: 'Main Hall',
    state: arrived.checkedInAt ? 'here' : 'expected',
    checkedInTableCode: arrived.checkedInAt ? tableCode : null,
    checkedInAt: null,
    checkedInBy: null,
    checkedInVia: null,
    ...arrived,
  };
}

/** A vendor checked in on `TODAY` at `madeAt`, who holds no table that day (T318). */
function seatless(email: string, madeAt: string): Row {
  return row(email, '', {
    tableCode: null,
    tableChoice: null,
    section: null,
    location: null,
    state: 'here_without_seat',
    checkedInTableCode: madeAt,
    checkedInAt: ARRIVED,
    checkedInVia: 'door_code',
  });
}

/** The roster as the server serves it, nobody in yet unless a test says. */
function roster(...arrived: { email: string; via?: string }[]) {
  const here = new Map(arrived.map((one) => [one.email, one.via ?? null]));
  const answer = (email: string, table: string) =>
    here.has(email)
      ? row(email, table, { checkedInAt: ARRIVED, checkedInVia: here.get(email) ?? null })
      : row(email, table);
  return { data: { dates: [TODAY], roster: [answer(ANA, 'A1'), answer(BEN, 'A2')] } };
}

/** The calendar day `days` from `TODAY`, as the roster dates them. */
function dayFromToday(days: number): string {
  const [year, month, day] = TODAY.split('-').map(Number) as [number, number, number];
  return calendarToday(new Date(year, month - 1, day + days));
}

const ROSTER_URL = '/markets/market-1/attendance';

function rosterReads(): number {
  return api.get.mock.calls.filter(([url]) => url === ROSTER_URL).length;
}

/** A promise the test settles when it chooses, to hold a request in flight. */
function held<T>() {
  let settle!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/** Every roster read from here on answers with the next of `answers`, then the last forever. */
function serveRoster(...answers: (() => Promise<unknown>)[]) {
  let next = 0;
  api.get.mockImplementation((url: string) => {
    if (url !== ROSTER_URL) return Promise.resolve({ data: {} });
    const answer = answers[Math.min(next, answers.length - 1)]!;
    next += 1;
    return answer();
  });
}

const offline = () => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK'));

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

async function open(): Promise<VueWrapper> {
  const wrapper = mount(AttendanceStatusView, {
    attachTo: document.body,
    global: {
      stubs: {
        MarketFrame: { template: '<div><slot /></div>' },
        VendorDrawer: true,
        DoorCodeScreen: true,
        VendorNotes: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function status(wrapper: VueWrapper, email: string): string {
  return wrapper
    .get(`[data-testid="attendance-row"][data-vendor="${email}"]`)
    .get('[data-testid="attendance-row-status"]')
    .text();
}

function checkIn(wrapper: VueWrapper, email: string) {
  return wrapper.get(
    `[data-testid="attendance-row"][data-vendor="${email}"] [data-testid="attendance-check-in"]`,
  );
}

enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.resetAllMocks();
  route.query = {};
  marketNow = MARKET;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  localStorage.setItem('user', JSON.stringify({ email: ORGANIZER }));
  serveRoster(() => Promise.resolve(roster()));
});

afterEach(() => {
  // Fake timers freeze `performance.now`, which later tests read.
  vi.useRealTimers();
  localStorage.clear();
});

describe('the roster reads itself again', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });

  it('every 15 seconds while the page is in view, and not while it is hidden', async () => {
    expect(REREAD_MS).toBe(15_000);
    const wrapper = await open();
    expect(rosterReads()).toBe(1);
    expect(status(wrapper, ANA)).toBe('Not yet');

    // The vendor scans themselves in; the open page shows it with no tap.
    serveRoster(() => Promise.resolve(roster({ email: ANA, via: 'door_code' })));
    await vi.advanceTimersByTimeAsync(REREAD_MS);
    expect(rosterReads()).toBe(2);
    expect(status(wrapper, ANA)).toMatch(/^Scanned in at /);

    // A phone in a pocket spends nothing.
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(4 * REREAD_MS);
    expect(rosterReads()).toBe(2);
  });

  it('at once when the tab comes back into view', async () => {
    await open();
    setVisibility('hidden');
    await flushPromises();
    expect(rosterReads()).toBe(1);

    setVisibility('visible');
    await flushPromises();
    expect(rosterReads()).toBe(2);
  });

  it('at once when the browser comes back online', async () => {
    await open();
    window.dispatchEvent(new Event('online'));
    await flushPromises();
    expect(rosterReads()).toBe(2);
  });

  it('never twice at once from the clock', async () => {
    await open();
    const slow = held<unknown>();
    serveRoster(() => slow.promise);
    await vi.advanceTimersByTimeAsync(REREAD_MS);
    expect(rosterReads()).toBe(2);

    await vi.advanceTimersByTimeAsync(2 * REREAD_MS);
    expect(rosterReads()).toBe(2);

    slow.settle(roster());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(REREAD_MS);
    expect(rosterReads()).toBe(3);
  });

  it('stops when the page is left', async () => {
    const wrapper = await open();
    wrapper.unmount();

    await vi.advanceTimersByTimeAsync(3 * REREAD_MS);
    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    await flushPromises();
    expect(rosterReads()).toBe(1);
  });
});

describe('only the newest answer lands', () => {
  it('an older read answering after a newer one changes nothing', async () => {
    const wrapper = await open();
    const older = held<unknown>();
    const newer = held<unknown>();
    serveRoster(
      () => older.promise,
      () => newer.promise,
    );
    window.dispatchEvent(new Event('online'));
    setVisibility('visible');
    await flushPromises();
    expect(rosterReads()).toBe(3);

    newer.settle(roster({ email: ANA, via: 'door_code' }));
    await flushPromises();
    expect(status(wrapper, ANA)).toMatch(/^Scanned in at /);

    older.settle(roster());
    await flushPromises();
    expect(status(wrapper, ANA)).toMatch(/^Scanned in at /);
  });

  it("an older read answering after a write's answer changes nothing", async () => {
    const wrapper = await open();
    const older = held<unknown>();
    const after = held<unknown>();
    serveRoster(
      () => older.promise,
      () => after.promise,
    );
    window.dispatchEvent(new Event('online'));
    await flushPromises();

    api.post.mockResolvedValue({ data: { message: 'Checked in', checkedInAt: ARRIVED } });
    await checkIn(wrapper, ANA).trigger('click');
    await flushPromises();
    expect(status(wrapper, ANA)).toMatch(/ by you$/);

    // The read asked before the write answers last, with the roster from before it.
    older.settle(roster());
    await flushPromises();
    expect(status(wrapper, ANA)).toMatch(/ by you$/);
    // ...and the read the write asked for still lands.
    after.settle(roster({ email: BEN, via: 'door_code' }));
    await flushPromises();
    expect(status(wrapper, BEN)).toMatch(/^Scanned in at /);
  });
});

describe('a check-in', () => {
  it("shows on its row from the server's answer, with no wait for the re-read", async () => {
    const wrapper = await open();
    serveRoster(() => new Promise(() => {}));
    api.post.mockResolvedValue({ data: { message: 'Checked in', checkedInAt: ARRIVED } });

    await checkIn(wrapper, ANA).trigger('click');
    await flushPromises();
    expect(status(wrapper, ANA)).toMatch(/ by you$/);
    expect(wrapper.get('[data-testid="attendance-summary"]').text()).toBe('1 of 2 checked in');
    expect(rosterReads()).toBe(2);

    // Undo patches it back, as its answer says.
    api.delete.mockResolvedValue({ data: { message: 'Check-in undone' } });
    await wrapper
      .get(`[data-testid="attendance-row"][data-vendor="${ANA}"] [data-testid="attendance-undo"]`)
      .trigger('click');
    await flushPromises();
    expect(status(wrapper, ANA)).toBe('Not yet');
  });

  it('on two rows at once: each held busy only while its own write is out', async () => {
    const wrapper = await open();
    serveRoster(() => new Promise(() => {}));
    const forAna = held<unknown>();
    const forBen = held<unknown>();
    api.post.mockImplementation((_url: string, body: { vendorEmail: string }) =>
      body.vendorEmail === ANA ? forAna.promise : forBen.promise,
    );

    await checkIn(wrapper, ANA).trigger('click');
    expect(checkIn(wrapper, ANA).attributes('disabled')).toBeDefined();
    expect(checkIn(wrapper, BEN).attributes('disabled')).toBeUndefined();
    await checkIn(wrapper, BEN).trigger('click');
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(checkIn(wrapper, BEN).attributes('disabled')).toBeDefined();

    forBen.settle({ data: { message: 'Checked in', checkedInAt: ARRIVED } });
    await flushPromises();
    expect(status(wrapper, BEN)).toMatch(/ by you$/);
    expect(checkIn(wrapper, ANA).attributes('disabled')).toBeDefined();

    forAna.settle({ data: { message: 'Checked in', checkedInAt: ARRIVED } });
    await flushPromises();
    expect(status(wrapper, ANA)).toMatch(/ by you$/);
    expect(wrapper.get('[data-testid="attendance-summary"]').text()).toBe('2 of 2 checked in');
  });
});

describe('when a read fails', () => {
  it('a later read failing keeps the rows and says so, and the next read clears it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const wrapper = await open();
    serveRoster(offline);
    await vi.advanceTimersByTimeAsync(REREAD_MS);

    expect(wrapper.findAll('[data-testid="attendance-row"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="attendance-refresh-error"]').text()).toBe(
      'Could not update. The roster is as it was last read.',
    );
    expect(wrapper.find('[data-testid="attendance-read-failed"]').exists()).toBe(false);

    serveRoster(() => Promise.resolve(roster({ email: ANA, via: 'door_code' })));
    await vi.advanceTimersByTimeAsync(REREAD_MS);
    expect(wrapper.find('[data-testid="attendance-refresh-error"]').exists()).toBe(false);
    expect(status(wrapper, ANA)).toMatch(/^Scanned in at /);
  });

  it('a failed Refresh says so too', async () => {
    const wrapper = await open();
    serveRoster(offline);
    await wrapper.get('[data-testid="attendance-refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="attendance-refresh-error"]').text()).toBe(
      'Could not update. The roster is as it was last read.',
    );
    expect(wrapper.findAll('[data-testid="attendance-row"]')).toHaveLength(2);
  });

  it('the first read failing is still the page that could not be read, with Try again', async () => {
    serveRoster(offline, () => Promise.resolve(roster()));
    const wrapper = await open();
    expect(wrapper.find('[data-testid="attendance-read-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="attendance-refresh"]').exists()).toBe(false);

    await wrapper.get('[data-testid="attendance-retry"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="attendance-read-failed"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="attendance-row"]')).toHaveLength(2);
  });
});

describe('when it was read', () => {
  it('is said at the end of the top row, before Door code, with Refresh, which reads at once', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const wrapper = await open();
    expect(wrapper.get('[data-testid="attendance-updated"]').text()).toBe('Updated just now');

    const top = wrapper.get('.door-top');
    const testids = top.findAll('[data-testid]').map((el) => el.attributes('data-testid'));
    expect(testids.indexOf('attendance-refresh')).toBeLessThan(
      testids.indexOf('attendance-door-code'),
    );
    expect(testids.indexOf('attendance-updated')).toBeGreaterThan(
      testids.indexOf(`attendance-date-${TODAY}`),
    );

    // Hidden, it reads nothing, and the time it says ages.
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(wrapper.get('[data-testid="attendance-updated"]').text()).toBe('Updated 2 minutes ago');
    setVisibility('visible');
    await flushPromises();
    expect(wrapper.get('[data-testid="attendance-updated"]').text()).toBe('Updated just now');

    const before = rosterReads();
    await wrapper.get('[data-testid="attendance-refresh"]').trigger('click');
    await flushPromises();
    expect(rosterReads()).toBe(before + 1);
  });
});

describe('where each vendor stands (T318)', () => {
  const CY = 'cy@example.com';

  function chip(wrapper: VueWrapper, email: string) {
    return wrapper
      .get(`[data-testid="attendance-row"][data-vendor="${email}"]`)
      .get('[data-testid="attendance-row-status"]');
  }

  function table(wrapper: VueWrapper, email: string): string {
    return wrapper
      .get(`[data-testid="attendance-row"][data-vendor="${email}"]`)
      .get('[data-testid="attendance-row-table"]')
      .text();
  }

  it('a vendor here at another table than the one they hold says where, in attention', async () => {
    serveRoster(() =>
      Promise.resolve({
        data: {
          dates: [TODAY],
          roster: [
            row(ANA, 'A1', {
              state: 'here_elsewhere',
              checkedInTableCode: 'A7',
              checkedInAt: ARRIVED,
              checkedInVia: 'door_code',
            }),
            row(BEN, 'A2', { checkedInAt: ARRIVED }),
          ],
        },
      }),
    );
    const wrapper = await open();

    expect(chip(wrapper, ANA).text()).toMatch(/^Scanned in at .+, at table\u00a0A7$/);
    expect(chip(wrapper, ANA).classes()).toContain('chip--attention');
    expect(table(wrapper, ANA)).toBe('Table A1, a whole table');
    expect(chip(wrapper, BEN).classes()).toContain('chip--positive');
    expect(wrapper.get('[data-testid="attendance-summary"]').text()).toBe('2 of 2 checked in');
  });

  it('the table they checked in at is never broken across lines, on screen or on paper', async () => {
    serveRoster(() =>
      Promise.resolve({
        data: {
          dates: [TODAY],
          roster: [
            row(ANA, 'A1', {
              state: 'here_elsewhere',
              checkedInTableCode: 'Hall B 12',
              checkedInAt: ARRIVED,
            }),
          ],
        },
      }),
    );
    const wrapper = await open();

    // "table Hall B 12" is one unbreakable run: a no-break space between each of its words. The
    // sheet is teleported to the page's body.
    expect(chip(wrapper, ANA).text()).toMatch(/, at table\u00a0Hall\u00a0B\u00a012$/);
    expect(document.querySelector('[data-testid="attendance-print-here"]')?.textContent).toMatch(
      /, at table\u00a0Hall\u00a0B\u00a012$/,
    );
  });

  it('a vendor here with no table that day is listed under the seated rows, counted apart', async () => {
    serveRoster(() =>
      Promise.resolve({
        data: { dates: [TODAY], roster: [row(ANA, 'A1'), row(BEN, 'A2'), seatless(CY, 'A3')] },
      }),
    );
    const wrapper = await open();

    const vendors = wrapper
      .findAll('[data-testid="attendance-row"]')
      .map((r) => r.attributes('data-vendor'));
    expect(vendors).toEqual([ANA, BEN, CY]);
    const heading = wrapper.get('[data-testid="attendance-unseated-heading"]');
    expect(heading.text()).toBe('Checked in, with no table on this date (1)');
    expect(table(wrapper, CY)).toBe('No table');
    expect(chip(wrapper, CY).text()).toMatch(/^Scanned in at /);
    expect(chip(wrapper, CY).classes()).toContain('chip--attention');
    expect(
      wrapper
        .find(`[data-testid="attendance-row"][data-vendor="${CY}"] [data-testid="attendance-undo"]`)
        .exists(),
    ).toBe(true);
    // The tally and the toggles count the day's seats only.
    expect(wrapper.get('[data-testid="attendance-summary"]').text()).toBe('0 of 2 checked in');
    expect(wrapper.get('[data-testid="attendance-show-all"]').text()).toBe('All 2');
    expect(wrapper.get('[data-testid="attendance-show-not-yet"]').text()).toBe('Not yet 2');
    expect(wrapper.get('[data-testid="attendance-show-here"]').text()).toBe('Checked in 0');

    await wrapper.get('[data-testid="attendance-show-not-yet"]').trigger('click');
    expect(wrapper.find(`[data-testid="attendance-row"][data-vendor="${CY}"]`).exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="attendance-unseated-heading"]').exists()).toBe(false);

    await wrapper.get('[data-testid="attendance-show-here"]').trigger('click');
    expect(wrapper.find(`[data-testid="attendance-row"][data-vendor="${CY}"]`).exists()).toBe(true);
    expect(wrapper.find(`[data-testid="attendance-row"][data-vendor="${ANA}"]`).exists()).toBe(
      false,
    );
  });

  it('a day with no seats still lists who checked in without one', async () => {
    serveRoster(() => Promise.resolve({ data: { dates: [TODAY], roster: [seatless(CY, 'A3')] } }));
    const wrapper = await open();

    expect(wrapper.text()).not.toContain('Nobody is assigned on this date.');
    expect(wrapper.find(`[data-testid="attendance-row"][data-vendor="${CY}"]`).exists()).toBe(true);
  });

  it("undoing a check-in with no table takes the row away on the server's answer", async () => {
    serveRoster(() =>
      Promise.resolve({ data: { dates: [TODAY], roster: [row(ANA, 'A1'), seatless(CY, 'A3')] } }),
    );
    const wrapper = await open();
    serveRoster(() => new Promise(() => {}));
    api.delete.mockResolvedValue({ data: { message: 'Check-in undone' } });

    await wrapper
      .get(`[data-testid="attendance-row"][data-vendor="${CY}"] [data-testid="attendance-undo"]`)
      .trigger('click');
    await flushPromises();

    expect(wrapper.find(`[data-testid="attendance-row"][data-vendor="${CY}"]`).exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="attendance-unseated-heading"]').exists()).toBe(false);
  });

  it("a check-in reads as here at the vendor's table on the server's answer", async () => {
    serveRoster(() =>
      Promise.resolve({
        data: {
          dates: [TODAY],
          roster: [
            row(ANA, 'A1', {
              state: 'here_elsewhere',
              checkedInTableCode: 'A7',
              checkedInAt: ARRIVED,
            }),
          ],
        },
      }),
    );
    const wrapper = await open();
    serveRoster(() => new Promise(() => {}));
    api.delete.mockResolvedValue({ data: { message: 'Check-in undone' } });
    api.post.mockResolvedValue({ data: { message: 'Checked in', checkedInAt: ARRIVED } });

    await wrapper
      .get(`[data-testid="attendance-row"][data-vendor="${ANA}"] [data-testid="attendance-undo"]`)
      .trigger('click');
    await flushPromises();
    expect(chip(wrapper, ANA).text()).toBe('Not yet');
    await checkIn(wrapper, ANA).trigger('click');
    await flushPromises();

    expect(chip(wrapper, ANA).text()).toMatch(/ by you$/);
    expect(chip(wrapper, ANA).classes()).toContain('chip--positive');
  });

  it.each([
    ['today', 0, true],
    ['a past day', -1, true],
    ['a day to come', 1, false],
  ])('on %s, offers Check in: %s', async (_name, days, offered) => {
    const day = dayFromToday(days);
    route.query = { date: day };
    serveRoster(() =>
      Promise.resolve({
        data: {
          dates: [dayFromToday(-1), TODAY, dayFromToday(1)],
          roster: [{ ...row(ANA, 'A1'), date: day }],
        },
      }),
    );
    const wrapper = await open();

    expect(wrapper.find('[data-testid="attendance-check-in"]').exists()).toBe(offered);
    expect(wrapper.find(`[data-testid="attendance-row"][data-vendor="${ANA}"]`).exists()).toBe(
      true,
    );
  });

  it('offers Undo on a day to come, wherever there is a check-in', async () => {
    const day = dayFromToday(1);
    route.query = { date: day };
    serveRoster(() =>
      Promise.resolve({
        data: {
          dates: [TODAY, day],
          roster: [{ ...row(ANA, 'A1', { checkedInAt: ARRIVED }), date: day }],
        },
      }),
    );
    const wrapper = await open();

    expect(wrapper.find('[data-testid="attendance-undo"]').exists()).toBe(true);
  });
});

/*
 * A paper roster is the door's only fallback when the venue's network or the back end fails, and
 * nothing prompted the organizer to keep one (T318).
 */
describe('printing the roster (T318)', () => {
  const NOTE =
    "If the venue's network fails, a printed roster still works. Print this day's roster before the doors open.";

  function onDay(days: number) {
    const day = dayFromToday(days);
    route.query = { date: day };
    serveRoster(() =>
      Promise.resolve({
        data: {
          dates: [dayFromToday(-1), TODAY, dayFromToday(1)],
          roster: [{ ...row(ANA, 'A1'), date: day }],
        },
      }),
    );
  }

  it('Print roster stands in the top row, before Door code, and prints', async () => {
    // happy-dom has no `window.print`.
    const print = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, value: print });
    const wrapper = await open();

    const top = wrapper.get('.door-top');
    const testids = top.findAll('[data-testid]').map((el) => el.attributes('data-testid'));
    expect(testids).toContain('attendance-print');
    expect(testids.indexOf('attendance-print')).toBeLessThan(
      testids.indexOf('attendance-door-code'),
    );
    expect(wrapper.get('[data-testid="attendance-print"]').text()).toBe('Print roster');

    await wrapper.get('[data-testid="attendance-print"]').trigger('click');
    expect(print).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(window, 'print');
  });

  it.each([
    ['a Viewer', { ...MARKET, actionRefusals: VIEWER_ANSWERS }],
    ['an archived market', { ...MARKET, phase: MarketPhase.Archived }],
  ])('is offered to %s too', async (_name, market) => {
    marketNow = market as Market;
    const wrapper = await open();
    expect(wrapper.find('[data-testid="attendance-print"]').exists()).toBe(true);
  });

  it('is not offered before the market has dates', async () => {
    serveRoster(() => Promise.resolve({ data: { dates: [], roster: [] } }));
    const wrapper = await open();
    expect(wrapper.find('[data-testid="attendance-print"]').exists()).toBe(false);
  });

  it.each([
    ['today', 0, true],
    ['a day to come', 1, true],
    ['a past day', -1, false],
  ])('the note to print shows on %s: %s', async (_name, days, shown) => {
    onDay(days);
    const wrapper = await open();
    const note = wrapper.find('[data-testid="attendance-print-note"]');
    expect(note.exists()).toBe(shown);
    if (shown) expect(note.text()).toBe(NOTE);
  });

  it('the note never shows on an archived market', async () => {
    marketNow = { ...MARKET, phase: MarketPhase.Archived } as Market;
    onDay(0);
    const wrapper = await open();
    expect(wrapper.find('[data-testid="attendance-print-note"]').exists()).toBe(false);
  });
});
