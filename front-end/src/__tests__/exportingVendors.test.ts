/**
 * Exporting the vendors to a CSV (E42/F01/S01), from the Vendors page or the Applications tab (S03).
 *
 * "Export" opens on what the page shows: its filters and search become the dialog's, so the file
 * holds the vendors the organizer was looking at. The columns are ticked and put in order; the
 * server builds the file and the preview from the same filters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ExportVendorsDialog from '@/components/ExportVendorsDialog.vue';
import ExportVendorsForm from '@/components/ExportVendorsForm.vue';
import ScrollBox from '@/components/ScrollBox.vue';
import SearchPicker from '@/components/SearchPicker.vue';
import {
  applicationsAllSeed,
  chosenColumns,
  columnGroups,
  defaultOrder,
  exportFiltersSummary,
  exportSummary,
  localDay,
  movedColumn,
  NO_FILTERS,
  tickedColumn,
  vendorsPageSeed,
  type ExportFilters,
  type ExportPreview,
} from '@/utils/vendorExport';
import { getFormattedDate } from '@/utils/utils';
import { filenameFrom } from '@/utils/download';
import type { DiscordShown } from '@/utils/discordCheck';
import type { ResultFilters } from '@/utils/resultFilters';
import { ApplicationStatus } from '@/assets/types/datatypes';

const posted: { url: string; body: unknown }[] = [];
let answer: (body: { columns?: string[] }) => ExportPreview;

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    api: {
      post: async (url: string, body: { columns?: string[] }) => {
        posted.push({ url, body });
        return { data: answer(body), headers: {} };
      },
    },
  };
});

const NOTHING: ResultFilters = {
  date: '',
  section: '',
  tier: '',
  choice: '',
  status: '',
  search: '',
};

describe('the seed the Vendors page gives the export', () => {
  it('is no filter at all when the page shows everyone', () => {
    expect(vendorsPageSeed({ shown: null, filters: NOTHING, search: '' })).toEqual(NO_FILTERS);
  });

  it('turns "Unassigned only" into the approved and added vendors with no seat', () => {
    // An added vendor needs a table like anyone, so the file holds who the page lists (E38/F08/S02).
    expect(vendorsPageSeed({ shown: 'unassigned', filters: NOTHING, search: '' })).toEqual({
      ...NO_FILTERS,
      statuses: ['approved', 'added'],
      placed: 'unplaced',
    });
  });

  it('keeps the date "Unassigned only" is asked of', () => {
    const seed = vendorsPageSeed({
      shown: 'unassigned',
      filters: { ...NOTHING, date: '2026-11-18' },
      search: '',
    });

    expect(seed).toMatchObject({ placed: 'unplaced', date: '2026-11-18' });
  });

  it('turns "Rejected only" into the rejected', () => {
    expect(vendorsPageSeed({ shown: 'rejected', filters: NOTHING, search: '' }).statuses).toEqual([
      'rejected',
    ]);
  });

  it('turns where they are placed into the placed vendors there', () => {
    const seed = vendorsPageSeed({
      shown: null,
      filters: {
        ...NOTHING,
        date: '2026-11-18',
        section: 'North Wing',
        tier: 'Gold',
        choice: 'half',
      },
      search: '',
    });

    expect(seed).toEqual({
      ...NO_FILTERS,
      placed: 'placed',
      date: '2026-11-18',
      section: 'North Wing',
      tier: 'Gold',
      size: 'half',
    });
  });

  it('carries the search, as typed but trimmed', () => {
    expect(vendorsPageSeed({ shown: null, filters: NOTHING, search: '  ana ' }).search).toBe('ana');
  });

  it('carries the Discord state the page lists (E42/F01/S05)', () => {
    expect(
      vendorsPageSeed({ shown: null, filters: NOTHING, search: '', discord: 'not_found' }),
    ).toEqual({ ...NO_FILTERS, discord: ['not_found'] });
  });

  it('carries a state only the page works out: possible match and check again', () => {
    // T156 rereview note 7: the page's `?discord=` holds any state it shows.
    const seed = (discord: DiscordShown) =>
      vendorsPageSeed({ shown: null, filters: NOTHING, search: '', discord }).discord;

    expect(seed('possible_match')).toEqual(['possible_match']);
    expect(seed('check_again')).toEqual(['check_again']);
  });

  it('carries the Discord state beside "Unassigned only" and where they are placed', () => {
    const beside = (shown: 'unassigned' | null) =>
      vendorsPageSeed({
        shown,
        filters: { ...NOTHING, date: '2026-11-18', tier: 'Gold' },
        search: '',
        discord: 'no_username',
      }).discord;

    expect(beside('unassigned')).toEqual(['no_username']);
    expect(beside(null)).toEqual(['no_username']);
  });
});

describe('the seed the Applications tab’s All view gives the export', () => {
  it('is no filter at all on any status', () => {
    expect(applicationsAllSeed({ filter: 'all', mine: false })).toEqual(NO_FILTERS);
  });

  it('turns "Open" into the open applications', () => {
    expect(applicationsAllSeed({ filter: 'undecided', mine: false }).statuses).toEqual(['open']);
  });

  it('turns a verdict into its status', () => {
    expect(
      applicationsAllSeed({ filter: ApplicationStatus.NeedsFollowUp, mine: false }).statuses,
    ).toEqual(['follow_up']);
    expect(
      applicationsAllSeed({ filter: ApplicationStatus.ReviewerRejected, mine: false }).statuses,
    ).toEqual(['rejected']);
  });

  it('counts a vendor added by hand among the approved, as the All view lists them', () => {
    expect(
      applicationsAllSeed({ filter: ApplicationStatus.ReviewerApproved, mine: false }).statuses,
    ).toEqual(['approved', 'added']);
  });

  it('carries Mine', () => {
    expect(applicationsAllSeed({ filter: 'all', mine: true })).toEqual({
      ...NO_FILTERS,
      mine: true,
    });
  });
});

describe('the columns', () => {
  const offered = {
    columns: [
      { id: 'name', label: 'Name', group: 'vendor' },
      { id: 'email', label: 'Email', group: 'vendor' },
      { id: 'status', label: 'Status', group: 'vendor' },
      { id: 'answer:category', label: 'Category', group: 'answers' },
      { id: 'date:2099-08-01:table', label: 'Sat 1 Aug - table', group: 'assignment' },
      { id: 'datesPlaced', label: 'Dates assigned', group: 'assignment' },
    ],
    groups: [
      { id: 'vendor', label: 'Vendor' },
      { id: 'answers', label: 'Answers' },
      { id: 'assignment', label: 'Assignment' },
    ],
    defaultColumns: ['email', 'name'],
  };
  const column = (id: string) => offered.columns.find((c) => c.id === id)!;

  it('lists the columns under their groups, the assignment after the answers', () => {
    expect(columnGroups(offered).map((g) => [g.label, g.columns.map((c) => c.id)])).toEqual([
      ['Vendor', ['name', 'email', 'status']],
      ['Answers', ['answer:category']],
      ['Assignment', ['date:2099-08-01:table', 'datesPlaced']],
    ]);
  });

  it('leaves out a group with no column, as a form with no question of its own', () => {
    const noAnswers = {
      ...offered,
      columns: offered.columns.filter((c) => c.group !== 'answers'),
    };

    expect(columnGroups(noAnswers).map((g) => g.id)).toEqual(['vendor', 'assignment']);
  });

  it('starts from the default columns, in their order', () => {
    expect(chosenColumns(defaultOrder(offered))).toEqual(['email', 'name']);
  });

  it('puts a column ticked at the end of the file, and takes one unticked out', () => {
    let order = defaultOrder(offered);
    order = tickedColumn(order, column('datesPlaced'), true);
    order = tickedColumn(order, column('datesPlaced'), true);
    order = tickedColumn(order, column('email'), false);

    expect(chosenColumns(order)).toEqual(['name', 'datesPlaced']);
  });

  it('exports the ticked ones in the order they are put', () => {
    let order = tickedColumn(defaultOrder(offered), column('answer:category'), true);
    order = movedColumn(order, 2, -2);

    expect(chosenColumns(order)).toEqual(['answer:category', 'email', 'name']);
  });

  it('moves a column no further than either end', () => {
    const order = defaultOrder(offered);

    expect(movedColumn(order, 0, -1)).toBe(order);
    expect(movedColumn(order, 1, 1)).toBe(order);
  });
});

describe('what the dialog says', () => {
  it('counts the vendors and the columns', () => {
    expect(exportSummary(12, 3)).toBe('12 vendors, 3 columns');
    expect(exportSummary(1, 1)).toBe('1 vendor, 1 column');
  });

  it('names the file for the organizer’s own day', () => {
    expect(localDay(new Date(2026, 9, 28, 23, 30))).toBe('2026-10-28');
  });

  it('reads the filename the server gave', () => {
    expect(filenameFrom('attachment; filename="Fall_vendors_2026-10-28.csv"', 'x.csv')).toBe(
      'Fall_vendors_2026-10-28.csv',
    );
    expect(filenameFrom(undefined, 'x.csv')).toBe('x.csv');
  });
});

const OFFERED: ExportPreview['offered'] = {
  columns: [
    { id: 'name', label: 'Name', group: 'vendor' },
    { id: 'preferredName', label: 'Preferred name', group: 'vendor' },
    { id: 'email', label: 'Email', group: 'vendor' },
    { id: 'status', label: 'Status', group: 'vendor' },
    { id: 'answer:category', label: 'Category', group: 'answers' },
    { id: 'date:2099-08-01:table', label: 'Sat 1 Aug - table', group: 'assignment' },
    { id: 'datesPlaced', label: 'Dates assigned', group: 'assignment' },
    { id: 'priceGroup', label: 'Price group', group: 'payment' },
    { id: 'owed', label: 'Amount owed', group: 'payment' },
    { id: 'paid', label: 'Amount paid', group: 'payment' },
    { id: 'stillOwed', label: 'Still owed', group: 'payment' },
  ],
  groups: [
    { id: 'vendor', label: 'Vendor' },
    { id: 'answers', label: 'Answers' },
    { id: 'assignment', label: 'Assignment' },
    { id: 'payment', label: 'Payment' },
  ],
  defaultColumns: ['name', 'email', 'status'],
  statuses: [
    { id: 'open', label: 'Open' },
    { id: 'follow_up', label: 'Needs follow-up' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'added', label: 'Added by hand' },
  ],
  dates: ['2099-08-01', '2099-08-02'],
  sections: ['North Wing', 'South Wing'],
  tiers: ['Gold', 'Silver'],
  questions: [{ key: 'category', label: 'Category', options: ['Crafts', 'Food'] }],
  paymentStates: [
    { id: 'owes', label: 'Owes' },
    { id: 'paid', label: 'Paid in full' },
    { id: 'over', label: 'Paid more than owed' },
  ],
  discordStates: [],
};

/** A market whose Discord server has been checked (E42/F01/S05). */
const CHECKED: ExportPreview['offered'] = {
  ...OFFERED,
  columns: [
    ...OFFERED.columns,
    { id: 'discordUsername', label: 'Discord username', group: 'discord' },
    { id: 'discordState', label: 'Discord state', group: 'discord' },
  ],
  groups: [...OFFERED.groups, { id: 'discord', label: 'Discord' }],
  discordStates: [
    { id: 'has_role', label: 'Has the role' },
    { id: 'in_server', label: 'In the server' },
    { id: 'possible_match', label: 'Possible match' },
    { id: 'not_found', label: 'Not found' },
    { id: 'no_username', label: 'No username' },
    { id: 'check_again', label: 'Check again' },
  ],
};

