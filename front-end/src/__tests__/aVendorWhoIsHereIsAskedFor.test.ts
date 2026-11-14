/**
 * Freeing, moving or swapping a vendor who has checked in that day asks first (T318).
 *
 * The server refuses such a change with a 409 coded `vendor_is_here`, whose sentence names who
 * checked in, at which table and for which day, and stores nothing. The Assignments page tells it
 * apart by `isVendorHere`, reads nothing again (nothing changed), and the seat's dialog asks with
 * the server's sentence: "Free anyway", "Move anyway" or "Swap anyway" beside Cancel. Confirming
 * sends the same request again with `whileHere: true`, the free's deduction included. The market's
 * history then says the change was made "while they were checked in".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { AxiosError } from 'axios';
import { reactive, ref } from 'vue';

import PlacementDialog from '@/components/PlacementDialog.vue';
import ResultSeat from '@/components/ResultSeat.vue';
import ResultView from '@/views/ResultView.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { MARKET_CHANGED_CODE, VENDOR_IS_HERE_CODE, isVendorHere } from '@/utils/api';
import { entryParts } from '@/utils/marketHistory';
import { FULL_TABLE, type PlaceableVendor } from '@/utils/placementChange';
import type { MarketTableRow } from '@/utils/resultFilters';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const refreshMarket = vi.hoisted(() => vi.fn());
const details = vi.hoisted(() => ({ loaded: { value: false }, load: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: ref(MARKET), status: ref('loaded'), refresh: refreshMarket }),
}));
vi.mock('@/utils/vendorDetails', () => ({ useVendorDetails: () => details }));

const route = reactive({ params: { marketId: 'market-1' }, query: {} });

const DATE = '2099-05-01';
const ANA = 'ana@example.com';
const BEN = 'ben@example.com';
const HERE = 'Alice checked in at table A3 for May 1, 2099. Their check-in stays recorded there.';
const PLACEMENTS = '/markets/market-1/placements';

const MARKET = {
  id: 'market-1',
  name: 'Spring Market',
  phase: MarketPhase.MarketDays,
  actionRefusals: answersRefusing(),
  setupObject: { marketDates: [{ date: DATE }], sections: [], tiers: [], locations: [] },
  assignmentObject: { vendorAssignments: [] },
} as unknown as Market;

function table(code: string, occupant: string | null): MarketTableRow {
  return {
    date: DATE,
    assignment: occupant ? [occupant] : [],
    assignmentSlots: [occupant, occupant],
    location: 'Main Hall',
    section: 'Main Hall',
    tableChoice: occupant ? 'Full Table' : '',
    tableCode: code,
    tier: 'Gold',
  };
}

function refused(status: number, data: Record<string, unknown>) {
  return Object.assign(new AxiosError('refused'), { response: { status, data } });
}
const askedFirst = () => refused(409, { error: HERE, code: VENDOR_IS_HERE_CODE });

function tablesReads(): number {
  return api.get.mock.calls.filter(([url]) => String(url).endsWith('/tables')).length;
}

/** The Assignments page with Ana at A3, Ben at A4 and A5 empty, on its first read. */
async function thePage() {
  const wrapper = mount(ResultView, {
    global: {
      stubs: {
        MarketFrame: { template: '<div><slot /></div>' },
        ResultSummary: true,
        ResultFilterBar: true,
        VendorDrawer: true,
        PlacementDialog: true,
        ResultSeat: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type Page = Awaited<ReturnType<typeof thePage>>;

/** Open the seat whose holder is `email`, or the empty seat with null. */
async function openSeat(wrapper: Page, email: string | null) {
  const seat = wrapper
    .findAllComponents(ResultSeat)
    .find((candidate) => (candidate.props('email') ?? null) === email);
  seat!.vm.$emit('open');
  await flushPromises();
  return wrapper.findComponent(PlacementDialog);
}

async function emitted(wrapper: Page, event: string, ...args: unknown[]) {
  wrapper.findComponent(PlacementDialog).vm.$emit(event, ...args);
  await flushPromises();
}

enableAutoUnmount(beforeEach);

beforeEach(() => {
  localStorage.setItem('user', JSON.stringify('organizer@example.com'));
  details.loaded.value = false;
  refreshMarket.mockReset();
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/tables')) {
      return {
        data: {
          rows: [table('A3', ANA), table('A4', BEN), table('A5', null)],
          vendorNames: {},
          vendors: [],
        },
      };
    }
    throw new Error(`unexpected read ${url}`);
  });
  api.put.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

describe('isVendorHere', () => {
  it('is a 409 coded vendor_is_here, and nothing else', () => {
    expect(isVendorHere(askedFirst())).toBe(true);
    expect(isVendorHere(refused(409, { error: 'x', code: MARKET_CHANGED_CODE }))).toBe(false);
    expect(isVendorHere(refused(409, { error: 'x' }))).toBe(false);
    expect(isVendorHere(refused(400, { error: 'x', code: VENDOR_IS_HERE_CODE }))).toBe(false);
    expect(isVendorHere(new Error('x'))).toBe(false);
  });
});

describe('the Assignments page, asked first', () => {
  it('asks with the server’s sentence, reads nothing again, and keeps the dialog open', async () => {
    api.delete.mockRejectedValueOnce(askedFirst());
    const wrapper = await thePage();
    await openSeat(wrapper, ANA);

    await emitted(wrapper, 'free', false);

    const dialog = wrapper.findComponent(PlacementDialog);
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('question')).toEqual({ sentence: HERE, change: 'free' });
    expect(dialog.props('errorMessage')).toBe('');
    expect(dialog.props('busy')).toBe(false);
    expect(tablesReads()).toBe(1);
    expect(refreshMarket).not.toHaveBeenCalled();
    expect(details.load).not.toHaveBeenCalled();
  });

  it('frees anyway with whileHere, the deduction carried, and closes', async () => {
    api.delete.mockRejectedValueOnce(askedFirst()).mockResolvedValueOnce({ data: { removed: 1 } });
    const wrapper = await thePage();
    await openSeat(wrapper, ANA);
    await emitted(wrapper, 'free', true);

    await emitted(wrapper, 'anyway');

    expect(api.delete.mock.calls).toEqual([
      [PLACEMENTS, { data: { email: ANA, date: DATE, deductOwed: true } }],
      [PLACEMENTS, { data: { email: ANA, date: DATE, deductOwed: true, whileHere: true } }],
    ]);
    expect(wrapper.findComponent(PlacementDialog).exists()).toBe(false);
    expect(tablesReads()).toBe(2);
  });

  it('moves anyway: the occupant to an empty seat', async () => {
    api.put.mockRejectedValueOnce(askedFirst()).mockResolvedValueOnce({ data: {} });
    const wrapper = await thePage();
    await openSeat(wrapper, ANA);
    await emitted(wrapper, 'move', { tableCode: 'A5', seat: FULL_TABLE });
    expect(wrapper.findComponent(PlacementDialog).props('question')).toEqual({
      sentence: HERE,
      change: 'move',
    });

    await emitted(wrapper, 'anyway');

    const body = { email: ANA, date: DATE, tableCode: 'A5', tableChoice: FULL_TABLE };
    expect(api.put.mock.calls).toEqual([
      [PLACEMENTS, body],
      [PLACEMENTS, { ...body, whileHere: true }],
    ]);
  });

  it('moves anyway: a vendor seated elsewhere, chosen for an empty seat', async () => {
    api.put.mockRejectedValueOnce(askedFirst()).mockResolvedValueOnce({ data: {} });
    const wrapper = await thePage();
    await openSeat(wrapper, null);
    await emitted(wrapper, 'place', { email: ANA, seat: FULL_TABLE });
    expect(wrapper.findComponent(PlacementDialog).props('question')).toEqual({
      sentence: HERE,
      change: 'move',
    });

    await emitted(wrapper, 'anyway');

    expect(api.put).toHaveBeenLastCalledWith(PLACEMENTS, {
      email: ANA,
      date: DATE,
      tableCode: 'A5',
      tableChoice: FULL_TABLE,
      whileHere: true,
    });
  });

  it('swaps anyway', async () => {
    api.post.mockRejectedValueOnce(askedFirst()).mockResolvedValueOnce({ data: {} });
    const wrapper = await thePage();
    await openSeat(wrapper, ANA);
    await emitted(wrapper, 'swap', BEN);
    expect(wrapper.findComponent(PlacementDialog).props('question')).toEqual({
      sentence: HERE,
      change: 'swap',
    });

    await emitted(wrapper, 'anyway');

    expect(api.post.mock.calls).toEqual([
      [`${PLACEMENTS}/swap`, { date: DATE, emails: [ANA, BEN] }],
      [`${PLACEMENTS}/swap`, { date: DATE, emails: [ANA, BEN], whileHere: true }],
    ]);
  });

  it('asks nothing again once confirmed: a second refusal is said as an error', async () => {
    const changed = 'This market changed while you were working on it.';
    api.delete
      .mockRejectedValueOnce(askedFirst())
      .mockRejectedValueOnce(refused(409, { error: changed, code: MARKET_CHANGED_CODE }));
    const wrapper = await thePage();
    await openSeat(wrapper, ANA);
    await emitted(wrapper, 'free', false);

    await emitted(wrapper, 'anyway');

    const dialog = wrapper.findComponent(PlacementDialog);
    expect(dialog.props('question')).toBeNull();
    expect(dialog.props('errorMessage')).toBe(changed);
    expect(tablesReads()).toBe(2);
  });

  it('forgets the question when the dialog closes', async () => {
    api.delete.mockRejectedValueOnce(askedFirst());
    const wrapper = await thePage();
    await openSeat(wrapper, ANA);
    await emitted(wrapper, 'free', false);

    await emitted(wrapper, 'close');
    const reopened = await openSeat(wrapper, ANA);

    expect(reopened.props('question')).toBeNull();
    expect(api.delete).toHaveBeenCalledTimes(1);
  });
});

function applicant(email: string): PlaceableVendor {
  return {
    email,
    tableChoice: 'full',
    availableDates: [DATE],
    acceptedTiersByDate: {},
    maxDates: null,
    notApproved: null,
    inTheRun: true,
    addedByHand: false,
  };
}

function theDialog(props: Record<string, unknown> = {}) {
  return mount(PlacementDialog, {
    props: {
      open: true,
      mode: 'occupied',
      date: DATE,
      dateLabel: 'May 1, 2099',
      tableCode: 'A3',
      section: 'Main Hall',
      tier: 'Gold',
      seat: FULL_TABLE,
      occupantEmail: ANA,
      vendors: [applicant(ANA), applicant(BEN)],
      datesHeld: {},
      marketCeiling: null,
      seated: [
        { email: BEN, tableCode: 'A4', section: 'Main Hall', tier: 'Gold', seat: FULL_TABLE },
      ],
      emptySeats: [],
      vendorNames: { [ANA]: 'Alice' },
      vendorSearch: {},
      ...props,
    },
    attachTo: document.body,
  });
}

describe('the seat’s dialog, asking', () => {
  it('breaks an address in the sentence only before its “@” or a dot, never at a hyphen', () => {
    const sentence =
      'door-here-1794628088744@example.test checked in at table A3 for May 1, 2099. ' +
      'Their check-in stays recorded there.';
    const wrapper = theDialog({ question: { sentence, change: 'free' } });

    const question = wrapper.get('[data-testid="placement-dialog-here"]');
    expect(question.text()).toBe(sentence);
    expect(
      [...question.element.querySelectorAll('.email-address')].map((part) => part.textContent),
    ).toEqual(['door-here-1794628088744', '@example.test']);
  });

  it('keeps the server’s “table <code>” run unbroken, beside an address too', () => {
    // The server joins "table A 3" with no-break spaces; drawn through `EmailAddress`, they stay.
    const sentence =
      'door-here-1794628088744@example.test checked in at table A 3 for May 1, 2099. ' +
      'Their check-in stays recorded there.';
    const wrapper = theDialog({ question: { sentence, change: 'free' } });

    expect(wrapper.get('[data-testid="placement-dialog-here"]').element.textContent?.trim()).toBe(
      sentence,
    );
  });

  it.each([
    ['free', 'Free anyway', 'btn--destructive'],
    ['move', 'Move anyway', 'btn--primary'],
    ['swap', 'Swap anyway', 'btn--primary'],
  ])('a %s asks with the sentence and “%s” beside Cancel', (change, label, look) => {
    const wrapper = theDialog({ question: { sentence: HERE, change } });

    expect(wrapper.get('[data-testid="placement-dialog-here"]').text()).toBe(HERE);
    const buttons = wrapper.findAll('[data-testid="placement-dialog-window"] footer button');
    expect(buttons.map((button) => button.text())).toEqual(['Cancel', label]);
    const anyway = wrapper.get('[data-testid="placement-dialog-anyway"]');
    expect(anyway.classes()).toContain(look);
    // The choices that led here are not offered again beside the question.
    expect(wrapper.find('[data-testid="placement-dialog-free"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="placement-dialog-action-move"]').exists()).toBe(false);
  });

  it('confirms by its button, never by Enter', async () => {
    const wrapper = theDialog({ question: { sentence: HERE, change: 'move' } });

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('anyway')).toBeUndefined();

    await wrapper.get('[data-testid="placement-dialog-anyway"]').trigger('click');
    expect(wrapper.emitted('anyway')).toHaveLength(1);
  });

  it('cancels by closing', async () => {
    const wrapper = theDialog({ question: { sentence: HERE, change: 'free' } });

    await wrapper.get('[data-testid="placement-dialog-cancel"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('anyway')).toBeUndefined();
  });

  it('holds its button while the change is sent again', () => {
    const wrapper = theDialog({ question: { sentence: HERE, change: 'free' }, busy: true });

    expect(wrapper.get('[data-testid="placement-dialog-anyway"]').attributes()).toHaveProperty(
      'disabled',
    );
  });

  it('asks nothing without a question', () => {
    const wrapper = theDialog();

    expect(wrapper.find('[data-testid="placement-dialog-here"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="placement-dialog-anyway"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="placement-dialog-free"]').exists()).toBe(true);
  });
});

describe('the history of a change made while they were here', () => {
  const ON_THE_DAY = ' on Nov 19, 2026';

  function says(kind: string, vendors: string[], detail: Record<string, unknown>): string {
    const parts = entryParts(
      {
        id: 'e1',
        actor: 'dana@ember.test',
        at: '2026-11-19T10:00:00+00:00',
        action: 'assign',
        kind,
        vendors,
        subject: {},
        detail,
      },
      { names: {}, labels: {} },
    );
    return parts.map((part) => (part.kind === 'text' ? part.text : `[${part.kind}]`)).join('');
  }

  const SWAP = {
    date: '2026-11-19',
    seats: [
      { email: 'ana@ember.test', table_code: 'A3' },
      { email: 'ben@ember.test', table_code: 'B7' },
    ],
  };

  it.each([
    [
      'freed',
      ['ana@ember.test'],
      { date: '2026-11-19', table_code: 'B7' },
      `freed B7, leaving [vendor] with no table${ON_THE_DAY}, while they were checked in`,
    ],
    [
      'placed',
      ['ana@ember.test'],
      { date: '2026-11-19', table_code: 'B7', before: { table_code: 'A3' } },
      `moved [vendor] from A3 to B7${ON_THE_DAY}, while they were checked in`,
    ],
    [
      'swapped',
      ['ana@ember.test', 'ben@ember.test'],
      SWAP,
      `swapped [vendor] and [vendor] - now at A3 and B7${ON_THE_DAY}, while they were checked in`,
    ],
  ])('a %s says it', (kind, vendors, detail, sentence) => {
    expect(says(kind, vendors, { ...detail, while_here: true })).toBe(
      `dana@ember.test ${sentence}`,
    );
  });

  it('says it before results were published, when both hold', () => {
    expect(
      says('freed', ['ana@ember.test'], {
        date: '2026-11-19',
        table_code: 'B7',
        while_here: true,
        after_results: true,
      }),
    ).toBe(
      `dana@ember.test freed B7, leaving [vendor] with no table${ON_THE_DAY}, while they were ` +
        'checked in, after results were published: their vendor page had shown B7',
    );
  });

  it('reads an entry without the key exactly as before', () => {
    const detail = { date: '2026-11-19', table_code: 'B7' };
    expect(says('freed', ['ana@ember.test'], detail)).toBe(
      `dana@ember.test freed B7, leaving [vendor] with no table${ON_THE_DAY}`,
    );
    expect(says('freed', ['ana@ember.test'], { ...detail, while_here: false })).toBe(
      says('freed', ['ana@ember.test'], detail),
    );
  });
});
