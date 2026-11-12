import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import ElementSectionSetup from '@/components/elements/ElementSectionSetup.vue';
import ElementLocationSetup from '@/components/elements/ElementLocationSetup.vue';
import type { SetupObject } from '@/assets/types/datatypes';

/**
 * A row added on Section Setup or Location Setup carries its own id from the moment it is added
 * (T257): a layout's table names its section, and a layout its location, by id, since names change.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function plan(): SetupObject {
  return {
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [{ id: 'loc-upper', name: 'Upper Hall' }],
    sections: [],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  };
}

describe('a row added on Section Setup', () => {
  it('has an id of its own, a new one for each row', async () => {
    const setupObject = plan();
    const wrapper = mount(ElementSectionSetup, { props: { setupObject } });

    await wrapper.get('[data-testid="setup-section-add-button"]').trigger('click');
    await wrapper.get('[data-testid="setup-section-add-button"]').trigger('click');

    const ids = setupObject.sections.map((section) => section.id);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => UUID.test(id ?? ''))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps its id when it is renamed', async () => {
    const setupObject = plan();
    const wrapper = mount(ElementSectionSetup, { props: { setupObject } });
    await wrapper.get('[data-testid="setup-section-add-button"]').trigger('click');
    const { id } = setupObject.sections[0];

    await wrapper.get('[data-testid="setup-section-name-input-0"]').setValue('Gold row');

    expect(setupObject.sections[0]).toMatchObject({ id, name: 'Gold row' });
  });
});

describe('a row added on Location Setup', () => {
  it('has an id of its own, a new one for each row', async () => {
    const setupObject = plan();
    const wrapper = mount(ElementLocationSetup, { props: { setupObject } });

    await wrapper.get('[data-testid="setup-location-add-button"]').trigger('click');
    await wrapper.get('[data-testid="setup-location-add-button"]').trigger('click');

    const [kept, ...added] = setupObject.locations;
    expect(kept.id).toBe('loc-upper');
    expect(added).toHaveLength(2);
    expect(added.every((location) => UUID.test(location.id ?? ''))).toBe(true);
    expect(new Set(added.map((location) => location.id)).size).toBe(2);
  });

  it('keeps its id when it is renamed', async () => {
    const setupObject = plan();
    const wrapper = mount(ElementLocationSetup, { props: { setupObject } });
    await wrapper.get('[data-testid="setup-location-add-button"]').trigger('click');
    const { id } = setupObject.locations[1];

    await wrapper.get('[data-testid="setup-location-name-input-1"]').setValue('Lower Hall');

    expect(setupObject.locations[1]).toMatchObject({ id, name: 'Lower Hall' });
  });
});
