/**
 * Giving a verdict is an Editor's; changing one is an Admin's or the owner's (E38/F06/S01). The
 * review offers "Approve instead" and "Reject instead" exactly when the server's
 * `verdictChangeReason` is unset, and says that reason once to an Editor, who gives verdicts but
 * changes none.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { isDecided } from '@/utils/verdicts';

const fetchMarketApplications = vi.fn();

// The review's own calls - a claim on the next card, the vendor's notes - answer nothing here.
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  return { ...actual, api: { get: answered, post: answered, put: answered, delete: answered } };
});

vi.mock('@/utils/applicantApi', () => ({
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  reviewApplication: vi.fn(),
  changedSinceSeen: vi.fn(() => null),
  reassignFollowUp: vi.fn(),
  publishResults: vi.fn(),
}));

const CHANGING = 'Only an Admin or the owner of this market changes a verdict already given.';

function application(id: string, status: ApplicationStatus): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@example.com`,
    status,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
  } as unknown as Application;
}

function market(verdictChangeReason: string | null): Market {
  return {
    id: 'm1',
    verdictLockReason: null,
    verdictChangeReason,
    peopleOnMarket: [],
    applicationForm: { fields: [] },
  } as unknown as Market;
}

async function reviewedList(verdictChangeReason: string | null) {
  const wrapper = mount(ApplicationMonitor, {
    props: { market: market(verdictChangeReason), visible: true },
  });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-decided-toggle"]').exists()).toBe(true);
  });
  await wrapper.get('[data-testid="app-monitor-decided-toggle"]').trigger('click');
  return wrapper;
}

describe('the reviewed list', () => {
  beforeEach(() => {
    fetchMarketApplications.mockResolvedValue([
      application('approved', ApplicationStatus.ReviewerApproved),
      application('rejected', ApplicationStatus.ReviewerRejected),
    ]);
  });

  it('offers an Editor no change, and says why once', async () => {
    const wrapper = await reviewedList(CHANGING);

    expect(wrapper.findAll('[data-testid="app-monitor-decided-row"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="app-monitor-decided-approve-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="app-monitor-decided-reject-button"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="app-monitor-decided-locked"]').text()).toBe(CHANGING);
  });

  it('offers an Admin or the owner "Approve instead" and "Reject instead"', async () => {
    const wrapper = await reviewedList(null);

    expect(wrapper.get('[data-testid="app-monitor-decided-approve-button"]').text()).toBe(
      'Approve instead',
    );
    expect(wrapper.get('[data-testid="app-monitor-decided-reject-button"]').text()).toBe(
      'Reject instead',
    );
    expect(wrapper.find('[data-testid="app-monitor-decided-locked"]').exists()).toBe(false);
  });
});

describe('what is decided', () => {
  it('is an approval or a rejection; a follow-up is marked, not decided', () => {
    expect(isDecided({ status: ApplicationStatus.ReviewerApproved })).toBe(true);
    expect(isDecided({ status: ApplicationStatus.ReviewerRejected })).toBe(true);
    expect(isDecided({ status: ApplicationStatus.NeedsFollowUp })).toBe(false);
    expect(isDecided({ status: ApplicationStatus.Open })).toBe(false);
  });
});
