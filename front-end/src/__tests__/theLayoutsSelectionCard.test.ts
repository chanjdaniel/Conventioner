// @vitest-environment happy-dom
/**
 * The layout page's selection card (T257 ticket 04): nothing selected, one table read whole, or
 * several counted and named, with the buttons that turn and remove the selection; and the map in
 * its `edit` mode saying each table pressed or not, with room for what the editor draws over it.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FloorplanObject, FloorplanTable, SectionObject } from '@/assets/types/datatypes';
import LayoutMap from '@/components/layout/LayoutMap.vue';
import LayoutPanelSelection from '@/components/layout/LayoutPanelSelection.vue';
import { layoutSections } from '@/components/layout/layoutDrawing';

const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const SECTIONS: SectionObject[] = [
  { id: 'sec-gold', name: 'Gold row', location: UPPER, tier: null, count: 0 },
];
const TYPES = [{ id: 'type-6ft', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 }];
const table = (
  id: string,
  sectionId: string | null,
  number: number | null,
  xMm = 12_440,
  yMm = 6060,
): FloorplanTable => ({ id, sectionId, number, tableTypeId: 'type-6ft', xMm, yMm, rotation: 0 });

const TABLES = [table('g1', 'sec-gold', 1), table('g2', 'sec-gold', 2), table('loose', null, null)];
const LAYOUT: FloorplanObject = {
  id: 'fp-1',
  locationId: UPPER.id,
  revision: 1,
  imageWidth: 800,
  imageHeight: 600,
  scalePxPerUnit: 800 / 30_000,
  tables: TABLES,
  zones: [],
  sectionStyles: [],
  startingCounts: [],
};

function card(tables: FloorplanTable[]) {
  return mount(LayoutPanelSelection, {
    props: { tables, sections: layoutSections(LAYOUT, SECTIONS), tableTypes: TYPES },
  });
}
const text = (wrapper: ReturnType<typeof card>, id: string) =>
  wrapper.find(`[data-testid="${id}"]`).text();

describe("the layout's selection card", () => {
  it('says what to do with nothing selected, and offers nothing', () => {
    const wrapper = card([]);
    expect(text(wrapper, 'layout-selection-none')).toBe('Select tables to change them.');
    expect(wrapper.find('[data-testid="layout-selection-turn"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="layout-selection-remove"]').exists()).toBe(false);
  });

  it("reads one table: its code, section, type and its centre's place in metres", () => {
    const wrapper = card([TABLES[0]]);
    expect(text(wrapper, 'layout-selection-title')).toBe('Gold row 1');
    expect(text(wrapper, 'layout-selection-section')).toBe('Gold row');
    expect(text(wrapper, 'layout-selection-type')).toBe('Standard 6 ft');
    expect(text(wrapper, 'layout-selection-position')).toBe('12.4 m, 6.1 m');
  });

  it('reads a table in no section as one', () => {
    const wrapper = card([TABLES[2]]);
    expect(text(wrapper, 'layout-selection-title')).toBe('Table in no section');
    expect(text(wrapper, 'layout-selection-section')).toBe('No section');
  });

  it('counts several and names them', () => {
    const wrapper = card(TABLES);
    expect(text(wrapper, 'layout-selection-title')).toBe('3 tables selected');
    expect(text(wrapper, 'layout-selection-codes')).toBe(
      'Gold row 1, Gold row 2, Table in no section',
    );
  });

  it('turns and removes by its buttons', async () => {
    const wrapper = card([TABLES[0]]);
    await wrapper.find('[data-testid="layout-selection-turn"]').trigger('click');
    await wrapper.find('[data-testid="layout-selection-remove"]').trigger('click');
    expect(wrapper.emitted('turn')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });
});

describe('the map in the editor', () => {
  const map = (mode: 'edit' | 'read') =>
    mount(LayoutMap, {
      props: {
        layout: LAYOUT,
        locationName: 'Upper Hall',
        sections: SECTIONS,
        tableTypes: TYPES,
        mode,
        selection: ['g2'],
        pxPerMm: 0.04,
      },
      slots: { default: '<circle data-testid="drawn-over" r="10" />' },
    });

  it('says each table pressed or not, as it is selected or not', () => {
    const wrapper = map('edit');
    const pressed = (id: string) =>
      wrapper.find(`[data-table-id="${id}"]`).attributes('aria-pressed');
    expect(pressed('g2')).toBe('true');
    expect(pressed('g1')).toBe('false');
  });

  it('says nothing of pressing where a press only reads the table', () => {
    const wrapper = map('read');
    expect(wrapper.find('[data-table-id="g2"]').attributes('aria-pressed')).toBeUndefined();
  });

  it('draws what the editor gives it over the tables', () => {
    const wrapper = map('edit');
    const drawn = wrapper.find('[data-testid="drawn-over"]');
    expect(drawn.exists()).toBe(true);
    const tables = wrapper.findAll('[data-testid="layout-table"]');
    const order = drawn.element.compareDocumentPosition(tables.at(-1)!.element);
    expect(order & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
