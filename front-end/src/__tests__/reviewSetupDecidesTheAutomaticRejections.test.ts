/**
 * Review waits on the automatic rejections (T206).
 *
 * While the market read serves the move into Review refused by `rejection_rules_decided`, Review
 * setup's second section says it is not decided and what waits on it, and offers "No automatic
 * rejections", one click. The choice reads back in words, and the next rule that rejects an answer
 * replaces it. A rule with no answer ticked rejects nobody, so it decides nothing. While the rules
 * are closed, from Assignment on, the section reads as it always did; Back to review reopens them.
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
  RejectionQuestion,
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
      key: 'no_shows',
      label: 'No-shows',
      type: 'checkbox',
      required: false,
      options: [],
      order: 0,
    },
  ],
};

const QUESTIONS: RejectionQuestion[] = [
  {
    key: 'no_shows',
    label: 'No-shows',
    answers: [
      { value: 'ticked', label: 'Ticked' },
      { value: 'not ticked', label: 'Not ticked' },
    ],
  },
];

const UNDECIDED: PreconditionResult = {
  id: 'rejection_rules_decided',
  passed: false,
  message: 'The automatic rejections are not decided.',
  resolutionLink: 'form?step=review',
  resolutionLabel: 'Decide the automatic rejections',
  resolutionAction: 'change-form',
};

/** A draft whose move into Review waits on this decision, as the market read serves it. */
const WAITING = { transitionBlockers: { applications: [UNDECIDED], archived: [] } };

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockResolvedValue({ data: { application_form: FORM, essential_options: null } });
  api.put.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({
    data: { rejectionRules: body.rules, noAutomaticRejections: body.noAutomaticRejections },
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
        nothingLeadsTheCard: true,
        rejectionQuestions: QUESTIONS,
        rejectionRules: [],
        rejectionRulesLockReason: null,
        noAutomaticRejections: false,
        ...market,
      } as Market,
      setupObject: SETUP,
    },
    global: {
      plugins: [router],
      stubs: { ReviewHighlights: { template: '<div />' } },
    },
  });
  await flushPromises();
  return wrapper;
}

