// @vitest-environment happy-dom
/**
 * Starting a draft from a Google Form's responses writes the plan, the form and the mapping in
 * one write, holding the market as the page read it (ADR 0024). A market that changed meanwhile,
 * another start or a question added in another tab, refuses it with the one sentence every
 * refused write says, and the page shows it on the review step, where the organizer can reload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

import ProposalLedger from '@/components/csvProposal/ProposalLedger.vue';
import StartFromCsvView from '@/views/StartFromCsvView.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { MARKET_CHANGED_CODE } from '@/utils/api';
import type { Proposal } from '@/utils/csvProposal';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
const push = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: { marketId: 'market-1' } }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({
    market: ref({
      id: 'market-1',
      name: 'Riverside',
      phase: MarketPhase.Draft,
      intakeMode: IntakeMode.Csv,
      actionRefusals: answersRefusing(),
      reviewTeam: { reviewers: [] },
    } as unknown as Market),
    status: ref('ready'),
    refresh: vi.fn(),
  }),
}));

const SENTENCE =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';

const PROPOSAL: Proposal = {
  rowCount: 1,
  responses: 1,
  columns: [],
  plan: { dates: [], year: null, tiers: [], ceiling: null, disagreements: [], check: [] },
  notAsked: [],
  typesafe: { asked: false },
};

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { configured: false } });
  api.post.mockReset();
  push.mockReset();
});

describe('a start refused because the market changed', () => {
  it('shows the sentence on the review step and goes nowhere', async () => {
    api.post.mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject({
            isAxiosError: true,
            response: { status: 409, data: { error: SENTENCE, code: MARKET_CHANGED_CODE } },
          })
        : Promise.resolve({ data: PROPOSAL }),
    );
    const wrapper = mount(StartFromCsvView, {
      global: { stubs: { MarketFrame: { template: '<div><slot /></div>' }, ProposalLedger: true } },
    });
    await flushPromises();
    const input = wrapper.get('[data-testid="start-from-csv-file-input"]');
    const file = new File(['Email Address\nada@example.test\n'], 'responses.csv');
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await flushPromises();

    wrapper.findComponent(ProposalLedger).vm.$emit('confirm');
    await flushPromises();

    expect(wrapper.get('[data-testid="start-from-csv-error"]').text()).toBe(SENTENCE);
    expect(wrapper.findComponent(ProposalLedger).exists()).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });
});
