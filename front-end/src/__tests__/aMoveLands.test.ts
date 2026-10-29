/**
 * A move on the rail lands where the next step's work is (E32/F01/S01).
 *
 * The rail changed the phase and left the organizer on the page they started from, so Begin Review
 * left the import's result on screen and Publish never reached the door. Where it lands is the
 * guide's page for the phase entered - the page the market's own address and the tab's dot already
 * name - for a move in any direction.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import PhaseRail from '@/components/PhaseRail.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { movesServedFrom } from './support/servedMoves';

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

const ASSIGNED = { vendorAssignments: [{ vendorEmail: 'nadia@ember.test' }] };

beforeEach(() => {
  setActivePinia(createPinia());
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { market: {} } });
  router.push.mockReset();
});

async function move(market: Partial<Market>, toPhase: string) {
  const wrapper = mount(PhaseRail, {
    props: {
      market: {
        id: 'market-1',
        name: 'Riverside',
        transitionBlockers: movesServedFrom(String(market.phase)),
        ...market,
      } as Market,
    },
    global: { stubs: { Teleport: true, BlockerPanel: true } },
  });
  if (!wrapper.find(`[data-testid="phase-transition-${toPhase}"]`).exists()) {
    await wrapper.get('[data-testid="phase-rail-menu-button"]').trigger('click');
  }
  await wrapper.get(`[data-testid="phase-transition-${toPhase}"]`).trigger('click');
  if (toPhase === MarketPhase.MarketDays) {
    // The dialog is a native form: its confirm is the form's submit (AppDialog).
    await wrapper.get('[data-testid="sweep-confirm-window"] form').trigger('submit');
  }
  await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve));
  return wrapper;
}

describe('a move lands on the page for the phase it enters', () => {
  it('Open Applications lands on the review', async () => {
    await move({ phase: MarketPhase.Draft }, MarketPhase.Applications);

    expect(router.push).toHaveBeenCalledWith('/markets/market-1/applications');
  });

  it('Begin Assignment lands on the assignment', async () => {
    await move({ phase: MarketPhase.Applications }, MarketPhase.Assignment);

    expect(router.push).toHaveBeenCalledWith('/markets/market-1/assignment');
  });

  it('Publish lands at the door', async () => {
    await move(
      { phase: MarketPhase.Assignment, assignmentObject: ASSIGNED } as Partial<Market>,
      MarketPhase.MarketDays,
    );

    expect(router.push).toHaveBeenCalledWith('/markets/market-1/attendance');
  });

  it('a move back lands on its phase’s page too', async () => {
    await move({ phase: MarketPhase.Applications }, MarketPhase.Draft);

    expect(router.push).toHaveBeenCalledWith('/markets/market-1/setup');
  });

  it('a refused move goes nowhere', async () => {
    api.post.mockRejectedValue({
      response: { status: 409, data: { blockers: [{ id: 'x', message: 'Not yet.' }] } },
    });

    await move({ phase: MarketPhase.Applications }, MarketPhase.Assignment);

    expect(router.push).not.toHaveBeenCalled();
  });
});
