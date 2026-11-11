// @vitest-environment happy-dom
/**
 * The layout page's selection card (T257 tickets 04 and 05): nothing selected, one table read
 * whole, or several counted and named, with the fields that change the selection's section and
 * type and the buttons that turn, duplicate, line up and remove it; and the map in its `edit` mode
 * saying each table pressed or not, with room for what the editor draws over it.
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
  { id: 'sec-silver', name: 'Silver aisle', location: UPPER, tier: null, count: 0 },
];
const TYPES = [
  { id: 'type-6ft', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 },
  { id: 'type-square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 },
];
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
/** What a field of the card reads: the words of its chosen option. */
function reads(wrapper: ReturnType<typeof card>, id: string) {
  const field = wrapper.get(`[data-testid="${id}"]`).element as HTMLSelectElement;
  return field.selectedOptions[0]?.text.trim();
}

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
    expect(reads(wrapper, 'layout-selection-section')).toBe('Gold row');
    expect(reads(wrapper, 'layout-selection-type')).toBe('Standard 6 ft');
    expect(text(wrapper, 'layout-selection-position')).toBe('12.4 m, 6.1 m');
    // One table has nothing to be lined up with.
    expect(wrapper.find('[data-testid="layout-selection-align-button"]').exists()).toBe(false);
  });

  it('reads a table in no section as one', () => {
    const wrapper = card([TABLES[2]]);
    expect(text(wrapper, 'layout-selection-title')).toBe('Table in no section');
    expect(reads(wrapper, 'layout-selection-section')).toBe('No section');
  });

  it("reads a table of a type that is not the market's as of an unknown type", () => {
    const wrapper = card([{ ...TABLES[0], tableTypeId: 'gone' }]);
    expect(reads(wrapper, 'layout-selection-type')).toBe('Unknown type');
  });

  it('counts several and names them', () => {
    const wrapper = card(TABLES);
    expect(text(wrapper, 'layout-selection-title')).toBe('3 tables selected');
    expect(text(wrapper, 'layout-selection-codes')).toBe(
      'Gold row 1, Gold row 2, Table in no section',
    );
  });

  it('names the first ten of many, and counts the rest', () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      table(`g${index + 1}`, 'sec-gold', index + 1),
    );
    const wrapper = mount(LayoutPanelSelection, {
      props: {
        tables: many,
        sections: layoutSections({ ...LAYOUT, tables: many }, SECTIONS),
        tableTypes: TYPES,
      },
    });
    expect(text(wrapper, 'layout-selection-codes')).toBe(
      'Gold row 1, Gold row 2, Gold row 3, Gold row 4, Gold row 5, Gold row 6, Gold row 7, ' +
        'Gold row 8, Gold row 9, Gold row 10 and 3 more',
    );
  });

  it('reads the section and the type several share, and "Mixed" where they differ', () => {
    const alike = card([TABLES[0], TABLES[1]]);
    expect(reads(alike, 'layout-selection-section')).toBe('Gold row');
    expect(reads(alike, 'layout-selection-type')).toBe('Standard 6 ft');

    const differing = card([TABLES[0], { ...TABLES[2], tableTypeId: 'type-square' }]);
    expect(reads(differing, 'layout-selection-section')).toBe('Mixed');
    expect(reads(differing, 'layout-selection-type')).toBe('Mixed');
  });

  it('puts the selection in the section chosen, or in none', async () => {
    const wrapper = card([TABLES[0], TABLES[1]]);
    const field = wrapper.get('[data-testid="layout-selection-section"]');
    await field.setValue('sec-silver');
    await field.setValue('');
    expect(wrapper.emitted('section')).toEqual([['sec-silver'], [null]]);
  });

  it('gives the selection the type chosen', async () => {
    const wrapper = card([TABLES[0], TABLES[1]]);
    await wrapper.get('[data-testid="layout-selection-type"]').setValue('type-square');
    expect(wrapper.emitted('type')).toEqual([['type-square']]);
  });

  it('turns, duplicates and removes by its buttons', async () => {
    const wrapper = card([TABLES[0]]);
    await wrapper.find('[data-testid="layout-selection-turn"]').trigger('click');
    await wrapper.find('[data-testid="layout-selection-duplicate"]').trigger('click');
    await wrapper.find('[data-testid="layout-selection-remove"]').trigger('click');
    expect(wrapper.emitted('turn')).toHaveLength(1);
    expect(wrapper.emitted('duplicate')).toHaveLength(1);
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('lines several up and spaces them from the Align menu', async () => {
    const wrapper = mount(LayoutPanelSelection, {
      props: { tables: TABLES, sections: layoutSections(LAYOUT, SECTIONS), tableTypes: TYPES },
      attachTo: document.body,
    });
    const open = wrapper.get('[data-testid="layout-selection-align-button"]');
    expect(open.text()).toBe('Align');
    await open.trigger('click');
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text())).toEqual([
      'Align left',
      'Align centre',
      'Align right',
      'Align top',
      'Align middle',
      'Align bottom',
      'Space evenly across',
      'Space evenly down',
    ]);
    await wrapper.get('[data-testid="layout-selection-align-top"]').trigger('click');
    await open.trigger('click');
    await wrapper.get('[data-testid="layout-selection-align-across"]').trigger('click');
    expect(wrapper.emitted('arrange')).toEqual([['top'], ['across']]);
    wrapper.unmount();
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
