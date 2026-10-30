/**
 * The rail's More… offers the stage's actions beside its moves (E38/F04/S02, S03): an own-form
 * market stops taking applications and takes them again, a fact about its form, and a Google Form
 * market redoes its import, which leaves it in Review.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import PhaseRail from '@/components/PhaseRail.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { movesServedFrom } from './support/servedMoves';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => router,
  useRoute: () => ({ path: '/markets/market-1/applications' }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});

beforeEach(() => {
  setActivePinia(createPinia());
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { market: {} } });
  router.push.mockReset();
});

async function menuOf(market: Partial<Market>) {
  const wrapper = mount(PhaseRail, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        phase: MarketPhase.Applications,
        transitionBlockers: movesServedFrom(MarketPhase.Applications),
        applicationsStopReason: null,
        actionRefusals: answersRefusing(),
        ...market,
      } as Market,
    },
    global: { stubs: { Teleport: true, BlockerPanel: true } },
  });
  await wrapper.get('[data-testid="phase-rail-menu-button"]').trigger('click');
  return wrapper;
}

describe('stopping and taking applications', () => {
  it('stops taking them from the menu, as a write about the form and no move', async () => {
    const rail = await menuOf({ intakeMode: IntakeMode.Form });

    await rail.get('[data-testid="phase-rail-action-stop-applications"]').trigger('click');

    expect(api.post).toHaveBeenCalledWith('/markets/market-1/applications-stopped', {
      stopped: true,
    });
    expect(api.post).not.toHaveBeenCalledWith(
      expect.stringContaining('/transition'),
      expect.anything(),
    );
  });

  it('takes them again once stopped', async () => {
    const rail = await menuOf({ intakeMode: IntakeMode.Form, applicationsStopped: true });

    await rail.get('[data-testid="phase-rail-action-take-applications"]').trigger('click');

    expect(api.post).toHaveBeenCalledWith('/markets/market-1/applications-stopped', {
      stopped: false,
    });
  });

  it('is not offered on a Google Form market', async () => {
    const rail = await menuOf({ intakeMode: IntakeMode.Csv });

    expect(rail.find('[data-testid="phase-rail-action-stop-applications"]').exists()).toBe(false);
  });
});

describe('Redo import', () => {
  it('opens the import, moving nothing', async () => {
    const rail = await menuOf({ intakeMode: IntakeMode.Csv });

    const redo = rail.get('[data-testid="phase-rail-action-redo-import"]');
    expect(redo.text()).toBe('Redo import');
    await redo.trigger('click');

    expect(router.push).toHaveBeenCalledWith('/markets/market-1/import');
    expect(api.post).not.toHaveBeenCalled();
  });
});
