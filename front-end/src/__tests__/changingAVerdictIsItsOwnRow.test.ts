/**
 * Changing a verdict is its own row of the table (E38/F06/S01).
 *
 * Giving a verdict on an open application or a follow-up is the row "Give verdicts and follow-ups";
 * changing one already approved or rejected, an automatic rejection included, is "Change a verdict,
 * or overturn an automatic rejection". One by one offers "Approve instead" and "Reject instead",
 * and the verdicts on a card someone else decided first, only to someone the second row lets
 * change it, and says once why not to anyone else.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { isDecided } from '@/utils/verdicts';

const fetchMarketApplications = vi.fn();
const reviewApplication = vi.fn();

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  return { ...actual, api: { get: answered, post: answered, put: answered, delete: answered } };
});

vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return {
    ...actual,
    fetchMarketApplications: (id: string) => fetchMarketApplications(id),
    reviewApplication: (...args: unknown[]) => reviewApplication(...args),
    publishResults: vi.fn(),
  };
});

const CHANGE_REFUSED =
  'Only an Admin or the owner may change a verdict or overturn an automatic rejection on this market.';

function application(id: string, status: ApplicationStatus, extra = {}): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@example.com`,
    status,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    ...extra,
  } as unknown as Application;
}

const RULE = { kind: 'rule', rule: 'no_shows' };

function market(changes: boolean): Market {
  return {
    id: 'm1',
    applicationForm: { fields: [{ key: 'shop', label: 'Shop', type: 'text' }] },
    actionRefusals: {
      'give-verdicts': null,
      'change-verdicts': changes ? null : CHANGE_REFUSED,
    },
  } as unknown as Market;
}

async function reviewedList(changes: boolean) {
  const wrapper = mount(ApplicationMonitor, { props: { market: market(changes), visible: true } });
  await flushPromises();
  await wrapper.get('[data-testid="app-monitor-decided-toggle"]').trigger('click');
  return wrapper;
}

describe('isDecided', () => {
  it('is approved or rejected; a follow-up and an open one are not', () => {
    expect(isDecided({ status: ApplicationStatus.ReviewerApproved })).toBe(true);
    expect(isDecided({ status: ApplicationStatus.ReviewerRejected })).toBe(true);
    expect(isDecided({ status: ApplicationStatus.NeedsFollowUp })).toBe(false);
    expect(isDecided({ status: ApplicationStatus.Open })).toBe(false);
  });
});

describe('the reviewed list, one by one', () => {
  beforeEach(() => {
    fetchMarketApplications.mockResolvedValue([
      application('open', ApplicationStatus.Open),
      application('approved', ApplicationStatus.ReviewerApproved),
      application('ruled-out', ApplicationStatus.ReviewerRejected, { verdictBy: RULE }),
    ]);
  });

  it('offers no change to someone the change row refuses, and says why once', async () => {
    const wrapper = await reviewedList(false);

    expect(wrapper.findAll('[data-testid="app-monitor-decided-approve-button"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-testid="app-monitor-decided-reject-button"]')).toHaveLength(0);
    expect(wrapper.get('[data-testid="app-monitor-decided-reason"]').text()).toBe(CHANGE_REFUSED);
    // A first verdict is still theirs.
    expect(wrapper.find('[data-testid="app-monitor-approve-button"]').exists()).toBe(true);
  });

  it('offers each change, an automatic rejection included, to someone it lets change one', async () => {
    const wrapper = await reviewedList(true);

    expect(wrapper.findAll('[data-testid="app-monitor-decided-approve-button"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="app-monitor-decided-reject-button"]')).toHaveLength(1);
    expect(wrapper.find('[data-testid="app-monitor-decided-reason"]').exists()).toBe(false);
  });
});

describe('a card someone else decided first', () => {
  beforeEach(() => {
    fetchMarketApplications.mockResolvedValue([application('open', ApplicationStatus.Open)]);
    const decided = application('open', ApplicationStatus.ReviewerApproved, {
      verdictBy: { kind: 'person', email: 'kai@example.com' },
    });
    reviewApplication.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          error: 'kai@example.com approved this application since you opened it.',
          application: decided,
        },
      },
    });
  });

  async function refusedCard(changes: boolean) {
    const wrapper = mount(ApplicationMonitor, {
      props: { market: market(changes), visible: true },
    });
    await flushPromises();
    await wrapper.get('[data-testid="app-monitor-reject-button"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="app-monitor-changed"]').exists()).toBe(true);
    return wrapper;
  }

  it('offers no verdict on it to someone the change row refuses', async () => {
    const wrapper = await refusedCard(false);

    expect(wrapper.find('[data-testid="app-monitor-approve-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="app-monitor-reject-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="app-monitor-follow-up-button"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="app-monitor-card-change-reason"]').text()).toBe(
      CHANGE_REFUSED,
    );
  });

  it('offers it to someone it lets change one', async () => {
    const wrapper = await refusedCard(true);

    expect(wrapper.find('[data-testid="app-monitor-approve-button"]').exists()).toBe(true);
  });
});
