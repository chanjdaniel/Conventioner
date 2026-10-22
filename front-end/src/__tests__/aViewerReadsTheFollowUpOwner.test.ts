/**
 * A Viewer who may not give a verdict still reads who owns a follow-up (T15). The owner is a
 * recorded fact on the application, not a candidate option, so gating `peopleOnMarket` to
 * verdict-givers left a Viewer's "Followed up by" select empty. A Viewer reads the owner as plain
 * text; an Editor or above keeps the select to hand the follow-up on.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';

const fetchMarketApplications = vi.fn();

vi.mock('@/utils/applicantApi', () => ({
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  reviewApplication: vi.fn(),
  changedSinceSeen: vi.fn(() => null),
  reassignFollowUp: vi.fn(),
  publishResults: vi.fn(),
}));

const VIEWER = 'You can view this market but not change it.';

function followUpApplication(email: string): Application {
  return {
    id: email,
    marketId: 'm1',
    applicantEmail: email,
    status: ApplicationStatus.NeedsFollowUp,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    followUpOwner: { email: 'robin@org.test' },
  } as unknown as Application;
}

function market(verdictLockReason: string | null, peopleOnMarket: string[]): Market {
  return {
    id: 'm1',
    verdictLockReason,
    peopleOnMarket,
    applicationForm: { fields: [] },
  } as unknown as Market;
}

/** Mount the review on a card that needs a follow-up, asking for follow-ups to be walked. */
async function mountFollowUpCard(verdictLockReason: string | null, peopleOnMarket: string[]) {
  const wrapper = mount(ApplicationMonitor, {
    props: { market: market(verdictLockReason, peopleOnMarket), visible: true },
  });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-include-follow-ups"]').exists()).toBe(true);
  });
  await wrapper.get('[data-testid="app-monitor-include-follow-ups"]').setValue(true);
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(true);
  });
  return wrapper;
}

describe('who owns a follow-up on the card', () => {
  beforeEach(() => {
    fetchMarketApplications.mockResolvedValue([followUpApplication('nadia@ember.test')]);
  });

  it('a Viewer reads the recorded owner as plain text, not an empty select', async () => {
    const wrapper = await mountFollowUpCard(VIEWER, []);

    expect(wrapper.find('select[data-testid="app-monitor-follow-up-owner"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="app-monitor-follow-up-owner"]').text()).toBe(
      'robin@org.test',
    );
  });

  it('an Editor or above still gets the select to hand the follow-up on', async () => {
    const wrapper = await mountFollowUpCard(null, ['robin@org.test']);

    expect(wrapper.find('select[data-testid="app-monitor-follow-up-owner"]').exists()).toBe(true);
    expect(
      (wrapper.get('[data-testid="app-monitor-follow-up-owner"]').element as HTMLSelectElement)
        .value,
    ).toBe('robin@org.test');
  });
});