const find = (wrapper: VueWrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`);
const shown = (wrapper: VueWrapper, testid: string) => find(wrapper, testid).exists();
const READ_BACK = 'No automatic rejections: every application arrives undecided.';

async function addRule(wrapper: VueWrapper) {
  await find(wrapper, 'rejection-rule-question').setValue('no_shows');
  await find(wrapper, 'rejection-rule-add').trigger('click');
  await flushPromises();
}

describe('the automatic rejections, undecided in a draft', () => {
  it('says opening applications waits on them, and offers No automatic rejections', async () => {
    const wrapper = await reviewSetup(WAITING);

    expect(find(wrapper, 'rejection-rules-undecided').text()).toBe(
      'Not decided yet. Opening applications waits on this.',
    );
    expect(find(wrapper, 'rejection-rules-none').text()).toBe('No automatic rejections');
    expect(shown(wrapper, 'rejection-rules-none-chosen')).toBe(false);
  });

  // The help explains the rules, so it heads the section, never sits under the "none" button as if
  // it described that.
  it('keeps the help line above the decision, and the rules below it', async () => {
    const wrapper = await reviewSetup(WAITING);
    const follows = (first: Element, second: Element) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    const help = wrapper.find('.rejections-help').element;
    const none = find(wrapper, 'rejection-rules-none').element;
    expect(follows(help, find(wrapper, 'rejection-rules-undecided').element)).toBe(true);
    expect(follows(help, none)).toBe(true);
    expect(follows(none, find(wrapper, 'rejection-rule-question').element)).toBe(true);
  });

  it('says the first import waits on them on a Google Form market', async () => {
    const wrapper = await reviewSetup({ ...WAITING, intakeMode: 'csv' } as Partial<Market>);

    expect(find(wrapper, 'rejection-rules-undecided').text()).toBe(
      'Not decided yet. Your first import waits on this.',
    );
  });

  it('decides in one click, reads the choice back, and keeps the rules below it', async () => {
    const wrapper = await reviewSetup(WAITING);

    await find(wrapper, 'rejection-rules-none').trigger('click');
    await flushPromises();

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/rejection-rules', {
      rules: [],
      noAutomaticRejections: true,
    });
    expect(find(wrapper, 'rejection-rules-none-chosen').text()).toBe(READ_BACK);
    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
    expect(shown(wrapper, 'rejection-rule-add')).toBe(true);
    // The read-back says it; "No answer rejects automatically" would say it twice.
    expect(find(wrapper, 'automatic-rejections').text()).not.toContain(
      'No answer rejects automatically',
    );
  });

  it('counts a rule with no answer ticked as no decision', async () => {
    const wrapper = await reviewSetup(WAITING);

    await addRule(wrapper);

    expect(api.put).toHaveBeenLastCalledWith('/markets/market-1/rejection-rules', {
      rules: [{ key: 'no_shows', answers: [] }],
      noAutomaticRejections: false,
    });
    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(true);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(true);
  });

  it('counts a rule that rejects an answer as the decision, with no none beside it', async () => {
    const wrapper = await reviewSetup(WAITING);

    await addRule(wrapper);
    await find(wrapper, 'rejection-answer-no_shows-not ticked').find('input').setValue(true);
    await flushPromises();

    expect(api.put).toHaveBeenLastCalledWith('/markets/market-1/rejection-rules', {
      rules: [{ key: 'no_shows', answers: ['not ticked'] }],
      noAutomaticRejections: false,
    });
    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
  });

  it('offers no none while a rule rejects an answer', async () => {
    const wrapper = await reviewSetup({
      ...WAITING,
      rejectionRules: [{ key: 'no_shows', answers: ['not ticked'] }],
    });

    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
  });
});

describe('No automatic rejections, chosen', () => {
  it('reads back as the decision, with the condition builder still below it', async () => {
    const wrapper = await reviewSetup({ noAutomaticRejections: true });

    expect(find(wrapper, 'rejection-rules-none-chosen').text()).toBe(READ_BACK);
    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(false);
    const readBack = find(wrapper, 'rejection-rules-none-chosen').element;
    const builder = find(wrapper, 'rejection-rule-add').element;
    expect(
      readBack.compareDocumentPosition(builder) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is replaced by the next rule', async () => {
    const wrapper = await reviewSetup({ noAutomaticRejections: true });

    await addRule(wrapper);

    expect(api.put).toHaveBeenLastCalledWith('/markets/market-1/rejection-rules', {
      rules: [{ key: 'no_shows', answers: [] }],
      noAutomaticRejections: false,
    });
    expect(shown(wrapper, 'rejection-rules-none-chosen')).toBe(false);
  });
});

describe('someone the table refuses the form', () => {
  it('is told it is undecided, and offered no button', async () => {
    const wrapper = await reviewSetup({ ...WAITING, actionRefusals: VIEWER_ANSWERS });

    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(true);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
  });

  it('reads the choice back, once', async () => {
    const wrapper = await reviewSetup({
      noAutomaticRejections: true,
      actionRefusals: VIEWER_ANSWERS,
    });

    expect(find(wrapper, 'rejection-rules-none-chosen').text()).toBe(READ_BACK);
    expect(find(wrapper, 'automatic-rejections').text()).not.toContain(
      'No answer rejects automatically',
    );
  });
});

describe('a market past draft', () => {
  it('in Review is never told it is undecided, with no rule and nothing chosen', async () => {
    const wrapper = await reviewSetup({
      phase: 'applications',
      applicationFormLockReason: 'The form is locked.',
      transitionBlockers: { draft: [], assignment: [], archived: [] },
    } as Partial<Market>);

    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none-chosen')).toBe(false);
  });

  it('in a reopened review reads the choice back again, and asks nothing', async () => {
    const wrapper = await reviewSetup({
      phase: 'applications',
      applicationFormLockReason: 'The form is locked.',
      noAutomaticRejections: true,
      transitionBlockers: { draft: [], assignment: [], archived: [] },
    } as Partial<Market>);

    expect(find(wrapper, 'rejection-rules-none-chosen').text()).toBe(READ_BACK);
    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
  });

  it('in Assignment reads as closed rules always have, whatever was chosen', async () => {
    const wrapper = await reviewSetup({
      phase: 'assignment',
      applicationFormLockReason: 'The form is locked.',
      rejectionRulesLockReason: 'The automatic rejections are closed while tables are allocated.',
      noAutomaticRejections: true,
      transitionBlockers: { applications: [], offers: [], archived: [] },
    } as Partial<Market>);

    expect(shown(wrapper, 'rejection-rules-locked')).toBe(true);
    expect(shown(wrapper, 'rejection-rules-undecided')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none')).toBe(false);
    expect(shown(wrapper, 'rejection-rules-none-chosen')).toBe(false);
    expect(find(wrapper, 'automatic-rejections').text()).toContain(
      'No answer rejects automatically.',
    );
  });
});
