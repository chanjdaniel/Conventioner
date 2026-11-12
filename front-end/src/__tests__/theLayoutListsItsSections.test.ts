/**
 * The layout page's "Sections in <location>" card (T257 tickets 03 and 05) lists what the map
 * draws: each section of the location with its colour, its tier and its count of tables; and for
 * someone editing, each section's colour choice and Renumber, the tables in no section, and what
 * Section Setup had when the layout began.
 */
import { describe, expect, it, vi } from 'vitest';
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

  describe('for someone editing the layout', () => {
    const editing = (props: Record<string, unknown> = {}) =>
      mount(LayoutPanelSections, {
        props: {
          locationName: 'Upper Hall',
          sections: layoutSections(LAYOUT, SECTIONS),
          editable: true,
          ...props,
        },
        attachTo: document.body,
      });

    it("opens a section's colours from its swatch, the one it wears pressed, and keeps the choice", async () => {
      const wrapper = editing();
      const swatches = wrapper.findAll('[data-testid="layout-panel-section-colour"]');
      expect(swatches.map((swatch) => swatch.attributes('aria-label'))).toEqual([
        "Gold row's colour",
        "Silver aisle's colour",
      ]);
      expect(wrapper.find('[data-testid="layout-panel-palette"]').exists()).toBe(false);

      await swatches[1].trigger('click');
      expect(swatches[1].attributes('aria-expanded')).toBe('true');
      const choices = wrapper.findAll('[data-testid="layout-panel-palette"] button');
      expect(choices.map((choice) => choice.attributes('aria-label'))).toEqual([
        'Gold',
        'Blue',
        'Terracotta',
        'Green',
        'Violet',
        'Teal',
        'Rose',
        'Olive',
      ]);
      // Silver aisle wears the fifth.
      expect(choices.map((choice) => choice.attributes('aria-pressed'))).toEqual([
        'false',
        'false',
        'false',
        'false',
        'true',
        'false',
        'false',
        'false',
      ]);
      await vi.waitFor(() => expect(document.activeElement).toBe(choices[4].element));

      await choices[2].trigger('click');
      expect(wrapper.emitted('color')).toEqual([['sec-silver', 3]]);
      // The palette closes and the swatch has the focus again.
      expect(wrapper.find('[data-testid="layout-panel-palette"]').exists()).toBe(false);
      await vi.waitFor(() => expect(document.activeElement).toBe(swatches[1].element));
      wrapper.unmount();
    });

    it('closes the colours on Escape, the focus back on the swatch', async () => {
      const wrapper = editing();
      const swatch = wrapper.get('[data-testid="layout-panel-section-colour"]');
      await swatch.trigger('click');
      await wrapper.get('[data-testid="layout-panel-palette"]').trigger('keydown', { key: 'Esc' });
      expect(wrapper.find('[data-testid="layout-panel-palette"]').exists()).toBe(false);
      expect(wrapper.emitted('color')).toBeUndefined();
      await vi.waitFor(() => expect(document.activeElement).toBe(swatch.element));
      wrapper.unmount();
    });

    it("renumbers a section by position from its row's menu", async () => {
      const wrapper = editing();
      await wrapper
        .get('[data-testid="layout-panel-section-menu-sec-silver-button"]')
        .trigger('click');
      const item = wrapper.get('[role="menuitem"]');
      expect(item.text()).toBe('Renumber by position (rows across the page)');
      await item.trigger('click');
      expect(wrapper.emitted('renumber')).toEqual([['sec-silver']]);
      wrapper.unmount();
    });

    it('counts the tables in no section, with "Select them"', async () => {
      const wrapper = editing({ unsectioned: 3 });
      const line = wrapper.get('[data-testid="layout-panel-no-section"]');
      expect(line.text().replace(/\s+/g, ' ')).toBe('3 tables are in no section Select them');
      await wrapper.get('[data-testid="layout-panel-select-no-section"]').trigger('click');
      expect(wrapper.emitted('selectUnsectioned')).toHaveLength(1);
      wrapper.unmount();

      const one = editing({ unsectioned: 1 });
      expect(one.get('[data-testid="layout-panel-no-section"]').text()).toContain(
        '1 table is in no section',
      );
      one.unmount();
      const none = editing();
      expect(none.find('[data-testid="layout-panel-no-section"]').exists()).toBe(false);
      none.unmount();
    });

    it('says what Section Setup had for each section still short of it', () => {
      const wrapper = editing({
        startingCounts: [
          { sectionId: 'sec-gold', count: 13 },
          // Silver aisle has its one table: nothing to say.
          { sectionId: 'sec-silver', count: 1 },
        ],
      });
      expect(wrapper.get('[data-testid="layout-panel-starting"]').text()).toBe(
        'Section Setup had Gold row at 13: 2 placed.',
      );
      wrapper.unmount();
      const met = editing({ startingCounts: [{ sectionId: 'sec-gold', count: 2 }] });
      expect(met.find('[data-testid="layout-panel-starting"]').exists()).toBe(false);
      met.unmount();
    });
  });

  it('offers a reader no change: no colour choice, no menu, and the count of no section alone', () => {
    const wrapper = mount(LayoutPanelSections, {
      props: {
        locationName: 'Upper Hall',
        sections: layoutSections(LAYOUT, SECTIONS),
        unsectioned: 2,
        startingCounts: [{ sectionId: 'sec-gold', count: 13 }],
      },
    });
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.get('[data-testid="layout-panel-no-section"]').text()).toBe(
      '2 tables are in no section',
    );
    expect(wrapper.find('[data-testid="layout-panel-starting"]').exists()).toBe(false);
  });
});
