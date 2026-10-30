/**
 * "Open Applications" offers the reviewers (E38/F07/S02).
 *
 * On a market whose vendors apply on its own page, the review is divided from the first submission
 * only if the reviewers are chosen before applications open. So the rail's move opens a dialog with
 * the picker for someone who may choose them; confirming writes the reviewers when the choice
 * differs from the stored team, then moves as the rail always has. Choosing no one opens as before,
 * and anyone who may move but not choose gets the move at once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
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
  useRoute: () => ({ path: '/markets/market-1/setup' }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

const ANA = 'ana@example.com';
const BEN = 'ben@example.com';
const CAT = 'cat@example.com';

beforeEach(() => {
  setActivePinia(createPinia());
  // The market open on the page, which a write's re-read asks for.
  useMarketStore().marketId = 'market-1';
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { market: {} } });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.put.mockReset();
  api.put.mockResolvedValue({ data: { dealt: 0 } });
  router.push.mockReset();
});

function draft(market: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Draft,
    intakeMode: IntakeMode.Form,
    transitionBlockers: movesServedFrom(MarketPhase.Draft),
    actionRefusals: answersRefusing(),
    reviewTeam: { reviewers: [] },
    reviewerCandidates: [ANA, BEN, CAT],
    ...market,
  } as Market;
}

const DIALOG = '[data-testid="open-applications-window"]';

async function pressOpen(market: Market): Promise<VueWrapper> {
  const wrapper = mount(PhaseRail, {
    props: { market },
    global: { stubs: { Teleport: true, BlockerPanel: true } },
  });
  await wrapper.get('[data-testid="phase-transition-applications"]').trigger('click');
  await flushPromises();
  return wrapper;
}

async function tick(wrapper: VueWrapper, ...emails: string[]) {
  for (const email of emails) {
    await wrapper.get(`${DIALOG} [data-testid="reviewer-picker-${email}"]`).setValue(true);
  }
}

async function confirm(wrapper: VueWrapper) {
  // The dialog is a native form: its confirm is the form's submit (AppDialog).
  await wrapper.get(`${DIALOG} form`).trigger('submit');
  await flushPromises();
}

function ticked(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll(`${DIALOG} input[type="checkbox"]`)
    .filter((box) => (box.element as HTMLInputElement).checked)
    .map((box) => String(box.attributes('data-testid')).replace('reviewer-picker-', ''));
}

describe('who meets the dialog', () => {
  it('someone who may choose reviewers meets the picker, with no one ticked', async () => {
    const wrapper = await pressOpen(draft());

    const dialog = wrapper.get(DIALOG);
    expect(dialog.attributes('aria-label')).toBe('Open applications');
    expect(dialog.find('[data-testid="reviewer-picker"]').exists()).toBe(true);
    expect(dialog.text()).toContain('Choose no one and everyone reviews first come, first served.');
    expect(wrapper.get('[data-testid="open-applications-submit-button"]').text()).toBe(
      'Open Applications',
    );
    expect(ticked(wrapper)).toEqual([]);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reviewers chosen in draft before are ticked', async () => {
    const wrapper = await pressOpen(
      draft({ reviewTeam: { reviewers: [{ email: BEN, able: true }] } }),
    );

    expect(ticked(wrapper)).toEqual([BEN]);
  });

  it('someone who may move the phase but not choose reviewers moves at once', async () => {
    const wrapper = await pressOpen(
      draft({ actionRefusals: answersRefusing(MarketAction.ChooseReviewers) }),
    );

    expect(wrapper.find(DIALOG).exists()).toBe(false);
    expect(api.post).toHaveBeenCalledWith('/markets/market-1/transition', {
      toPhase: MarketPhase.Applications,
    });
  });

  it("a Google Form market's move is unchanged: its way in is the import", async () => {
    const wrapper = await pressOpen(draft({ intakeMode: IntakeMode.Csv }));

    expect(wrapper.find(DIALOG).exists()).toBe(false);
    expect(api.post).toHaveBeenCalledWith('/markets/market-1/transition', {
      toPhase: MarketPhase.Applications,
    });
  });
});

describe('confirming', () => {
  it('writes the ticked reviewers, then moves and lands on the review', async () => {
    const wrapper = await pressOpen(draft());
    await tick(wrapper, CAT, ANA);
    await confirm(wrapper);

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/reviewers', {
      reviewers: [CAT, ANA],
    });
    expect(api.post).toHaveBeenCalledWith('/markets/market-1/transition', {
      toPhase: MarketPhase.Applications,
    });
    expect(api.put.mock.invocationCallOrder[0]).toBeLessThan(api.post.mock.invocationCallOrder[0]);
    expect(wrapper.find(DIALOG).exists()).toBe(false);
    expect(router.push).toHaveBeenCalledWith('/markets/market-1/applications');
  });

  it('with no one ticked opens exactly as before: nothing written', async () => {
    const wrapper = await pressOpen(draft());
    await confirm(wrapper);

    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/markets/market-1/transition', {
      toPhase: MarketPhase.Applications,
    });
    expect(router.push).toHaveBeenCalledWith('/markets/market-1/applications');
  });

  it('the stored team, untouched, is not written again', async () => {
    const wrapper = await pressOpen(
      draft({
        reviewTeam: {
          reviewers: [
            { email: ANA, able: true },
            { email: BEN, able: true },
          ],
        },
      }),
    );
    await confirm(wrapper);

    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalled();
  });

  it('unticking every stored reviewer writes the empty team', async () => {
    const wrapper = await pressOpen(
      draft({ reviewTeam: { reviewers: [{ email: ANA, able: true }] } }),
    );
    await wrapper.get(`${DIALOG} [data-testid="reviewer-picker-${ANA}"]`).setValue(false);
    await confirm(wrapper);

    expect(api.put).toHaveBeenCalledWith('/markets/market-1/reviewers', { reviewers: [] });
    expect(api.post).toHaveBeenCalled();
  });

  it('a reviewers write that fails keeps the dialog open with its error, and does not move', async () => {
    api.put.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'ana@example.com cannot be chosen here.' } },
    });
    const wrapper = await pressOpen(draft());
    await tick(wrapper, ANA);
    await confirm(wrapper);

    expect(wrapper.find(DIALOG).exists()).toBe(true);
    expect(wrapper.get('[data-testid="open-applications-error"]').text()).toBe(
      'ana@example.com cannot be chosen here.',
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a move refused after the write shows its blockers, and the market is read again with its reviewers', async () => {
    api.post.mockRejectedValue({
      response: {
        status: 409,
        data: { blockers: [{ id: 'form', message: 'Add a question to the form.' }] },
      },
    });
    const wrapper = await pressOpen(draft());
    await tick(wrapper, ANA);
    await confirm(wrapper);

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(wrapper.find(DIALOG).exists()).toBe(false);
    expect(wrapper.find('[data-testid="phase-rail-blockers"]').exists()).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith('/markets/market-1');
  });
});

describe('leaving without opening', () => {
  it('Cancel closes the dialog and writes nothing', async () => {
    const wrapper = await pressOpen(draft());
    await tick(wrapper, ANA);
    await wrapper.get('[data-testid="open-applications-cancel-button"]').trigger('click');
    await flushPromises();

    expect(wrapper.find(DIALOG).exists()).toBe(false);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opening it again starts from the stored team, not the abandoned ticks', async () => {
    const wrapper = await pressOpen(draft());
    await tick(wrapper, ANA);
    await wrapper.get('[data-testid="open-applications-cancel-button"]').trigger('click');
    await wrapper.get('[data-testid="phase-transition-applications"]').trigger('click');
    await flushPromises();

    expect(ticked(wrapper)).toEqual([]);
  });
});
