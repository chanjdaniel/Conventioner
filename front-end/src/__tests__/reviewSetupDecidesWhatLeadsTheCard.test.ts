/**
 * Review waits on what a reviewer reads first (T206).
 *
 * While the market read serves the move into Review refused by `review_highlights_decided`, Review
 * setup's first section says it is not decided and what waits on it, and offers "Nothing leads the
 * card", one click. The choice reads back in words, and the next tick replaces it. A market past
 * draft is never served that blocker, so it is never told anything is undecided.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, h } from 'vue';

import MarketFormTab from '@/components/market/MarketFormTab.vue';
import type {
  ApplicationForm,
  Market,
  PreconditionResult,
  SetupObject,
} from '@/assets/types/datatypes';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const SETUP = {
  priority: [],
  marketDates: [],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {},
} as unknown as SetupObject;

const FORM: ApplicationForm = {
  fields: [
    {
      key: 'business_name',
      label: 'Business',
      type: 'text',
      required: false,
      options: [],
      order: 0,
    },
  ],
};

const UNDECIDED: PreconditionResult = {
  id: 'review_highlights_decided',
  passed: false,
  message: 'Nothing says what a reviewer reads first.',
  resolutionLink: 'form?step=review',
  resolutionLabel: 'Decide what reviewers read first',
  resolutionAction: 'change-form',
};

/** A draft whose move into Review waits on this decision, as the market read serves it. */
const WAITING = { transitionBlockers: { applications: [UNDECIDED], archived: [] } };

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockResolvedValue({ data: { application_form: FORM, essential_options: null } });
  api.put.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({
    data: { reviewHighlights: body.keys, nothingLeadsTheCard: body.nothingLeadsTheCard },
  }));
});

const Blank = defineComponent({ render: () => h('div') });

async function reviewSetup(market: Partial<Market> = {}): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/markets/:marketId/:page', component: Blank }],
  });
  await router.push('/markets/market-1/form?step=review');
  await router.isReady();
  const wrapper = mount(MarketFormTab, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        phase: 'draft',
        intakeMode: 'form',
        applicationForm: FORM,
        applicationFormLockReason: null,
        readOnlyReason: null,
        actionRefusals: answersRefusing(),
        reviewHighlights: [],
        nothingLeadsTheCard: false,
        ...market,
      } as Market,
      setupObject: SETUP,
    },
    global: {
      plugins: [router],
      stubs: { AutomaticRejections: { template: '<div />' } },
    },
  });
  await flushPromises();
  return wrapper;
}

const find = (wrapper: VueWrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`);
const shown = (wrapper: VueWrapper, testid: string) => find(wrapper, testid).exists();
const READ_BACK = "Nothing leads the card: a reviewer reads every answer, in the form's order.";

describe('what a reviewer reads first, undecided in a draft', () => {
  it('says opening applications waits on it, and offers Nothing leads the card', async () => {
    const wrapper = await reviewSetup(WAITING);

    expect(find(wrapper, 'review-highlights-undecided').text()).toBe(
      'Not decided yet. Opening applications waits on this.',
    );
    expect(find(wrapper, 'review-highlights-none').text()).toBe('Nothing leads the card');
    expect(shown(wrapper, 'review-highlights-none-chosen')).toBe(false);
  });

  it('says the first import waits on it on a Google Form market', async () => {
    const wrapper = await reviewSetup({ ...WAITING, intakeMode: 'csv' } as Partial<Market>);

    expect(find(wrapper, 'review-highlights-undecided').text()).toBe(
      'Not decided yet. Your first import waits on this.',
    );
  });

  it('decides in one click, reads the choice back, and keeps the answers below it', async () => {
    const wrapper = await reviewSetup(WAITING);

    await find(wrapper, 'review-highlights-none').trigger('click');
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/review-highlights', {
      keys: [],
      nothingLeadsTheCard: true,
    });
    expect(find(wrapper, 'review-highlights-none-chosen').text()).toBe(READ_BACK);
    expect(shown(wrapper, 'review-highlights-undecided')).toBe(false);
    expect(shown(wrapper, 'review-highlights-none')).toBe(false);
    expect(shown(wrapper, 'review-highlight-business_name')).toBe(true);
  });

  it('counts a ticked answer as the decision, offering no none beside it', async () => {
    const wrapper = await reviewSetup(WAITING);

    await find(wrapper, 'review-highlight-business_name').find('input').setValue(true);
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/review-highlights', {
      keys: ['business_name'],
      nothingLeadsTheCard: false,
    });
    expect(shown(wrapper, 'review-highlights-undecided')).toBe(false);
    expect(shown(wrapper, 'review-highlights-none')).toBe(false);
  });

  it('offers no none while an answer the market asks is marked', async () => {
    const wrapper = await reviewSetup({ ...WAITING, reviewHighlights: ['business_name'] });

    expect(shown(wrapper, 'review-highlights-none')).toBe(false);
  });

  it('still offers none when the only mark names a question the form no longer asks', async () => {
    const wrapper = await reviewSetup({ ...WAITING, reviewHighlights: ['removed_question'] });

    expect(shown(wrapper, 'review-highlights-undecided')).toBe(true);
    expect(shown(wrapper, 'review-highlights-none')).toBe(true);
  });
});

describe('Nothing leads the card, chosen', () => {
  it('reads back as the decision, with the answers still offered below it', async () => {
    const wrapper = await reviewSetup({ nothingLeadsTheCard: true });

    expect(find(wrapper, 'review-highlights-none-chosen').text()).toBe(READ_BACK);
    expect(shown(wrapper, 'review-highlights-undecided')).toBe(false);
    const readBack = find(wrapper, 'review-highlights-none-chosen').element;
    const answer = find(wrapper, 'review-highlight-business_name').element;
    expect(
      readBack.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is replaced by the next tick', async () => {
    const wrapper = await reviewSetup({ nothingLeadsTheCard: true });

    await find(wrapper, 'review-highlight-business_name').find('input').setValue(true);
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/review-highlights', {
      keys: ['business_name'],
      nothingLeadsTheCard: false,
    });
    expect(shown(wrapper, 'review-highlights-none-chosen')).toBe(false);
  });
});

describe('someone the table refuses the form', () => {
  it('is told it is undecided, and offered no button', async () => {
    const wrapper = await reviewSetup({ ...WAITING, actionRefusals: VIEWER_ANSWERS });

    expect(shown(wrapper, 'review-highlights-undecided')).toBe(true);
    expect(shown(wrapper, 'review-highlights-none')).toBe(false);
  });

  it('reads the choice back', async () => {
    const wrapper = await reviewSetup({
      nothingLeadsTheCard: true,
      actionRefusals: VIEWER_ANSWERS,
    });

    expect(find(wrapper, 'review-highlights-none-chosen').text()).toBe(READ_BACK);
  });
});

describe('a market past draft', () => {
  it('is never told it is undecided, with nothing marked and nothing chosen', async () => {
    const wrapper = await reviewSetup({
      phase: 'applications',
      applicationFormLockReason: 'The form is locked.',
      transitionBlockers: { draft: [], assignment: [], archived: [] },
    } as Partial<Market>);

    expect(shown(wrapper, 'review-highlights-undecided')).toBe(false);
    expect(shown(wrapper, 'review-highlights-none')).toBe(false);
    expect(shown(wrapper, 'review-highlights-none-chosen')).toBe(false);
  });
});

describe('the help line', () => {
  it('no longer says that leaving it empty is fine', async () => {
    const wrapper = await reviewSetup(WAITING);

    expect(find(wrapper, 'review-highlights').text()).not.toContain('Leave it empty');
  });
});
