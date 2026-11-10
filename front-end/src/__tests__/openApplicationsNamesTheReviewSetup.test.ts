/**
 * "Open applications" names the review setup (T206).
 *
 * Review waits on deciding what a reviewer reads first and the automatic rejections, so the dialog
 * that opens it shows both as the market serves them: the answers that lead the card, in the order
 * they lead it, or "Nothing leads the card"; how many rules reject an answer, or "None". Its
 * "Change" leads to Review setup and closes the dialog, for someone who may change the form.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import PhaseRail from '@/components/PhaseRail.vue';
import { useMarketStore } from '@/stores/market';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { movesServedFrom } from './support/servedMoves';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => router,
  useRoute: () => ({ path: '/markets/market-1/setup', query: {} }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

beforeEach(() => {
  setActivePinia(createPinia());
  useMarketStore().marketId = 'market-1';
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { market: {} } });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.put.mockReset();
  router.push.mockReset();
});

const QUESTIONS = [
  {
    key: 'product_type',
    label: 'Product type',
    answers: [
      { value: 'Prints', label: 'Prints' },
      { value: 'Food', label: 'Food' },
    ],
  },
  {
    key: 'returning',
    label: 'Returning vendor',
    answers: [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
];

function draft(market: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Draft,
    intakeMode: IntakeMode.Form,
    transitionBlockers: movesServedFrom(MarketPhase.Draft),
    actionRefusals: answersRefusing(),
    reviewTeam: { reviewers: [] },
    reviewerCandidates: [],
    applicationForm: {
      fields: [
        {
          key: 'business_name',
          label: 'Business name',
          type: 'text',
          required: true,
          options: [],
          order: 0,
        },
        {
          key: 'product_type',
          label: 'What do you sell?',
          type: 'select',
          required: true,
          options: ['Prints', 'Food'],
          order: 1,
        },
      ],
    },
    setupObject: null,
    reviewHighlights: [],
    nothingLeadsTheCard: true,
    rejectionRules: [],
    noAutomaticRejections: true,
    rejectionQuestions: QUESTIONS,
    ...market,
  } as Market;
}

const DIALOG = '[data-testid="open-applications-window"]';

async function pressOpen(market: Market): Promise<VueWrapper> {
  const wrapper = mount(PhaseRail, {
    props: { market },
    global: { stubs: { Teleport: true, BlockerPanel: true, RouterLink: RouterLinkStub } },
  });
  await wrapper.get('[data-testid="phase-transition-applications"]').trigger('click');
  await flushPromises();
  return wrapper;
}

function line(wrapper: VueWrapper, which: 'leads' | 'rejections'): string {
  return wrapper.get(`${DIALOG} [data-testid="open-applications-${which}"]`).text();
}

describe('what a reviewer reads first', () => {
  // A question most often ends in "?", so a comma after it would read "What do you sell?, Full
  // name"; a middle dot reads cleanly after any punctuation.
  it('names the answers that lead the card, in the order they lead it', async () => {
    const wrapper = await pressOpen(
      draft({
        reviewHighlights: ['product_type', 'essential_full_name', 'business_name'],
        nothingLeadsTheCard: false,
      }),
    );

    expect(line(wrapper, 'leads')).toBe(
      'What a reviewer reads first: What do you sell? · Full name · Business name',
    );
  });

  it('leaves out a mark on a question the form no longer asks', async () => {
    const wrapper = await pressOpen(
      draft({ reviewHighlights: ['gone_question', 'business_name'], nothingLeadsTheCard: false }),
    );

    expect(line(wrapper, 'leads')).toBe('What a reviewer reads first: Business name');
  });

  it('says "Nothing leads the card" when that is the choice', async () => {
    const wrapper = await pressOpen(draft());

    expect(line(wrapper, 'leads')).toBe('Nothing leads the card');
  });
});

describe('the automatic rejections', () => {
  it('counts the rules that reject an answer', async () => {
    const wrapper = await pressOpen(
      draft({
        rejectionRules: [
          { key: 'product_type', answers: ['Food'] },
          { key: 'returning', answers: ['No'] },
          { key: 'returning', answers: [] },
        ],
        noAutomaticRejections: false,
      }),
    );

    expect(line(wrapper, 'rejections')).toBe('Automatic rejections: 2 rules');
  });

  it('says one rule in the singular', async () => {
    const wrapper = await pressOpen(
      draft({
        rejectionRules: [{ key: 'product_type', answers: ['Food', 'Prints'] }],
        noAutomaticRejections: false,
      }),
    );

    expect(line(wrapper, 'rejections')).toBe('Automatic rejections: 1 rule');
  });

  it('says "None" when no automatic rejections is the choice', async () => {
    const wrapper = await pressOpen(draft());

    expect(line(wrapper, 'rejections')).toBe('Automatic rejections: None');
  });
});

describe('changing it', () => {
  it('"Change" leads to Review setup and closes the dialog, moving nothing', async () => {
    const wrapper = await pressOpen(draft());
    const change = wrapper
      .get(DIALOG)
      .findAllComponents(RouterLinkStub)
      .find(
        (link: VueWrapper) =>
          link.attributes('data-testid') === 'open-applications-change-review-setup',
      );

    expect(change?.text()).toBe('Change the review setup');
    expect(change?.props('to')).toBe('/markets/market-1/form?step=review');
    await change?.trigger('click');
    await flushPromises();

    expect(wrapper.find(DIALOG).exists()).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('is not offered to someone who may not change the form, who still reads the summary', async () => {
    const wrapper = await pressOpen(
      draft({ actionRefusals: answersRefusing(MarketAction.ChangeForm) }),
    );

    expect(
      wrapper.find(`${DIALOG} [data-testid="open-applications-change-review-setup"]`).exists(),
    ).toBe(false);
    expect(line(wrapper, 'leads')).toBe('Nothing leads the card');
  });
});

describe('a market that reaches the dialog undecided', () => {
  it('says so rather than reading a decision nobody took', async () => {
    const wrapper = await pressOpen(
      draft({ nothingLeadsTheCard: false, noAutomaticRejections: false }),
    );

    expect(line(wrapper, 'leads')).toBe('What a reviewer reads first: not decided yet');
    expect(line(wrapper, 'rejections')).toBe('Automatic rejections: not decided yet');
  });
});

describe('a move refused all the same', () => {
  it('reads the market again, so the page a fix leads to agrees with the panel', async () => {
    api.post.mockRejectedValue({
      response: {
        status: 409,
        data: {
          blockers: [
            {
              id: 'rejection_rules_decided',
              message: 'The automatic rejections are not decided.',
              resolutionLink: 'form?step=review',
            },
          ],
        },
      },
    });
    const wrapper = await pressOpen(draft());
    await wrapper.get(`${DIALOG} form`).trigger('submit');
    await flushPromises();

    expect(api.put).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="phase-rail-blockers"]').exists()).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/markets/market-1');
  });
});
