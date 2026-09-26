/**
 * The triage advisory told every organizer that adding a question was "possible while the market
 * is a draft and nobody has applied" - a statement of the rule, not of their market. By the time
 * anyone reads it on a queue of real applications, the form is already frozen, so it advised a
 * thing the product had just made impossible.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';

const fetchMarketApplications = vi.fn();

vi.mock('@/utils/applicantApi', () => ({
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  reviewApplication: vi.fn(),
  publishResults: vi.fn(),
}));

function application(email: string): Application {
  return {
    id: email,
    marketId: 'm1',
    applicantEmail: email,
    status: ApplicationStatus.Open,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
  } as unknown as Application;
}

/** A market whose form asks only the essential questions, which is what triggers the advisory. */
const market = { id: 'm1', applicationForm: { fields: [] } } as unknown as Market;

async function advisory(): Promise<string> {
  const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-advisory"]').exists()).toBe(true);
  });
  return wrapper.get('[data-testid="app-monitor-advisory"]').text().replace(/\s+/g, ' ');
}

describe('the triage advisory', () => {
  beforeEach(() => {
    fetchMarketApplications.mockResolvedValue([application('nadia@ember.ca')]);
  });

  /**
   * It renders only once applications exist, and by then the D9 lock has frozen the form: pointing
   * at the form builder could only ever advise an edit the server would refuse (E21/F02/S03).
   */
  it('says the form is frozen, rather than advising an edit that would be refused', async () => {
    const text = await advisory();

    expect(text).toContain('frozen for this market');
    expect(text).not.toContain('Application Form tab');
  });

  it('describes the market in front of the reviewer', async () => {
    expect(await advisory()).toContain('asks only the essential questions');
  });
});
