// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';

import MarketPlanTab from '@/components/market/MarketPlanTab.vue';
import { IntakeMode, type SetupObject } from '@/assets/types/datatypes';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ params: { marketId: 'market-1' }, matched: [] }),
}));

/**
 * Section Setup offers each named location's layout under its rows (T257 ticket 02): "Lay out
 * Upper Hall" before it has one, "Open Upper Hall's layout · N tables" once it has, and nothing for
 * a location with no name. The way in from the floorplan beta ("Set up sections from a floorplan
 * instead") is gone.
 */
const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const LOWER = { id: 'loc-lower', name: 'Lower Hall' };

function plan(overrides: Partial<SetupObject> = {}): SetupObject {
  return {
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [UPPER, LOWER, { id: 'loc-blank', name: '  ' }, { name: 'Unmigrated' }],
    sections: [],
    assignmentOptions: {},
    floorplans: [],
    ...overrides,
  } as unknown as SetupObject;
}

const LAID_OUT = {
  id: 'fp-1',
  locationId: 'loc-lower',
  revision: 2,
  tables: [{ id: 't-1' }, { id: 't-2' }],
  zones: [],
  sectionStyles: [],
  startingCounts: [],
};

function mountPlan(
  setupObject: SetupObject,
  { readOnly = false, settled = null as string | null } = {},
) {
  return mount(MarketPlanTab, {
    props: {
      marketId: 'market-1',
      setupObject,
      intakeMode: IntakeMode.Form,
      intakeEditable: true,
      csvStartRefusal: null,
      readOnly,
      setupLockReason: settled,
      formQuestions: 0,
      formLockReason: null,
      choiceQuestions: [],
    },
    global: {
      stubs: {
        ElementSettingContainer: {
          template: '<div><slot name="setting-title" /><slot name="setting-content" /></div>',
        },
        RouterLink: RouterLinkStub,
      },
    },
  });
}

describe("Section Setup's layouts", () => {
  it('offers to lay out each named location, and opens the one laid out with its count', () => {
    const wrapper = mountPlan(plan({ floorplans: [LAID_OUT] as never }));

    const lines = wrapper.get('[data-testid="plan-layouts"]').findAll('li');
    expect(lines.map((line) => line.text())).toEqual([
      'Lay out Upper Hall',
      "Open Lower Hall's layout · 2 tables",
    ]);
  });

  it('asks to open a layout, so the plan saves first', async () => {
    const wrapper = mountPlan(plan());

    await wrapper.get('[data-testid="plan-layout-start-loc-upper"]').trigger('click');

    expect(wrapper.emitted('openLayout')).toEqual([['loc-upper']]);
  });

  it('counts one table as one', () => {
    const one = { ...LAID_OUT, tables: [{ id: 't-1' }] };
    const wrapper = mountPlan(plan({ floorplans: [one] as never }));

    expect(wrapper.get('[data-testid="plan-layout-open-loc-lower"]').text()).toBe(
      "Open Lower Hall's layout · 1 table",
    );
  });

  it('offers a plan that cannot change only the layouts it has, as links', () => {
    for (const locks of [{ readOnly: true }, { settled: 'The setup has settled.' }]) {
      const wrapper = mountPlan(plan({ floorplans: [LAID_OUT] as never }), locks);

      expect(wrapper.find('[data-testid="plan-layout-start-loc-upper"]').exists()).toBe(false);
      const link = wrapper.getComponent(RouterLinkStub);
      expect(link.props('to')).toBe('/markets/market-1/layout/loc-lower');
      expect(link.text()).toBe("Open Lower Hall's layout · 2 tables");
    }
  });

  it('offers nothing with no named location', () => {
    const wrapper = mountPlan(plan({ locations: [{ id: 'loc-1', name: '' }] }));

    expect(wrapper.find('[data-testid="plan-layouts"]').exists()).toBe(false);
  });

  it('no longer offers the floorplan beta', () => {
    const wrapper = mountPlan(plan({ locations: [], sections: [] }));

    expect(wrapper.text()).not.toContain('Set up sections from a floorplan instead');
  });
});
