/**
 * A market's vendors keep their applications when its placements cannot be read (T123, from
 * T119's review).
 *
 * `useVendorDetails` reads the applications, the assignment's statistics and the tables together.
 * One refusal emptied all three: an approved application with incomplete answers makes the server
 * refuse the two assignment reads, and the vendor drawer then said "This market asks no questions of
 * its own." of a market that asks some, the refusal shown nowhere in it. The applications stand on
 * their own read now, and the drawer says why the placements are missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Market } from '@/assets/types/datatypes';
import VendorDrawer from '@/components/VendorDrawer.vue';
import { useVendorDetails } from '@/utils/vendorDetails';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const REFUSAL =
  '1 approved application cannot be assigned until its answers are complete: alice@example.com (Available dates)';

const MARKET = {
  id: 'market-1',
  applicationForm: {
    fields: [{ key: 'business_name', label: 'Business Name', type: 'text', order: 0 }],
  },
  setupObject: { marketDates: [{ date: '2099-05-02' }] },
} as unknown as Market;

const BOB = {
  id: 'app-bob',
  applicantEmail: 'bob@example.com',
  status: 'reviewer_approved',
  formData: { business_name: 'Bob Prints', essential_full_name: 'Robert Example' },
};

function refused(message: string) {
  return Object.assign(new Error('Request failed with status code 400'), {
    response: { status: 400, data: { error: message } },
  });
}

/** The server: the applications read answers; the two assignment reads answer as `assignment` says. */
function serve(
  assignment: 'answers' | 'refuses',
  applications: 'answers' | 'refuses' = 'answers',
  vendorNames: Record<string, string> = {},
) {
  api.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/applications')) {
      if (applications === 'refuses') throw refused('You cannot read this market.');
      return { data: { applications: [BOB] } };
    }
    if (url.endsWith('/vendor-notes')) return { data: { notes: {} } };
    if (assignment === 'refuses') throw refused(REFUSAL);
    if (url.endsWith('/tables')) {
      return {
        data: {
          rows: [
            {
              date: '2099-05-02',
              tableCode: 'A1',
              assignment: ['bob@example.com'],
              section: 'Main',
              tier: 'Gold',
            },
          ],
          vendorNames,
          vendors: [{ email: 'bob@example.com', inTheRun: true, needsATable: true }],
        },
      };
    }
    return { data: {} };
  });
}

beforeEach(() => {
  api.get.mockReset();
  document.body.innerHTML = '';
});

describe('the vendors read', () => {
  it('keeps the applications, and says why, when the placements are refused', async () => {
    serve('refuses');
    const details = useVendorDetails(ref('market-1'), ref(MARKET));

    await details.load();

    expect(details.rowFor('bob@example.com')?.answers.business_name).toBe('Bob Prints');
    expect(details.loadError.value).toBe(REFUSAL);
    expect(details.placementsRead.value).toBe(false);
    expect(details.loaded.value).toBe(true);
  });

  it('keeps their names from the applications when the placements are refused', async () => {
    serve('refuses');
    const details = useVendorDetails(ref('market-1'), ref(MARKET));

    await details.load();

    expect(details.vendorNames.value).toEqual({ 'bob@example.com': 'Robert Example' });
  });

  it("takes the server's name over the application's where it gives one", async () => {
    serve('answers', 'answers', { 'bob@example.com': 'Bob' });
    const details = useVendorDetails(ref('market-1'), ref(MARKET));

    await details.load();

    expect(details.vendorNames.value).toEqual({ 'bob@example.com': 'Bob' });
  });

  it('holds nothing, and says why, when the applications are refused', async () => {
    serve('answers', 'refuses');
    const details = useVendorDetails(ref('market-1'), ref(MARKET));

    await details.load();

    expect(details.rows.value).toEqual([]);
    expect(details.loadError.value).toBe('You cannot read this market.');
    expect(details.loaded.value).toBe(false);
  });

  it('reads the placements, with no error, when the server answers all three', async () => {
    serve('answers');
    const details = useVendorDetails(ref('market-1'), ref(MARKET));

    await details.load();

    expect(details.loadError.value).toBe('');
    expect(details.placementsRead.value).toBe(true);
    expect(details.placementOn(details.rowFor('bob@example.com')!, '2099-05-02')).toContain('A1');
  });
});

describe('the vendor drawer, when the placements are refused', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function openOnBob(tab: 'application' | 'assignments') {
    serve('refuses');
    const Host = defineComponent({
      setup() {
        const details = useVendorDetails(ref('market-1'), ref(MARKET));
        return () => h(VendorDrawer, { market: MARKET, details, email: 'bob@example.com', tab });
      },
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    wrapper = mount(Host, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
  }

  it('shows their answers and the refusal, not "asks no questions"', async () => {
    await openOnBob('application');

    const panel = document.querySelector('[data-testid="vendor-drawer-panel-application"]')!;
    expect(panel.textContent).toContain('Bob Prints');
    expect(document.querySelector('#vendor-drawer-title')?.textContent).toBe('Robert Example');
    expect(panel.textContent).not.toContain('asks no questions');
    expect(
      document.querySelector('[data-testid="vendors-detail-load-error"]')?.textContent,
    ).toContain(REFUSAL);
  });

  it('offers no date card on the Assignments tab, since where they sit is unknown', async () => {
    await openOnBob('assignments');

    expect(
      document.querySelectorAll('[data-testid="vendors-detail-assignment-item"]'),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-testid="vendors-detail-load-error"]')?.textContent,
    ).toContain(REFUSAL);
  });
});
