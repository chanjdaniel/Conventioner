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
const publishResults = vi.fn();

// A publish is followed by a re-read of the market, which is the store's to do.
vi.mock('@/stores/market', () => ({ useMarketStore: () => ({ refresh: vi.fn() }) }));
// The review's own calls - a claim on the next card, the vendor's notes - answer nothing here,
// rather than reaching for a server a unit test does not have.
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  return { ...actual, api: { get: answered, post: answered, put: answered, delete: answered } };
});

vi.mock('@/utils/applicantApi', () => ({
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  reviewApplication: vi.fn(),
  publishResults: (id: string) => publishResults(id),
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

function marketTaking(intakeMode?: IntakeMode, publish: Partial<Market> = {}): Market {
  return {
    id: 'm1',
    applicationForm: { fields: [] },
    intakeMode,
    publishResultsReason: null,
    publishOutcomes: { haveATable: 3, notAssigned: 2 },
    ...publish,
  } as unknown as Market;
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

describe('a form-intake market (E36/F04/S01)', () => {
  it('offers the control once the server would take it', async () => {
    const wrapper = await mounted(marketTaking(IntakeMode.Form));

    expect(wrapper.find(button).exists()).toBe(true);
    expect(wrapper.find<HTMLButtonElement>(button).element.disabled).toBe(false);
  });

  it("disables it with the server's reason until results may be published", async () => {
    const reason = 'Allocate tables first: results tell each applicant whether they have a table.';
    const wrapper = await mounted(
      marketTaking(IntakeMode.Form, { publishResultsReason: reason, publishOutcomes: null }),
    );

    expect(wrapper.find<HTMLButtonElement>(button).element.disabled).toBe(true);
    expect(wrapper.find(hint).text()).toBe(reason);
  });

  it('confirms with how many will read each outcome before publishing', async () => {
    const wrapper = await mounted(marketTaking(IntakeMode.Form));

    await wrapper.find(button).trigger('click');
    const confirm = wrapper.find('[data-testid="publish-results-window"]');
    expect(confirm.text()).toContain('3 applicants will read "You have a table"');
    expect(confirm.text()).toContain('2 will read "You did not get assigned"');
    expect(publishResults).not.toHaveBeenCalled();

    await wrapper.find('[data-testid="publish-results-submit-button"]').trigger('submit');
    expect(publishResults).toHaveBeenCalledWith('m1');
  });
});
