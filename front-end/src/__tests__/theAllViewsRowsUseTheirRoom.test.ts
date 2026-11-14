/**
 * The All view's rows give their room to what they hold (E38/F10/S01).
 *
 * A row reads the applicant, the answers the market marked to lead a card, and the status with its
 * lines (who gave the verdict and when, the reviewer, the follow-up's owner). A market that marks
 * no answer to lead left the middle of every row an empty band while the status lines wrapped in a
 * narrow column beside it. With no leading answer in any listed row, the rows hold no leading
 * column, so the status lines take that room; with one, every row keeps it, so the rows line up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { FULL_NAME_KEY } from '@/utils/essentialFields';
import { answersRefusing } from './support/servedAnswers';

const fetchMarketApplications = vi.fn();
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: { reviewer: 'anyone' } }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return { ...actual, fetchMarketApplications: (id: string) => fetchMarketApplications(id) };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'ana@example.com' }));

function application(id: string, products?: string): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@vendor.test`,
    status: ApplicationStatus.Open,
    formData: products ? { products } : {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    reviewer: null,
  } as unknown as Application;
}

function market(highlights: string[]): Market {
  return {
    id: 'm1',
    phase: 'applications',
    roles: {},
    applicationForm: { fields: [{ key: 'products', label: 'Products', type: 'text', order: 0 }] },
    reviewHighlights: highlights,
    reviewTeam: { reviewers: [] },
    actionRefusals: {
      ...answersRefusing(),
      [MarketAction.GiveVerdicts]: null,
      [MarketAction.ChangeVerdicts]: null,
    },
  } as unknown as Market;
}

async function allView(props: { market: Market }) {
  const wrapper = mount(ApplicationsAll, {
    props,
    global: {
      stubs: {
        VendorDrawer: {
          template: '<div><slot name="actions" /></div>',
          methods: { entryFor: () => null, loadNotes: () => undefined },
        },
        ExportVendorsDialog: true,
        FollowUpDialog: true,
        ListFreshness: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const call of Object.values(api)) {
    call.mockReset();
    call.mockResolvedValue({ data: {} });
  }
  fetchMarketApplications.mockReset();
  fetchMarketApplications.mockResolvedValue([application('ann', 'Pins'), application('bo')]);
});

describe('the All view’s rows', () => {
  it('hold no leading column when no row has a leading answer, so the status takes its room', async () => {
    const wrapper = await allView({ market: market([]) });

    expect(wrapper.findAll('[data-testid="applications-all-row"]')).toHaveLength(2);
    expect(wrapper.findAll('.all-leading')).toHaveLength(0);
    expect(wrapper.find('.all-list').classes()).toContain('all-list-no-leading');
  });

  it('each keep the leading column when any row has a leading answer, so the rows line up', async () => {
    const wrapper = await allView({ market: market(['products']) });

    const leading = wrapper.findAll('.all-leading');
    expect(leading.map((cell) => cell.text())).toEqual(['Pins', '']);
    expect(wrapper.find('.all-list').classes()).not.toContain('all-list-no-leading');
  });

  it('break an address only before its “@” or a dot, never at a hyphen', async () => {
    const named = {
      ...application('door-comes-1794628088744'),
      formData: { [FULL_NAME_KEY]: 'Ann Example' },
    } as Application;
    fetchMarketApplications.mockResolvedValue([named, application('door-here-1794628088744')]);
    const wrapper = await allView({ market: market([]) });

    const parts = (selector: string) =>
      wrapper.findAll(`${selector} .email-address`).map((part) => part.text());
    // A named applicant's address under the name, and a nameless one's in the name's place.
    expect(parts('.all-email')).toEqual(['door-comes-1794628088744', '@vendor.test']);
    expect(parts('.all-name')).toEqual(['door-here-1794628088744', '@vendor.test']);
  });
});
