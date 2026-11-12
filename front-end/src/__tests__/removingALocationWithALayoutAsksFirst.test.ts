// @vitest-environment happy-dom
/**
 * Removing a location that has a layout asks first (T257 ticket 05): the plan write that follows
 * takes the layout with its location, so Location Setup names the tables it would take, and
 * Cancel keeps both. A location with no layout is removed at once, as it always was.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementLocationSetup from '@/components/elements/ElementLocationSetup.vue';
import type { FloorplanObject, FloorplanTable, SetupObject } from '@/assets/types/datatypes';

const table = (id: string): FloorplanTable => ({
  id,
  sectionId: 'sec-gold',
  number: Number(id),
  tableTypeId: 'six-foot',
  xMm: 1000,
  yMm: 1000,
  rotation: 0,
});

function layoutOf(locationId: string, tables: number): FloorplanObject {
  return {
    id: `fp-${locationId}`,
    locationId,
    revision: 1,
    tables: Array.from({ length: tables }, (_, index) => table(String(index + 1))),
    zones: [],
    sectionStyles: [],
    startingCounts: [],
  };
}

function plan(floorplans: FloorplanObject[]): SetupObject {
  return {
    priority: [],
    marketDates: [],
    tiers: [],
    locations: [
      { id: 'loc-upper', name: 'Upper Hall' },
      { id: 'loc-lower', name: 'Lower Hall' },
    ],
    sections: [],
    floorplans,
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  };
}

let wrapper: VueWrapper;
function locationSetup(setupObject: SetupObject) {
  wrapper = mount(ElementLocationSetup, { props: { setupObject }, attachTo: document.body });
  return wrapper;
}
afterEach(() => wrapper?.unmount());

const inPage = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const names = (setupObject: SetupObject) => setupObject.locations.map((place) => place.name);

describe('removing a location on Location Setup', () => {
  it('removes a location with no layout at once', async () => {
    const setupObject = plan([layoutOf('loc-upper', 49)]);
    locationSetup(setupObject);
    await wrapper.get('[aria-label="Remove location 2"]').trigger('click');
    expect(names(setupObject)).toEqual(['Upper Hall']);
    expect(inPage('remove-location-window')).toBeNull();
  });

  it('asks before removing one with a layout, naming the tables that go with it', async () => {
    const setupObject = plan([layoutOf('loc-upper', 49)]);
    locationSetup(setupObject);
    await wrapper.get('[aria-label="Remove location 1"]').trigger('click');
    await flushPromises();

    // Nothing is removed yet.
    expect(names(setupObject)).toEqual(['Upper Hall', 'Lower Hall']);
    const dialog = inPage('remove-location-window')!;
    expect(dialog.textContent).toContain('Remove Upper Hall?');
    expect(inPage('remove-location-sentence')!.textContent!.trim()).toBe(
      'Its layout of 49 tables goes with it.',
    );
    expect(inPage('remove-location-submit-button')!.textContent!.trim()).toBe(
      'Remove location and layout',
    );
    expect(inPage('remove-location-cancel-button')!.textContent!.trim()).toBe('Cancel');
    // It takes a layout, so it opens on Cancel.
    expect(document.activeElement).toBe(inPage('remove-location-cancel-button'));
  });

  it('keeps the location and its layout on Cancel', async () => {
    const setupObject = plan([layoutOf('loc-upper', 49)]);
    locationSetup(setupObject);
    await wrapper.get('[aria-label="Remove location 1"]').trigger('click');
    await flushPromises();
    inPage('remove-location-cancel-button')!.click();
    await flushPromises();

    expect(inPage('remove-location-window')).toBeNull();
    expect(names(setupObject)).toEqual(['Upper Hall', 'Lower Hall']);
    expect(setupObject.floorplans).toHaveLength(1);
  });

  it('removes the location once it is confirmed, and puts the focus on Add a location', async () => {
    const setupObject = plan([layoutOf('loc-upper', 49)]);
    locationSetup(setupObject);
    await wrapper.get('[aria-label="Remove location 1"]').trigger('click');
    await flushPromises();
    inPage('remove-location-submit-button')!.click();
    await flushPromises();

    expect(inPage('remove-location-window')).toBeNull();
    expect(names(setupObject)).toEqual(['Lower Hall']);
    expect(document.activeElement).toBe(inPage('setup-location-add-button'));
  });

  it('says one table as one, and a layout with no table as a layout', async () => {
    const setupObject = plan([layoutOf('loc-upper', 1), layoutOf('loc-lower', 0)]);
    locationSetup(setupObject);
    await wrapper.get('[aria-label="Remove location 1"]').trigger('click');
    await flushPromises();
    expect(inPage('remove-location-sentence')!.textContent!.trim()).toBe(
      'Its layout of 1 table goes with it.',
    );
    inPage('remove-location-cancel-button')!.click();
    await flushPromises();

    await wrapper.get('[aria-label="Remove location 2"]').trigger('click');
    await flushPromises();
    expect(inPage('remove-location-sentence')!.textContent!.trim()).toBe(
      'Its layout goes with it.',
    );
  });
});
