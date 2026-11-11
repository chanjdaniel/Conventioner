/**
 * The layout page's "Sections in <location>" card (T257 ticket 03) lists what the map draws: each
 * section of the location with its colour, its tier and its count of tables.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FloorplanTable, SectionObject } from '@/assets/types/datatypes';
import LayoutPanelSections from '@/components/layout/LayoutPanelSections.vue';
import { layoutSections, tableCode, tableName } from '@/components/layout/layoutDrawing';

const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const LOWER = { id: 'loc-lower', name: 'Lower Hall' };
const SECTIONS: SectionObject[] = [
  { id: 'sec-gold', name: 'Gold row', location: UPPER, tier: { id: 1, name: 'Gold' }, count: 0 },
  { id: 'sec-bronze', name: 'Bronze corner', location: LOWER, tier: null, count: 0 },
  { id: 'sec-silver', name: 'Silver aisle', location: UPPER, tier: null, count: 0 },
  { name: 'Stored before ids', location: UPPER, tier: null, count: 0 },
];
const table = (id: string, sectionId: string | null, number: number | null): FloorplanTable => ({
  id,
  sectionId,
  number,
  tableTypeId: 'type-6ft',
  xMm: 0,
  yMm: 0,
  rotation: 0,
});
const LAYOUT = {
  locationId: UPPER.id,
  tables: [
    table('g2', 'sec-gold', 2),
    table('g1', 'sec-gold', 1),
    table('s1', 'sec-silver', 1),
    table('b1', 'sec-bronze', 1),
    table('loose', null, null),
  ],
  sectionStyles: [{ sectionId: 'sec-silver', color: 5, labelAt: null }],
};

describe("a layout's sections", () => {
  it("are its location's, in the plan's order, each with its colour and its tables by number", () => {
    const sections = layoutSections(LAYOUT, SECTIONS);
    expect(sections.map(({ section }) => section.name)).toEqual(['Gold row', 'Silver aisle']);
    expect(sections.map(({ color }) => color)).toEqual([1, 5]);
    expect(sections[0].paint).toEqual({
      fill: '--layout-section-1-fill',
      edge: '--layout-section-1-edge',
    });
    expect(sections[0].tables.map(({ id }) => id)).toEqual(['g1', 'g2']);
    expect(sections[1].tables.map(({ id }) => id)).toEqual(['s1']);
  });

  it('are none for a floorplan of no location', () => {
    expect(layoutSections({ ...LAYOUT, locationId: null }, SECTIONS)).toEqual([]);
  });

  it('name a table by its code and its type', () => {
    const gold = SECTIONS[0];
    expect(tableCode(table('g5', 'sec-gold', 5), gold)).toBe('Gold row 5');
    expect(tableCode(table('loose', null, null), null)).toBeNull();
    expect(tableName(table('g5', 'sec-gold', 5), gold, { name: 'Standard 6 ft' })).toBe(
      'Gold row 5, Standard 6 ft',
    );
    expect(tableName(table('loose', null, null), null, { name: 'Standard 6 ft' })).toBe(
      'Table in no section, Standard 6 ft',
    );
    expect(tableName(table('g5', 'sec-gold', 5), gold, undefined)).toBe('Gold row 5');
  });
});

describe('the Sections card', () => {
  const card = (sections = layoutSections(LAYOUT, SECTIONS)) =>
    mount(LayoutPanelSections, { props: { locationName: 'Upper Hall', sections } });

  it('is titled for the location and lists each section, its tier and its count', () => {
    const wrapper = card();
    expect(wrapper.get('h2').text()).toBe('Sections in Upper Hall');
    expect(wrapper.attributes('aria-labelledby')).toBe(wrapper.get('h2').attributes('id'));
    const rows = wrapper.findAll('[data-testid="layout-panel-section"]');
    const read = (part: string) => rows.map((row) => row.get(`.sections-${part}`).text());
    expect(read('name').map((name) => name.replace(/\s+/g, ' '))).toEqual([
      'Gold row Gold tier',
      'Silver aisle No tier',
    ]);
    expect(read('tier')).toEqual(['Gold tier', 'No tier']);
    expect(read('count')).toEqual(['2 tables', '1 table']);
  });

  it("shows each section's colour as the map paints it", () => {
    const swatches = card().findAll('[data-testid="layout-panel-section-swatch"]');
    expect(swatches.map((swatch) => swatch.attributes('style'))).toEqual([
      'background: var(--layout-section-1-fill); border-color: var(--layout-section-1-edge);',
      'background: var(--layout-section-5-fill); border-color: var(--layout-section-5-edge);',
    ]);
  });

  it('says so when the location has no section', () => {
    const wrapper = card([]);
    expect(wrapper.get('[data-testid="layout-panel-no-sections"]').text()).toBe(
      "Upper Hall has no sections yet. Name them on Market Setup's Section Setup.",
    );
    expect(wrapper.find('ul').exists()).toBe(false);
  });
});
