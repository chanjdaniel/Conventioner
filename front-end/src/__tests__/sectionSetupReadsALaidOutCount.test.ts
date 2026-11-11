// @vitest-environment happy-dom
/**
 * Section Setup reads a laid-out location's counts from its layout (T257 ticket 04): the Count
 * cell of such a section is the number of the layout's tables in it, with "from the layout" under
 * it and no field, since the server counts them the same way on every write and a typed count
 * would be overwritten. A section of a location with no layout keeps its field.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';

import ElementSectionSetup from '@/components/elements/ElementSectionSetup.vue';
import type { SetupObject } from '@/assets/types/datatypes';

const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const LOWER = { id: 'loc-lower', name: 'Lower Hall' };

const table = (id: string, sectionId: string | null, number: number | null) => ({
  id,
  sectionId,
  number,
  tableTypeId: 'type-6ft',
  xMm: 1000,
  yMm: 1000,
  rotation: 0,
});

function plan(): SetupObject {
  return reactive({
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [UPPER, LOWER],
    sections: [
      // The stored count is stale on purpose: the layout's tables are what is read.
      { id: 'sec-gold', name: 'Gold row', location: UPPER, tier: null, count: 13 },
      { id: 'sec-silver', name: 'Silver aisle', location: UPPER, tier: null, count: 6 },
      { id: 'sec-bronze', name: 'Bronze corner', location: LOWER, tier: null, count: 4 },
      { id: 'sec-new', name: 'No location yet', location: null, tier: null, count: 2 },
    ],
    assignmentOptions: {},
    tableTypes: [],
    floorplans: [
      {
        id: 'fp-1',
        locationId: UPPER.id,
        revision: 4,
        tables: [
          table('a', 'sec-gold', 1),
          table('b', 'sec-gold', 2),
          table('c', 'sec-gold', 3),
          table('loose', null, null),
          table('elsewhere', 'sec-bronze', 1),
        ],
        zones: [],
        sectionStyles: [],
        startingCounts: [],
      },
    ],
  }) as unknown as SetupObject;
}

const find = (wrapper: ReturnType<typeof mount>, id: string) =>
  wrapper.find(`[data-testid="${id}"]`);

describe("Section Setup's count of a laid-out location", () => {
  it("is the layout's tables in the section, read with its source and no field", () => {
    const wrapper = mount(ElementSectionSetup, { props: { setupObject: plan() } });
    expect(find(wrapper, 'setup-section-count-0').text()).toBe('3');
    expect(find(wrapper, 'setup-section-count-source-0').text()).toBe('from the layout');
    expect(find(wrapper, 'setup-section-count-input-0').exists()).toBe(false);
    // A section of the layout's location with no table on it reads 0, not what was typed.
    expect(find(wrapper, 'setup-section-count-1').text()).toBe('0');
  });

  it('stays a field for a location with no layout, and for a section with no location', () => {
    const wrapper = mount(ElementSectionSetup, { props: { setupObject: plan() } });
    const bronze = find(wrapper, 'setup-section-count-input-2');
    expect((bronze.element as HTMLInputElement).value).toBe('4');
    expect(find(wrapper, 'setup-section-count-2').exists()).toBe(false);
    expect(find(wrapper, 'setup-section-count-input-3').exists()).toBe(true);
  });

  it('totals the read counts with the typed ones', () => {
    const wrapper = mount(ElementSectionSetup, { props: { setupObject: plan() } });
    // 3 and 0 from the layout, 4 and 2 typed: a table of no section, and one naming another
    // location's section, count for none.
    expect(find(wrapper, 'setup-section-total').text()).toBe('Total tables: 9');
  });

  it('turns to the layout as soon as a section is given a laid-out location', async () => {
    const setupObject = plan();
    const wrapper = mount(ElementSectionSetup, { props: { setupObject } });
    setupObject.sections[3].location = UPPER;
    await wrapper.vm.$nextTick();
    expect(find(wrapper, 'setup-section-count-3').text()).toBe('0');
    expect(find(wrapper, 'setup-section-count-input-3').exists()).toBe(false);
  });
});
