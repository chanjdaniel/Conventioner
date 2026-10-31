/**
 * Exporting the vendors to a CSV (E42/F01/S01), from the Vendors page or the Applications tab (S03).
 *
 * "Export" opens on what the page shows: its filters and search become the dialog's, so the file
 * holds the vendors the organizer was looking at. The columns are ticked and put in order; the
 * server builds the file and the preview from the same filters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ExportVendorsDialog from '@/components/ExportVendorsDialog.vue';
import {
  applicationsAllSeed,
  chosenColumns,
  columnGroups,
  defaultOrder,
  exportSummary,
  localDay,
  movedColumn,
  NO_FILTERS,
  tickedColumn,
  vendorsPageSeed,
  type ExportPreview,
} from '@/utils/vendorExport';
import { filenameFrom } from '@/utils/download';
import type { ResultFilters } from '@/utils/resultFilters';
import { ApplicationStatus } from '@/assets/types/datatypes';

const posted: { url: string; body: unknown }[] = [];
let answer: (body: { columns?: string[] }) => ExportPreview;

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    api: {
      post: (url: string, body: { columns?: string[] }) => {
        posted.push({ url, body });
        return Promise.resolve({ data: answer(body), headers: {} });
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
  ],
  groups: [
    { id: 'vendor', label: 'Vendor' },
    { id: 'answers', label: 'Answers' },
    { id: 'assignment', label: 'Assignment' },
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
    { id: 'not_found', label: 'Not found' },
    { id: 'no_username', label: 'No username' },
  ],
};

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

  it('opens on the page’s filters and previews what they keep', async () => {
    const seed = { ...NO_FILTERS, statuses: ['approved' as const], placed: 'unplaced' as const };
    const wrapper = await opened(seed);

    expect(posted[0]).toMatchObject({
      url: '/markets/market-1/vendor-export/preview',
      body: { filters: seed },
    });
    expect(
      (wrapper.get('[data-testid="vendor-export-status-approved"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
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
    const wrapper = await opened({ ...NO_FILTERS, mine: true });

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
    await wrapper.get('[data-testid="vendor-export-move-up-answer:category"]').trigger('click');
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
    expect(groups.map((g) => g.get('legend').text())).toEqual(['Vendor', 'Answers', 'Assignment']);
    expect(wrapper.get('[data-testid="vendor-export-group-assignment"]').text()).toContain(
      'Sat 1 Aug - table',
    );
    wrapper.unmount();
  });

  it('lists only the ticked columns to put in order', async () => {
    const wrapper = await opened();

    await wrapper.get('[data-testid="vendor-export-column-datesPlaced"]').setValue(true);

    expect(
      wrapper.findAll('[data-testid="vendor-export-order-item"]').map((i) => i.text()),
    ).toEqual(['Name', 'Email', 'Status', 'Dates assigned']);
    wrapper.unmount();
  });

  it('offers a seat’s section, tier and size only for the vendors placed', async () => {
    const wrapper = await opened();

    expect(wrapper.find('[data-testid="vendor-export-tier"]').exists()).toBe(false);
    await wrapper.get('[data-testid="vendor-export-placed"]').setValue('placed');

    expect(wrapper.find('[data-testid="vendor-export-tier"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('offers no Discord filter on a market never checked', async () => {
    const wrapper = await opened();

    expect(wrapper.find('[data-testid="vendor-export-discord-not_found"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens on the page’s Discord state, and lists the Discord columns last', async () => {
    const wrapper = await opened({ ...NO_FILTERS, discord: ['not_found'] }, CHECKED);

    expect(posted[0]?.body).toMatchObject({ filters: { discord: ['not_found'] } });
    const box = (state: string) =>
      wrapper.get(`[data-testid="vendor-export-discord-${state}"]`).element as HTMLInputElement;
    expect(box('not_found').checked).toBe(true);
    expect(box('in_server').checked).toBe(false);
    expect(wrapper.get('[data-testid="vendor-export-discord"]').text()).toBe(
      'Discord (none ticked: any state) Has the role In the server Not found No username',
    );
    const groups = wrapper.findAll('[data-testid^="vendor-export-group-"]');
    expect(groups.map((g) => g.get('legend').text()).at(-1)).toBe('Discord');
    wrapper.unmount();
  });

  it('asks again with the Discord states ticked', async () => {
    vi.useFakeTimers();
    const wrapper = await opened(NO_FILTERS, CHECKED);
    await vi.runAllTimersAsync();
    posted.length = 0;

    await wrapper.get('[data-testid="vendor-export-discord-no_username"]').setValue(true);
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(posted.at(-1)?.body).toMatchObject({ filters: { discord: ['no_username'] } });
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
});