describe('the line saying which vendors are in', () => {
  const said = (filters: Partial<ExportFilters>, offered = CHECKED) =>
    exportFiltersSummary({ ...NO_FILTERS, ...filters }, offered);

  it('is "All vendors" with nothing narrowing', () => {
    expect(said({})).toBe('All vendors');
  });

  it('is "All vendors" with an answer asked of no option, which narrows nothing', () => {
    expect(said({ answers: { category: [] } })).toBe('All vendors');
  });

  it('is "All vendors" with only spaces searched, as the server strips them', () => {
    expect(said({ search: '   ' })).toBe('All vendors');
  });

  it('names the words searched, trimmed', () => {
    expect(said({ search: ' ana ' })).toBe('Name or email: "ana"');
  });

  it('names the statuses in the market’s words', () => {
    expect(said({ statuses: ['approved', 'added'] })).toBe('Status: Approved, Added by hand');
  });

  it('names Mine', () => {
    expect(said({ mine: true })).toBe('Mine');
  });

  it('names assigned or not, and the date either is asked of', () => {
    expect(said({ placed: 'placed' })).toBe('Assigned');
    expect(said({ placed: 'unplaced' })).toBe('Not assigned');
    expect(said({ placed: 'placed', date: '2099-08-01' })).toBe(
      `Assigned on ${getFormattedDate('2099-08-01')}`,
    );
    expect(said({ placed: 'unplaced', date: '2099-08-01' })).toBe(
      `Not assigned on ${getFormattedDate('2099-08-01')}`,
    );
  });

  it('names a seat’s section, tier and size', () => {
    expect(said({ placed: 'placed', section: 'North Wing' })).toBe(
      'Assigned · Section: North Wing',
    );
    expect(said({ placed: 'placed', tier: 'Gold' })).toBe('Assigned · Tier: Gold');
    expect(said({ placed: 'placed', size: 'half' })).toBe('Assigned · Half table');
    expect(said({ placed: 'placed', size: 'full' })).toBe('Assigned · Full table');
  });

  it('leaves out what the server does not hold it to: a seat of no one placed', () => {
    const seat = { date: '2099-08-01', section: 'North Wing', tier: 'Gold', size: 'half' as const };

    expect(said(seat)).toBe('All vendors');
    expect(said({ ...seat, placed: 'unplaced' })).toBe(
      `Not assigned on ${getFormattedDate('2099-08-01')}`,
    );
  });

  it('names the payment state in the market’s words', () => {
    expect(said({ payment: 'over' })).toBe('Payment: Paid more than owed');
  });

  it('leaves out a payment state on a market that offers none, whose server ignores it', () => {
    expect(said({ payment: 'owes' }, { ...CHECKED, paymentStates: [] })).toBe('All vendors');
  });

  it('names the Discord states in the page’s words', () => {
    expect(said({ discord: ['not_found', 'no_username'] })).toBe('Discord: Not found, No username');
  });

  it('names each question’s answers under its own words', () => {
    expect(said({ answers: { category: ['Food', 'Crafts'] } })).toBe('Category: Food, Crafts');
  });

  it('names every filter, in the order the fields stand', () => {
    expect(
      said({
        search: 'ana',
        payment: 'owes',
        placed: 'placed',
        date: '2099-08-01',
        section: 'North Wing',
        tier: 'Gold',
        size: 'full',
        statuses: ['approved'],
        mine: true,
        discord: ['in_server'],
        answers: { category: ['Food'] },
      }),
    ).toBe(
      [
        'Name or email: "ana"',
        'Payment: Owes',
        `Assigned on ${getFormattedDate('2099-08-01')}`,
        'Section: North Wing',
        'Tier: Gold',
        'Full table',
        'Status: Approved',
        'Mine',
        'Discord: In the server',
        'Category: Food',
      ].join(' · '),
    );
  });

  it('names what each page’s seed brought', () => {
    expect(said(vendorsPageSeed({ shown: 'unassigned', filters: NOTHING, search: '' }))).toBe(
      'Not assigned · Status: Approved, Added by hand',
    );
    expect(said(applicationsAllSeed({ filter: 'undecided', mine: true }))).toBe(
      'Status: Open · Mine',
    );
  });
});

