/**
 * `Publish Results` follows intake mode.
 *
 * The label is correct for what the button does: it flips `resultsPublished`, which is what makes
 * a reviewer's verdict visible to the applicant instead of `under_review`. But every endpoint that
 * reads that flag goes through `applicant_intake_market_by_slug`, which serves form-intake markets
 * only - so on a CSV market, which is every market this product can currently create, the flag has
 * no reader and the button was a no-op with a confident label.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import {
  ApplicationStatus,
  IntakeMode,
  type Application,
  type Market,
} from '@/assets/types/datatypes';

const fetchMarketApplications = vi.fn();

vi.mock('@/utils/applicantApi', () => ({
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  reviewApplication: vi.fn(),
  publishResults: vi.fn(),
}));

function application(status: ApplicationStatus): Application {
  return {
    id: `app-${status}`,
    marketId: 'm1',
    applicantEmail: 'nadia@ember.test',
    status,
    formData: {},
  } as unknown as Application;
}

function marketTaking(intakeMode?: IntakeMode): Market {
  return { id: 'm1', applicationForm: { fields: [] }, intakeMode } as unknown as Market;
}

async function mounted(market: Market) {
  const wrapper = mount(ApplicationMonitor, {
    props: { market, visible: true },
  });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-panel"]').exists()).toBe(true);
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

const button = '[data-testid="app-monitor-publish-button"]';
const hint = '[data-testid="app-monitor-publish-hint"]';

beforeEach(() => {
  fetchMarketApplications.mockResolvedValue([application(ApplicationStatus.ReviewerApproved)]);
});

describe('a market with no applicants', () => {
  it('offers no Publish Results control on a CSV market', async () => {
    const wrapper = await mounted(marketTaking(IntakeMode.Csv));

    expect(wrapper.find(button).exists()).toBe(false);
  });

  it('offers none on a market that names no intake mode, which reads as CSV', async () => {
    const wrapper = await mounted(marketTaking(undefined));

    expect(wrapper.find(button).exists()).toBe(false);
  });
});

describe('a form-intake market', () => {
  it('offers the control', async () => {
    const wrapper = await mounted(marketTaking(IntakeMode.Form));

    expect(wrapper.find(button).exists()).toBe(true);
    expect(wrapper.find<HTMLButtonElement>(button).element.disabled).toBe(false);
  });

  it('disables it with its reason when nothing has been reviewed', async () => {
    fetchMarketApplications.mockResolvedValue([application(ApplicationStatus.Open)]);

    const wrapper = await mounted(marketTaking(IntakeMode.Form));

    expect(wrapper.find<HTMLButtonElement>(button).element.disabled).toBe(true);
    expect(wrapper.find(hint).text()).toContain('nothing to publish yet');
  });
});
