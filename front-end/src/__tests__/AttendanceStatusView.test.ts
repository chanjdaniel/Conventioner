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
import { answersRefusing } from './support/servedAnswers';

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
  useOpenMarket: () => ({ market: ref(MARKET), status: ref('loaded'), refresh: vi.fn() }),
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

interface Row {
  date: string;
  vendorEmail: string;
  vendorName: string;
  tableCode: string;
  tableChoice: string;
  section: string;
  location: string;
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
    checkedInAt: null,
    checkedInBy: null,
    checkedInVia: null,
    ...arrived,
  };
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