describe('the dialog', () => {
  beforeEach(() => {
    posted.length = 0;
    answer = (body) => {
      const columns = body.columns ?? OFFERED.defaultColumns;
      const header = columns.map((id) => OFFERED.columns.find((c) => c.id === id)?.label ?? id);
      return {
        count: 4,
        header,
        rows: [1, 2, 3].map((n) => columns.map((id) => `${id}-${n}`)),
        offered: OFFERED,
      };
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function opened(seed = NO_FILTERS, offered = OFFERED) {
    const answering = answer;
    answer = (body) => ({ ...answering(body), offered });
    const wrapper = mount(ExportVendorsDialog, {
      props: { open: true, marketId: 'market-1', seed },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  }

  async function unfolded(seed = NO_FILTERS, offered = OFFERED) {
    const wrapper = await opened(seed, offered);
    await wrapper.get('[data-testid="vendor-export-filters-toggle"]').trigger('click');
    return wrapper;
  }

  const pressed = (wrapper: VueWrapper, testid: string) =>
    wrapper.get(`[data-testid="${testid}"]`).attributes('aria-pressed');

  it('opens on the page’s filters and previews what they keep', async () => {
    const seed = { ...NO_FILTERS, statuses: ['approved' as const], placed: 'unplaced' as const };
    const wrapper = await unfolded(seed);

    expect(posted[0]).toMatchObject({
      url: '/markets/market-1/vendor-export/preview',
      body: { filters: seed },
    });
    expect(pressed(wrapper, 'vendor-export-status-approved')).toBe('true');
    expect(pressed(wrapper, 'vendor-export-status-open')).toBe('false');
    expect(
      (wrapper.get('[data-testid="vendor-export-placed"]').element as HTMLSelectElement).value,
    ).toBe('unplaced');
    expect(wrapper.get('[data-testid="vendor-export-summary"]').text()).toBe(
      '4 vendors, 3 columns',
    );
    expect(wrapper.findAll('[data-testid="vendor-export-preview-row"]')).toHaveLength(3);
    wrapper.unmount();
  });

  it('opens on Mine and asks for the follow-ups the one exporting owns', async () => {
    const wrapper = await unfolded({ ...NO_FILTERS, mine: true });

    expect(posted[0]?.body).toMatchObject({ filters: { mine: true } });
    const mine = wrapper.get('[data-testid="vendor-export-mine"]');
    expect((mine.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.get('label:has([data-testid="vendor-export-mine"])').text()).toBe(
      'Mine: the follow-ups I own',
    );
    wrapper.unmount();
  });

  it('asks again with the columns in the order they are put', async () => {
    vi.useFakeTimers();
    const wrapper = await opened();
    await vi.runAllTimersAsync();
    posted.length = 0;

    await wrapper.get('[data-testid="vendor-export-column-answer:category"]').setValue(true);
    await wrapper.get('[data-testid="vendor-export-order-up-answer:category"]').trigger('click');
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(posted.at(-1)?.body).toMatchObject({
      columns: ['name', 'email', 'answer:category', 'status'],
    });
    expect(wrapper.get('[data-testid="vendor-export-preview-header"]').text()).toContain(
      'Category',
    );
    wrapper.unmount();
  });

  it('groups the columns, the assignment’s under "Assignment" after the answers', async () => {
    const wrapper = await opened();

    const groups = wrapper.findAll('[data-testid^="vendor-export-group-"]');
    expect(groups.map((g) => g.get('legend').text())).toEqual([
      'Vendor',
      'Answers',
      'Assignment',
      'Payment',
    ]);
    expect(wrapper.get('[data-testid="vendor-export-group-assignment"]').text()).toContain(
      'Sat 1 Aug - table',
    );
    wrapper.unmount();
  });

  it('lists only the ticked columns to put in order', async () => {
    const wrapper = await opened();

    await wrapper.get('[data-testid="vendor-export-column-datesPlaced"]').setValue(true);

    expect(
      wrapper.findAll('[data-testid="vendor-export-order-label"]').map((i) => i.text()),
    ).toEqual(['Name', 'Email', 'Status', 'Dates assigned']);
    wrapper.unmount();
  });

  it('offers a seat’s section, tier and size only for the vendors placed', async () => {
    const wrapper = await unfolded();

    expect(wrapper.find('[data-testid="vendor-export-tier"]').exists()).toBe(false);
    await wrapper.get('[data-testid="vendor-export-placed"]').setValue('placed');

    expect(wrapper.find('[data-testid="vendor-export-tier"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('offers no Discord filter on a market never checked', async () => {
    const wrapper = await unfolded();

    expect(wrapper.find('[data-testid="vendor-export-discord"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="vendor-export-discord-not_found"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens on the page’s Discord state, and lists the Discord columns last', async () => {
    const wrapper = await unfolded({ ...NO_FILTERS, discord: ['not_found'] }, CHECKED);

    expect(posted[0]?.body).toMatchObject({ filters: { discord: ['not_found'] } });
    expect(pressed(wrapper, 'vendor-export-discord-not_found')).toBe('true');
    expect(pressed(wrapper, 'vendor-export-discord-in_server')).toBe('false');
    expect(
      wrapper
        .get('[data-testid="vendor-export-discord"]')
        .findAll('button')
        .map((b) => b.text()),
    ).toEqual([
      'Has the role',
      'In the server',
      'Possible match',
      'Not found',
      'No username',
      'Check again',
    ]);
    const groups = wrapper.findAll('[data-testid^="vendor-export-group-"]');
    expect(groups.map((g) => g.get('legend').text()).at(-1)).toBe('Discord');
    wrapper.unmount();
  });

  it('asks again with the Discord states pressed', async () => {
    vi.useFakeTimers();
    const wrapper = await unfolded(NO_FILTERS, CHECKED);
    await vi.runAllTimersAsync();
    posted.length = 0;

    await wrapper.get('[data-testid="vendor-export-discord-no_username"]').trigger('click');
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(posted.at(-1)?.body).toMatchObject({ filters: { discord: ['no_username'] } });
    wrapper.unmount();
  });

  it('lists the money columns under "Payment", after the assignment', async () => {
    const wrapper = await opened();

    expect(
      wrapper
        .get('[data-testid="vendor-export-group-payment"]')
        .findAll('label')
        .map((l) => l.text()),
    ).toEqual(['Price group', 'Amount owed', 'Amount paid', 'Still owed']);
    wrapper.unmount();
  });

  it('filters by payment in the Payment tab’s words, and asks for what is chosen', async () => {
    vi.useFakeTimers();
    const wrapper = await unfolded();
    await vi.runAllTimersAsync();
    posted.length = 0;

    const payment = wrapper.get('[data-testid="vendor-export-payment"]');
    expect(payment.findAll('option').map((o) => o.text())).toEqual([
      'Paid or not',
      'Owes',
      'Paid in full',
      'Paid more than owed',
    ]);
    await payment.setValue('owes');
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(posted.at(-1)?.body).toMatchObject({ filters: { payment: 'owes' } });
    wrapper.unmount();
  });

  it('offers no payment filter on a market without prices, which offers no payment state', async () => {
    // Everyone who paid there would be "Paid more than owed" (finding 8), the list the Payments
    // page offers no filter for there either.
    const wrapper = await unfolded(NO_FILTERS, { ...OFFERED, paymentStates: [] });

    expect(wrapper.find('[data-testid="vendor-export-payment"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Paid or not');
    wrapper.unmount();
  });

  it('cannot download with no column ticked', async () => {
    const wrapper = await opened();

    for (const id of OFFERED.defaultColumns) {
      await wrapper.get(`[data-testid="vendor-export-column-${id}"]`).setValue(false);
    }

    expect(
      (wrapper.get('[data-testid="vendor-export-submit-button"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    wrapper.unmount();
  });

  describe('finding a column', () => {
    const scrollIntoView = vi.fn();

    beforeEach(() => {
      scrollIntoView.mockClear();
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    const find = (wrapper: VueWrapper) =>
      wrapper.get<HTMLInputElement>('[data-testid="vendor-export-columns-find"]');
    const headings = (wrapper: VueWrapper) =>
      wrapper.findAll('[data-testid^="vendor-export-group-"]').map((g) => g.get('legend').text());
    const listed = (wrapper: VueWrapper) =>
      wrapper
        .findAll('[data-testid^="vendor-export-column-"]')
        .map((box) => box.attributes('data-testid')!.replace('vendor-export-column-', ''));
    const tickOf = (wrapper: VueWrapper, id: string) =>
      wrapper.get<HTMLInputElement>(`[data-testid="vendor-export-column-${id}"]`);
    const inTheOrder = (wrapper: VueWrapper) =>
      wrapper.findAll('[data-testid="vendor-export-order-label"]').map((row) => row.text());

    it('lists every column under its heading until something is typed', async () => {
      const wrapper = await opened();

      expect(headings(wrapper)).toEqual(['Vendor', 'Answers', 'Assignment', 'Payment']);
      expect(listed(wrapper)).toHaveLength(OFFERED.columns.length);
      wrapper.unmount();
    });

    it('narrows the columns as it is typed in, keeping the headings with a match', async () => {
      const wrapper = await opened();

      await find(wrapper).setValue('AMOUNT');

      expect(headings(wrapper)).toEqual(['Payment']);
      expect(listed(wrapper)).toEqual(['owed', 'paid']);
      wrapper.unmount();
    });

    it('finds across headings, and only spaces typed narrows nothing', async () => {
      const wrapper = await opened();

      await find(wrapper).setValue(' ed ');
      expect(headings(wrapper)).toEqual(['Vendor', 'Assignment', 'Payment']);
      expect(listed(wrapper)).toEqual(['preferredName', 'datesPlaced', 'owed', 'stillOwed']);

      await find(wrapper).setValue('   ');
      expect(listed(wrapper)).toHaveLength(OFFERED.columns.length);
      wrapper.unmount();
    });

    it('says when nothing matches, with the words typed, and says nothing until then', async () => {
      const wrapper = await opened();
      const none = '[data-testid="vendor-export-columns-none"]';
      expect(wrapper.find(none).exists()).toBe(false);

      await find(wrapper).setValue('  zzz ');

      expect(wrapper.get(none).text()).toBe('Nothing matches "zzz".');
      expect(headings(wrapper)).toEqual([]);
      wrapper.unmount();
    });

    it('brings the first thing the words find into view, or the words saying nothing did', async () => {
      const wrapper = await opened();

      await find(wrapper).setValue('amount');
      expect(scrollIntoView.mock.contexts).toEqual([
        tickOf(wrapper, 'owed').element.closest('label'),
      ]);

      scrollIntoView.mockClear();
      await find(wrapper).setValue('zzz');
      expect(scrollIntoView.mock.contexts).toEqual([
        wrapper.get('[data-testid="vendor-export-columns-none"]').element,
      ]);
      wrapper.unmount();
    });

    it('carries each label’s whole text in a title, for when an ellipsis cuts it', async () => {
      const wrapper = await opened();

      const pick = tickOf(wrapper, 'date:2099-08-01:table').element.closest('label')!;
      const words = pick.querySelector('[title]')!;
      expect(words.getAttribute('title')).toBe('Sat 1 Aug - table');
      expect(words.textContent?.trim()).toBe('Sat 1 Aug - table');
      wrapper.unmount();
    });

    it('puts a column ticked at the end of the order, and takes it out', async () => {
      const wrapper = await opened();

      await tickOf(wrapper, 'owed').setValue(true);
      expect(inTheOrder(wrapper)).toEqual(['Name', 'Email', 'Status', 'Amount owed']);

      await tickOf(wrapper, 'owed').setValue(false);
      expect(inTheOrder(wrapper)).toEqual(['Name', 'Email', 'Status']);
      wrapper.unmount();
    });

    it('holds its words and its ticks through a tick, a move and a remove in the cart', async () => {
      vi.useFakeTimers();
      const wrapper = await opened();
      await vi.runAllTimersAsync();

      await find(wrapper).setValue('amount');
      await tickOf(wrapper, 'owed').setValue(true);
      await tickOf(wrapper, 'paid').setValue(true);
      await wrapper.get('[data-testid="vendor-export-order-up-paid"]').trigger('click');
      // The server's answer replaces what is offered, which must not start the list over.
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(find(wrapper).element.value).toBe('amount');
      expect(listed(wrapper)).toEqual(['owed', 'paid']);
      expect(tickOf(wrapper, 'owed').element.checked).toBe(true);
      expect(tickOf(wrapper, 'paid').element.checked).toBe(true);
      expect(inTheOrder(wrapper)).toEqual([
        'Name',
        'Email',
        'Status',
        'Amount paid',
        'Amount owed',
      ]);

      await wrapper.get('[data-testid="vendor-export-remove-owed"]').trigger('click');
      await flushPromises();

      expect(find(wrapper).element.value).toBe('amount');
      expect(tickOf(wrapper, 'owed').element.checked).toBe(false);
      expect(tickOf(wrapper, 'paid').element.checked).toBe(true);
      wrapper.unmount();
    });

    it('forgets its words on closing', async () => {
      const wrapper = await opened();
      await find(wrapper).setValue('amount');

      await wrapper.setProps({ open: false });
      await flushPromises();
      await wrapper.setProps({ open: true });
      await flushPromises();

      expect(find(wrapper).element.value).toBe('');
      expect(listed(wrapper)).toHaveLength(OFFERED.columns.length);
      wrapper.unmount();
    });

    it.each(['vendor-export-columns-find', 'vendor-export-column-name'])(
      'keeps Enter in %s from the form',
      async (testid) => {
        const wrapper = await opened();

        const enter = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        wrapper.get(`[data-testid="${testid}"]`).element.dispatchEvent(enter);

        expect(enter.defaultPrevented).toBe(true);
        wrapper.unmount();
      },
    );
  });

  describe('"Which vendors"', () => {
    const toggle = (wrapper: VueWrapper) =>
      wrapper.get('[data-testid="vendor-export-filters-toggle"]');
    const line = (wrapper: VueWrapper) =>
      wrapper.get('[data-testid="vendor-export-filters-summary"]');

    it('opens folded, saying all the vendors are in', async () => {
      const wrapper = await opened();

      expect(line(wrapper).text()).toBe('All vendors');
      expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
      expect(toggle(wrapper).text()).toBe('Show the filters');
      expect(wrapper.find('[data-testid="vendor-export-search"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('opens folded from a filtered page, naming its filters, the cart’s count already theirs', async () => {
      const seed = { ...NO_FILTERS, statuses: ['rejected' as const], search: 'ana' };
      const wrapper = await opened(seed);

      expect(line(wrapper).text()).toBe('Name or email: "ana" · Status: Rejected');
      expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
      expect(posted[0]?.body).toMatchObject({ filters: seed });
      expect(wrapper.get('[data-testid="vendor-export-summary"]').text()).toBe(
        '4 vendors, 3 columns',
      );
      wrapper.unmount();
    });

    it('unfolds in the body, naming what it controls, and folds again', async () => {
      const wrapper = await opened();

      await toggle(wrapper).trigger('click');

      expect(toggle(wrapper).attributes('aria-expanded')).toBe('true');
      expect(toggle(wrapper).text()).toBe('Hide the filters');
      const fields = wrapper.get('[data-testid="vendor-export-filters"]');
      expect(toggle(wrapper).attributes('aria-controls')).toBe(fields.attributes('id'));
      expect(
        wrapper
          .get('[data-testid="vendor-export-body"]')
          .find('[data-testid="vendor-export-filters"]')
          .exists(),
      ).toBe(true);
      expect(fields.find('[data-testid="vendor-export-search"]').exists()).toBe(true);

      await toggle(wrapper).trigger('click');

      expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
      expect(wrapper.find('[data-testid="vendor-export-filters"]').exists()).toBe(false);
      expect(document.activeElement).toBe(toggle(wrapper).element);
      wrapper.unmount();
    });

    it('opens folded every time, whatever it was left as', async () => {
      const wrapper = await unfolded();

      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();

      expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
      expect(wrapper.find('[data-testid="vendor-export-filters"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('follows a filter changed under it, in the line', async () => {
      const wrapper = await unfolded();

      await wrapper.get('[data-testid="vendor-export-status-open"]').trigger('click');
      expect(line(wrapper).text()).toBe('Status: Open');

      await wrapper.get('[data-testid="vendor-export-status-open"]').trigger('click');
      expect(line(wrapper).text()).toBe('All vendors');
      wrapper.unmount();
    });

    it('takes the statuses as toggles, any number at once, and asks for them', async () => {
      vi.useFakeTimers();
      const wrapper = await unfolded();
      await vi.runAllTimersAsync();
      posted.length = 0;

      await wrapper.get('[data-testid="vendor-export-status-rejected"]').trigger('click');
      await wrapper.get('[data-testid="vendor-export-status-open"]').trigger('click');
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(posted.at(-1)?.body).toMatchObject({ filters: { statuses: ['open', 'rejected'] } });
      expect(wrapper.find('input[name="vendor-export-status"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('holds Enter on a closed select, which submits the form around it on a Mac', async () => {
      const wrapper = await unfolded();

      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      wrapper.get('[data-testid="vendor-export-placed"]').element.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(true);
      wrapper.unmount();
    });

    it('takes a question’s answers in a combobox, drawing no box for any of them', async () => {
      const wrapper = await unfolded();

      const picker = wrapper.getComponent(SearchPicker);
      expect(picker.props()).toMatchObject({ multiple: true, cap: 50, label: 'Category' });
      expect(wrapper.find('input[type="checkbox"][name^="vendor-export-answer"]').exists()).toBe(
        false,
      );
      wrapper.unmount();
    });

    it('draws at most the cap of a question’s hundreds of answers', async () => {
      const options = Array.from({ length: 300 }, (_, at) => `Answer ${at + 1}`);
      const wrapper = await unfolded(NO_FILTERS, {
        ...OFFERED,
        questions: [{ key: 'category', label: 'Category', options }],
      });

      await wrapper.get('[data-testid="vendor-export-answer-category-input"]').trigger('click');

      expect(wrapper.findAll('[data-testid="vendor-export-answer-category-option"]')).toHaveLength(
        50,
      );
      expect(wrapper.get('[data-testid="vendor-export-answer-category-more"]').text()).toBe(
        '250 more, type to narrow',
      );
      wrapper.unmount();
    });

    it('asks for the answers chosen, and names them on the line', async () => {
      vi.useFakeTimers();
      const wrapper = await unfolded();
      await vi.runAllTimersAsync();
      posted.length = 0;

      await wrapper.get('[data-testid="vendor-export-answer-category-input"]').trigger('click');
      await wrapper
        .findAll('[data-testid="vendor-export-answer-category-option"]')[1]!
        .trigger('click');
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(posted.at(-1)?.body).toMatchObject({ filters: { answers: { category: ['Food'] } } });
      expect(line(wrapper).text()).toBe('Category: Food');
      wrapper.unmount();
    });

    it.each(['vendor-export-search', 'vendor-export-mine', 'vendor-export-answer-category-input'])(
      'keeps Enter in %s from the form',
      async (testid) => {
        const wrapper = await unfolded();

        const enter = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        wrapper.get(`[data-testid="${testid}"]`).element.dispatchEvent(enter);

        expect(enter.defaultPrevented).toBe(true);
        wrapper.unmount();
      },
    );

    it('leaves Enter on a toggle to the toggle, which it presses', async () => {
      const wrapper = await unfolded();

      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      wrapper.get('[data-testid="vendor-export-status-open"]').element.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(false);
      wrapper.unmount();
    });
  });

  describe('the cart', () => {
    const inCart = (wrapper: VueWrapper, testid: string) =>
      wrapper.get('[data-testid="vendor-export-tray"]').find(`[data-testid="${testid}"]`);

    it('holds the count, the order, the preview’s header and its rows, all in the tray', async () => {
      const wrapper = await opened();

      expect(inCart(wrapper, 'vendor-export-summary').text()).toBe('4 vendors, 3 columns');
      expect(inCart(wrapper, 'vendor-export-order').exists()).toBe(true);
      expect(inCart(wrapper, 'vendor-export-preview-header').text()).toBe('NameEmailStatus');
      expect(
        wrapper
          .get('[data-testid="vendor-export-tray"]')
          .findAll('[data-testid="vendor-export-preview-row"]'),
      ).toHaveLength(3);
      wrapper.unmount();
    });

    it('draws a broad dialog whose body alone scrolls', async () => {
      const wrapper = await opened();

      const window = wrapper.get('[data-testid="vendor-export-window"]');
      expect(window.classes()).toContain('dialog-window--broad');
      expect(window.classes()).toContain('dialog-window--body');
      expect(wrapper.find('[data-testid="vendor-export-body"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it('draws the preview as the data table, one line a cell, in a named sideways box', async () => {
      const wrapper = await opened();

      const box = wrapper
        .findAllComponents(ScrollBox)
        .find((each) => each.props('testid') === 'vendor-export-preview')!;
      expect(box.props()).toMatchObject({ axis: 'x', label: "The file's first rows" });
      expect(box.classes()).toContain('data-table-scroll');
      expect(box.get('table').classes()).toEqual(
        expect.arrayContaining(['data-table', 'data-table--one-line']),
      );
      expect(wrapper.find('.export-table').exists()).toBe(false);
      expect(wrapper.find('.export-table-scroll').exists()).toBe(false);
      wrapper.unmount();
    });

    it('takes a column out, unticks it in the list, and asks again without it', async () => {
      vi.useFakeTimers();
      const wrapper = await opened();
      await vi.runAllTimersAsync();
      posted.length = 0;

      await wrapper.get('[data-testid="vendor-export-remove-email"]').trigger('click');
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(
        wrapper.findAll('[data-testid="vendor-export-order-label"]').map((i) => i.text()),
      ).toEqual(['Name', 'Status']);
      expect(
        (wrapper.get('[data-testid="vendor-export-column-email"]').element as HTMLInputElement)
          .checked,
      ).toBe(false);
      expect(posted.at(-1)?.body).toMatchObject({ columns: ['name', 'status'] });
      wrapper.unmount();
    });

    it('moves the focus to the next Remove when one goes, and to the one before at the end', async () => {
      const wrapper = await opened();
      const remove = (id: string) => wrapper.get(`[data-testid="vendor-export-remove-${id}"]`);

      await remove('name').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(remove('email').element);

      await remove('status').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(remove('email').element);
      wrapper.unmount();
    });

    it('moves the focus into the dialog when the last column goes, never to the page', async () => {
      const wrapper = await opened();

      for (const id of OFFERED.defaultColumns) {
        await wrapper.get(`[data-testid="vendor-export-remove-${id}"]`).trigger('click');
        await flushPromises();
      }

      expect(document.activeElement).toBe(
        wrapper.get('[data-testid="vendor-export-filters-toggle"]').element,
      );
      wrapper.unmount();
    });

    it('never opens on a Remove: a stray Enter would take a column', async () => {
      const wrapper = await opened();

      expect(wrapper.get('[data-testid="vendor-export-remove-name"]').attributes()).toHaveProperty(
        'data-dialog-not-first',
      );
      expect(document.activeElement).toBe(
        wrapper.get('[data-testid="vendor-export-filters-toggle"]').element,
      );
      wrapper.unmount();
    });

    it('says when no column is chosen, in the cart, with the preview gone', async () => {
      const wrapper = await opened();

      for (const id of OFFERED.defaultColumns) {
        await wrapper.get(`[data-testid="vendor-export-column-${id}"]`).setValue(false);
      }

      expect(inCart(wrapper, 'vendor-export-order-none').text()).toBe(
        'Choose a column to export it.',
      );
      expect(wrapper.find('[data-testid="vendor-export-preview"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('keeps the count with no column chosen, asking as it does at the start, never for no column', async () => {
      vi.useFakeTimers();
      const wrapper = await opened();
      await vi.runAllTimersAsync();
      posted.length = 0;

      for (const id of OFFERED.defaultColumns) {
        await wrapper.get(`[data-testid="vendor-export-column-${id}"]`).setValue(false);
      }
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(posted.at(-1)?.body).not.toHaveProperty('columns');
      expect(posted.map((asked) => asked.body)).not.toContainEqual(
        expect.objectContaining({ columns: [] }),
      );
      expect(inCart(wrapper, 'vendor-export-summary').text()).toBe('4 vendors, 0 columns');
      expect(wrapper.find('[data-testid="vendor-export-preview"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('draws no preview for a first tick after no column until the answer names that column', async () => {
      vi.useFakeTimers();
      const wrapper = await opened();
      await vi.runAllTimersAsync();
      for (const id of OFFERED.defaultColumns) {
        await wrapper.get(`[data-testid="vendor-export-column-${id}"]`).setValue(false);
      }
      await vi.runAllTimersAsync();
      await flushPromises();

      await wrapper.get('[data-testid="vendor-export-column-email"]').setValue(true);

      expect(inCart(wrapper, 'vendor-export-summary').text()).toBe('4 vendors, 1 column');
      expect(wrapper.find('[data-testid="vendor-export-preview-header"]').exists()).toBe(false);

      await vi.runAllTimersAsync();
      await flushPromises();

      expect(wrapper.get('[data-testid="vendor-export-preview-header"]').text()).toBe('Email');
      wrapper.unmount();
    });

    it('says when no vendor matches, in the cart', async () => {
      const answering = answer;
      answer = (body) => ({ ...answering(body), count: 0, rows: [] });
      const wrapper = await opened();

      expect(inCart(wrapper, 'vendor-export-no-vendor').text()).toBe(
        'No vendor matches these filters.',
      );
      expect(inCart(wrapper, 'vendor-export-summary').text()).toBe('0 vendors, 3 columns');
      expect(wrapper.find('[data-testid="vendor-export-preview"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('says a first preview that failed in the cart, with no loading line left', async () => {
      answer = () => {
        throw new Error('down');
      };
      const wrapper = await opened();

      expect(inCart(wrapper, 'vendor-export-preview-error').text()).toBe(
        'The preview could not be loaded.',
      );
      expect(wrapper.text()).not.toContain('Loading');
      expect(
        (wrapper.get('[data-testid="vendor-export-submit-button"]').element as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      wrapper.unmount();
    });

    it('says a later failure in the cart in place of a count and rows it can no longer stand by', async () => {
      vi.useFakeTimers();
      const wrapper = await unfolded();
      await vi.runAllTimersAsync();
      answer = () => {
        throw new Error('down');
      };

      await wrapper.get('[data-testid="vendor-export-search"]').setValue('ana');
      await vi.runAllTimersAsync();
      await flushPromises();

      expect(inCart(wrapper, 'vendor-export-preview-error').text()).toBe(
        'The preview could not be loaded.',
      );
      expect(wrapper.find('[data-testid="vendor-export-summary"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="vendor-export-preview"]').exists()).toBe(false);
      // The columns are still the organizer's to set, and the file is still theirs to ask for.
      expect(inCart(wrapper, 'vendor-export-order').exists()).toBe(true);
      expect(
        (wrapper.get('[data-testid="vendor-export-submit-button"]').element as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      wrapper.unmount();
    });

    it('folds by a toggle that says what it does', async () => {
      const wrapper = await opened();

      const toggle = wrapper.get('[data-testid="vendor-export-cart-toggle"]');
      const cart = wrapper.get('[data-testid="vendor-export-cart"]');
      expect(toggle.text()).toBe('Show the file');
      expect(toggle.attributes('aria-expanded')).toBe('false');
      expect(cart.classes()).not.toContain('export-cart--open');

      await toggle.trigger('click');

      expect(toggle.text()).toBe('Hide the file');
      expect(toggle.attributes('aria-expanded')).toBe('true');
      expect(cart.classes()).toContain('export-cart--open');
      wrapper.unmount();
    });
  });
});

describe('the form, drawn from what it is given', () => {
  const preview: ExportPreview = {
    count: 2,
    header: ['Name', 'Email'],
    rows: [['Ana', 'ana@example.test']],
    offered: OFFERED,
  };
  const order = OFFERED.columns.filter((column) => ['name', 'email'].includes(column.id));
  const filtersOf = () => ({ ...NO_FILTERS, statuses: [], discord: [], answers: { category: [] } });

  function form(props: Partial<InstanceType<typeof ExportVendorsForm>['$props']> = {}) {
    return mount(ExportVendorsForm, {
      props: {
        open: true,
        offered: OFFERED,
        filters: filtersOf(),
        order,
        preview,
        previewError: '',
        error: '',
        busy: false,
        ...props,
      },
      attachTo: document.body,
    });
  }

  beforeEach(() => {
    posted.length = 0;
  });

  it('draws the dialog and asks the server nothing', async () => {
    const wrapper = form();
    await flushPromises();

    expect(wrapper.get('[data-testid="vendor-export-summary"]').text()).toBe(
      '2 vendors, 2 columns',
    );
    expect(wrapper.findAll('[data-testid="vendor-export-preview-row"]')).toHaveLength(1);
    expect(posted).toEqual([]);
    wrapper.unmount();
  });

  it('says what the organizer changed, and leaves the download to whoever holds it', async () => {
    const wrapper = form();

    await wrapper.get('[data-testid="vendor-export-remove-name"]').trigger('click');
    expect(wrapper.emitted('update:order')?.at(-1)?.[0]).toEqual([order[1]]);

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('download')).toHaveLength(1);

    await wrapper.get('[data-testid="vendor-export-cancel-button"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('says it is busy on the button, with the button disabled', () => {
    const wrapper = form({ busy: true });

    const button = wrapper.get('[data-testid="vendor-export-submit-button"]');
    expect(button.text()).toBe('Downloading…');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
    wrapper.unmount();
  });

  it('says what refused the download above the buttons', () => {
    const wrapper = form({ error: 'The export could not be downloaded.' });

    expect(wrapper.get('[data-testid="vendor-export-error"]').text()).toBe(
      'The export could not be downloaded.',
    );
    wrapper.unmount();
  });

  it('moves the focus to the toggle when the first answer draws the fields', async () => {
    const wrapper = form({ offered: null, preview: null, order: [] });
    await flushPromises();
    expect(wrapper.find('[data-testid="vendor-export-filters-toggle"]').exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="vendor-export-cancel-button"]').element,
    );

    await wrapper.setProps({ offered: OFFERED, preview, order });
    await flushPromises();

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="vendor-export-filters-toggle"]').element,
    );
    wrapper.unmount();
  });

  it('leaves the focus where the organizer moved it before the first answer', async () => {
    const wrapper = form({ offered: null, preview: null, order: [] });
    await flushPromises();
    const close = wrapper.get('[data-testid="vendor-export-close-button"]').element as HTMLElement;
    close.focus();

    await wrapper.setProps({ offered: OFFERED, preview, order });
    await flushPromises();

    expect(document.activeElement).toBe(close);
    wrapper.unmount();
  });

  it('opens on the toggle when it is mounted with the fields, as the library does', async () => {
    const wrapper = form();
    await flushPromises();

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="vendor-export-filters-toggle"]').element,
    );
    wrapper.unmount();
  });

  it('writes a toggle’s press into the holder’s filters', async () => {
    const filters = filtersOf();
    const wrapper = form({ filters });

    await wrapper.get('[data-testid="vendor-export-filters-toggle"]').trigger('click');
    await wrapper.get('[data-testid="vendor-export-status-open"]').trigger('click');

    expect(filters.statuses).toEqual(['open']);
    wrapper.unmount();
  });
});
