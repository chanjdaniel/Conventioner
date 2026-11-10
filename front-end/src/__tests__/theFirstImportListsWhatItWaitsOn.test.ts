/**
 * The first import's refusal lists everything it waits on (T205/F09).
 *
 * A draft Google Form market with no dates, no location and no tables was refused for its dates;
 * the organizer picked them, came back, was refused for its location, and so on: three trips for
 * one list. The refusal now shows every blocker of the move into Review at once, each with its link to
 * where it is done for someone who may do it (T142). The role refusal and the past-review refusal
 * stay one sentence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { ref } from 'vue';

import CsvImportView from '@/views/CsvImportView.vue';
import {
  IntakeMode,
  MarketPhase,
  type Market,
  type PreconditionResult,
} from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const open = vi.hoisted(() => ({ market: null as unknown, refresh: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), resolve: (to: string) => ({ fullPath: to }) }),
  useRoute: () => ({ params: { marketId: 'market-1' }, fullPath: '/markets/market-1/import' }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: open.market, status: ref('ready'), refresh: open.refresh }),
}));

const setupBlocker = (id: string, message: string, label: string): PreconditionResult => ({
  id,
  passed: false,
  message,
  resolutionLink: 'setup',
  resolutionLabel: label,
  resolutionAction: MarketAction.ChangeSetup,
});
const NO_DATES = setupBlocker(
  'setup_has_dates',
  "This market has no market dates. Pick them on Market Setup's calendar.",
  'Pick market dates',
);
const NO_LOCATION = setupBlocker(
  'setup_has_a_location',
  'This market has no location. Add one on Market Setup.',
  'Add a location',
);
const NO_TABLES = setupBlocker(
  'every_tier_has_tables',
  'This market has no tables yet. Add a section with tables on Market Setup.',
  'Add tables',
);
const NOTHING_IMPORTED: PreconditionResult = {
  id: 'responses_imported',
  passed: false,
  message: "Nothing has been imported yet. Import your Google Form's responses first.",
  resolutionLink: 'import',
  resolutionLabel: 'Import responses',
  resolutionAction: MarketAction.ImportApplications,
};

function market(blockers: PreconditionResult[], overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Draft,
    intakeMode: IntakeMode.Csv,
    actionRefusals: answersRefusing(),
    transitionBlockers: { applications: blockers },
    ...overrides,
  } as Market;
}

async function openImport(shown: Market) {
  open.market = ref(shown);
  const wrapper = mount(CsvImportView, {
    global: {
      stubs: {
        MarketFrame: { template: '<div><slot /></div>' },
        AmendFormDialog: true,
        RouterLink: RouterLinkStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const refusal = (wrapper: Awaited<ReturnType<typeof openImport>>) =>
  wrapper.get('[data-testid="import-wrong-phase"]');
const links = (wrapper: Awaited<ReturnType<typeof openImport>>) =>
  wrapper.findAllComponents(RouterLinkStub).map((link) => [link.text(), link.props('to')]);

beforeEach(() => {
  open.refresh.mockReset();
  open.refresh.mockResolvedValue(undefined);
});

describe("the first import's refusal", () => {
  it('lists every missing thing at once, each linked to Market Setup', async () => {
    const wrapper = await openImport(market([NO_DATES, NO_LOCATION, NO_TABLES, NOTHING_IMPORTED]));

    const shown = refusal(wrapper);
    expect(shown.get('h2').text()).toBe('This market is not ready for its first import');
    expect(shown.text()).toContain('Before its first import, this market needs:');
    expect(shown.findAll('li').map((item) => item.text().split('\n')[0].trim())).toEqual([
      expect.stringContaining(NO_DATES.message),
      expect.stringContaining(NO_LOCATION.message),
      expect.stringContaining(NO_TABLES.message),
    ]);
    expect(shown.text()).not.toContain('Nothing has been imported yet');
    expect(links(wrapper)).toEqual([
      ['Pick market dates →', '/markets/market-1/setup'],
      ['Add a location →', '/markets/market-1/setup'],
      ['Add tables →', '/markets/market-1/setup'],
    ]);
    expect(shown.find('button').text()).toBe('Back to the market');
    expect(wrapper.find('[data-testid="import-upload"]').exists()).toBe(false);
  });

  it('says each item without a link to someone who may import but not change the setup (T142)', async () => {
    const wrapper = await openImport(
      market([NO_DATES, NO_LOCATION, NO_TABLES, NOTHING_IMPORTED], {
        actionRefusals: answersRefusing(MarketAction.ChangeSetup),
      }),
    );

    expect(refusal(wrapper).findAll('li')).toHaveLength(3);
    expect(refusal(wrapper).text()).toContain(NO_LOCATION.message);
    expect(links(wrapper)).toEqual([]);
  });

  it('shows one missing thing in the same list', async () => {
    const wrapper = await openImport(market([NO_LOCATION, NOTHING_IMPORTED]));

    expect(refusal(wrapper).text()).toContain('Before its first import, this market needs:');
    expect(refusal(wrapper).findAll('li')).toHaveLength(1);
    expect(links(wrapper)).toEqual([['Add a location →', '/markets/market-1/setup']]);
  });

  it('opens on the upload step for a draft waiting on nothing but the import', async () => {
    const wrapper = await openImport(market([NOTHING_IMPORTED]));

    expect(wrapper.find('[data-testid="import-wrong-phase"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="import-upload"]').exists()).toBe(true);
  });

  it('says only the role refusal to someone who may not import, before the plan', async () => {
    const wrapper = await openImport(
      market([NO_DATES, NO_LOCATION, NOTHING_IMPORTED], {
        actionRefusals: answersRefusing(MarketAction.ImportApplications),
      }),
    );

    const shown = refusal(wrapper);
    expect(shown.get('h2').text()).toBe('Importing into this market is not yours to do');
    expect(shown.text()).not.toContain('Before its first import');
    expect(shown.findAll('li')).toHaveLength(0);
  });

  it('stays the one sentence past Review', async () => {
    const wrapper = await openImport(market([], { phase: MarketPhase.Assignment }));

    const shown = refusal(wrapper);
    expect(shown.get('h2').text()).toBe('This market is not taking applications right now');
    expect(shown.text()).toContain('past review, so it takes no more applications');
    expect(shown.findAll('li')).toHaveLength(0);
  });

  it('says a market whose vendors apply on its page takes no import, never a checklist', async () => {
    const wrapper = await openImport(
      market([NO_DATES, NO_LOCATION, NO_TABLES, NOTHING_IMPORTED], {
        intakeMode: IntakeMode.Form,
      }),
    );

    const shown = refusal(wrapper);
    expect(shown.get('h2').text()).toBe("Vendors apply on this market's page");
    expect(shown.text()).toContain(
      'This market takes applications on its own page, so nothing is imported into it.',
    );
    expect(shown.text()).not.toContain('Before its first import');
    expect(shown.findAll('li')).toHaveLength(0);
    expect(links(wrapper)).toEqual([]);
  });
});
