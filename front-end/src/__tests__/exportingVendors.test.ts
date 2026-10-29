/**
 * Exporting the vendors to a CSV (E42/F01/S01).
 *
 * "Export" opens on what the page shows: its filters and search become the dialog's, so the file
 * holds the vendors the organizer was looking at. The columns are ticked and put in order; the
 * server builds the file and the preview from the same filters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ExportVendorsDialog from '@/components/ExportVendorsDialog.vue';
import {
  chosenColumns,
  columnChoices,
  exportSummary,
  localDay,
  movedColumn,
  NO_FILTERS,
  vendorsPageSeed,
  type ExportPreview,
} from '@/utils/vendorExport';
import { filenameFrom } from '@/utils/download';
import type { ResultFilters } from '@/utils/resultFilters';

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

  it('turns "Unassigned only" into the approved vendors with no seat', () => {
    expect(vendorsPageSeed({ shown: 'unassigned', filters: NOTHING, search: '' })).toEqual({
      ...NO_FILTERS,
      statuses: ['approved'],
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
      filters: { ...NOTHING, date: '2026-11-18', section: 'Atrium', tier: 'Gold', choice: 'half' },
      search: '',
    });

    expect(seed).toEqual({
      ...NO_FILTERS,
      placed: 'placed',
      date: '2026-11-18',
      section: 'Atrium',
      tier: 'Gold',
      size: 'half',
    });
  });

  it('carries the search, as typed but trimmed', () => {
    expect(vendorsPageSeed({ shown: null, filters: NOTHING, search: '  ana ' }).search).toBe('ana');
  });
});

describe('the columns', () => {
  const offered = [
    { id: 'name', label: 'Name' },
    { id: 'email', label: 'Email' },
    { id: 'status', label: 'Status' },
    { id: 'answer:category', label: 'Category' },
  ];

  it('lists every column, the ticked ones first in their order', () => {
    const choices = columnChoices(offered, ['email', 'name']);

    expect(choices.map((c) => [c.id, c.ticked])).toEqual([
      ['email', true],
      ['name', true],
      ['status', false],
      ['answer:category', false],
    ]);
  });

  it('exports the ticked ones in the order they are listed', () => {
    let choices = columnChoices(offered, ['name', 'email', 'answer:category']);
    choices = movedColumn(choices, 2, -2);

    expect(chosenColumns(choices)).toEqual(['answer:category', 'name', 'email']);
  });

  it('moves a column no further than either end', () => {
    const choices = columnChoices(offered, []);

    expect(movedColumn(choices, 0, -1)).toBe(choices);
    expect(movedColumn(choices, 3, 1)).toBe(choices);
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
    { id: 'name', label: 'Name' },
    { id: 'preferredName', label: 'Preferred name' },
    { id: 'email', label: 'Email' },
    { id: 'status', label: 'Status' },
    { id: 'answer:category', label: 'Category' },
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
  sections: ['Atrium', 'Hall'],
  tiers: ['Gold', 'Silver'],
  questions: [{ key: 'category', label: 'Category', options: ['Crafts', 'Food'] }],
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

  async function opened(seed = NO_FILTERS) {
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

  it('asks again with the columns in the order they are put', async () => {
    vi.useFakeTimers();
    const wrapper = await opened();
    await vi.runAllTimersAsync();
    posted.length = 0;

    await wrapper.get('[data-testid="vendor-export-column-answer:category"]').setValue(true);
    for (const _ of [1, 2]) {
      await wrapper.get('[data-testid="vendor-export-move-up-answer:category"]').trigger('click');
    }
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

  it('offers a seat’s section, tier and size only for the vendors placed', async () => {
    const wrapper = await opened();

    expect(wrapper.find('[data-testid="vendor-export-tier"]').exists()).toBe(false);
    await wrapper.get('[data-testid="vendor-export-placed"]').setValue('placed');

    expect(wrapper.find('[data-testid="vendor-export-tier"]').exists()).toBe(true);
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
