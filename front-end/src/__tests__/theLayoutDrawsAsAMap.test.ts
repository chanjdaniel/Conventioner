/**
 * `LayoutMap`, the one drawing of a layout (T257 ticket 03): what it names, the one Tab stop among
 * its tables, each table's place, turn and colour, the sections' names, the zones, and what a press
 * does in each mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import type {
  FloorplanObject,
  FloorplanTable,
  SectionObject,
  TableTypeObject,
} from '@/assets/types/datatypes';
import LayoutMap from '@/components/layout/LayoutMap.vue';

const UPPER = { id: 'loc-upper', name: 'Upper Hall' };
const LOWER = { id: 'loc-lower', name: 'Lower Hall' };
const GOLD = { id: 1, name: 'Gold' };

const SECTIONS: SectionObject[] = [
  { id: 'sec-gold', name: 'Gold row', location: UPPER, tier: GOLD, count: 0 },
  { id: 'sec-silver', name: 'Silver aisle', location: UPPER, tier: null, count: 0 },
  { id: 'sec-bronze', name: 'Bronze corner', location: LOWER, tier: null, count: 0 },
];

const TYPES: TableTypeObject[] = [
  { id: 'type-6ft', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 },
  { id: 'type-square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 },
];

function table(
  id: string,
  sectionId: string | null,
  number: number | null,
  xMm: number,
  yMm: number,
  rotation = 0,
  tableTypeId = 'type-6ft',
): FloorplanTable {
  return { id, sectionId, number, tableTypeId, xMm, yMm, rotation };
}

/** A hall 30 m by 22.5 m: Gold row along the top, Silver aisle below it, one table in no section. */
function layout(changes: Partial<FloorplanObject> = {}): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: UPPER.id,
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables: [
      table('g2', 'sec-gold', 2, 7000, 3000),
      table('g1', 'sec-gold', 1, 5000, 3000),
      table('g3', 'sec-gold', 3, 9000, 3000),
      table('s1', 'sec-silver', 1, 5000, 8000, 90),
      table('s2', 'sec-silver', 2, 7000, 8000, 135, 'type-square'),
      table('loose', null, null, 20_000, 15_000),
    ],
    zones: [
      { id: 'z1', label: 'Stage', xMm: 12_000, yMm: 500, widthMm: 8000, depthMm: 3000 },
      { id: 'z2', label: '', xMm: 15_000, yMm: 12_000, widthMm: 600, depthMm: 600 },
    ],
    sectionStyles: [],
    startingCounts: [],
    ...changes,
  };
}

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

/**
 * Draw the map, its own box measured as `pxPerMm` screen pixels to the millimetre of the view it
 * shows (1 px to 25 mm, 100% zoom, unless told), since a test's DOM measures nothing.
 */
function draw(
  props: Partial<InstanceType<typeof LayoutMap>['$props']> = {},
  floorplan = layout(),
  pxPerMm = 0.04,
): VueWrapper {
  const measured = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-testid') !== 'layout-map') return measured.call(this);
    const [, , widthMm, heightMm] = (this.getAttribute('viewBox') ?? '0 0 0 0')
      .split(' ')
      .map(Number);
    const width = widthMm * pxPerMm;
    const height = heightMm * pxPerMm;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height } as DOMRect;
  });
  wrapper = mount(LayoutMap, {
    attachTo: document.body,
    props: {
      layout: floorplan,
      locationName: UPPER.name,
      sections: SECTIONS,
      tableTypes: TYPES,
      mode: 'read',
      imageUrl: 'blob:fixture',
      ...props,
    },
  });
  return wrapper;
}

const tables = (map: VueWrapper) => map.findAll('[data-testid="layout-table"]');
const tableById = (map: VueWrapper, id: string) => map.get(`[data-table-id="${id}"]`);

describe('what the map says', () => {
  it('is a group named for its location and its count of tables', () => {
    const map = draw();
    expect(map.attributes('role')).toBe('group');
    expect(map.attributes('aria-label')).toBe('Upper Hall layout, 6 tables');
  });

  it('counts one table as one', () => {
    const map = draw({}, layout({ tables: [table('g1', 'sec-gold', 1, 5000, 3000)] }));
    expect(map.attributes('aria-label')).toBe('Upper Hall layout, 1 table');
  });

  it('names each table by its code and its type, section by section in number order', () => {
    const map = draw();
    expect(tables(map).map((t) => t.attributes('aria-label'))).toEqual([
      'Gold row 1, Standard 6 ft',
      'Gold row 2, Standard 6 ft',
      'Gold row 3, Standard 6 ft',
      'Silver aisle 1, Standard 6 ft',
      'Silver aisle 2, Square 4 ft',
      'Table in no section, Standard 6 ft',
    ]);
    expect(tables(map).every((t) => t.attributes('role') === 'button')).toBe(true);
  });

  it("reads a table of another location's section, or of a section gone, as in no section", () => {
    const map = draw(
      {},
      layout({
        tables: [table('b1', 'sec-bronze', 1, 5000, 3000), table('x1', 'sec-gone', 1, 7000, 3000)],
      }),
    );
    expect(tables(map).map((t) => t.attributes('aria-label'))).toEqual([
      'Table in no section, Standard 6 ft',
      'Table in no section, Standard 6 ft',
    ]);
    expect(map.findAll('[data-testid="layout-table-number"]')).toHaveLength(0);
  });

  it('reads a table with a section and no number as in no section, and paints it so', () => {
    const map = draw({}, layout({ tables: [table('odd', 'sec-gold', null, 5000, 3000)] }));
    const odd = tableById(map, 'odd');
    expect(odd.attributes('aria-label')).toBe('Table in no section, Standard 6 ft');
    expect(odd.get('[data-testid="layout-table-top"]').attributes('fill')).toBe(
      'var(--layout-no-section-fill)',
    );
  });

  it('names a no-table zone, with its label when it has one', () => {
    const zones = draw().findAll('[data-testid="layout-map-zone"]');
    expect(zones.map((zone) => zone.attributes('aria-label'))).toEqual([
      'No-table zone: Stage',
      'No-table zone',
    ]);
    // The stage carries its word; the pillar, 24 px across, has no room for one and none to say.
    expect(zones[0].find('text').text()).toBe('Stage');
    expect(zones[1].find('text').exists()).toBe(false);
  });
});

describe('where the map draws', () => {
  it('shows the whole hall, in millimetres', () => {
    const map = draw();
    const [x, y, width, height] = map.attributes('viewBox')!.split(' ').map(Number);
    expect([x, y]).toEqual([0, 0]);
    expect(width).toBeCloseTo(30_000);
    expect(height).toBeCloseTo(22_500);
  });

  it('shows the part of the hall it is given', () => {
    const map = draw({ view: { xMm: 4000, yMm: 2000, widthMm: 6000, heightMm: 4500 } });
    expect(map.attributes('viewBox')).toBe('4000 2000 6000 4500');
  });

  it('draws each table at its true size about its centre, turned', () => {
    const map = draw();
    const turned = tableById(map, 's1');
    expect(turned.attributes('transform')).toBe('translate(5000 8000) rotate(90)');
    const top = turned.get('[data-testid="layout-table-top"]');
    expect(Number(top.attributes('x'))).toBe(-915);
    expect(Number(top.attributes('y'))).toBe(-380);
    expect(Number(top.attributes('width'))).toBe(1830);
    expect(Number(top.attributes('height'))).toBe(760);
    expect(Number(top.attributes('rx'))).toBe(40);

    const square = tableById(map, 's2').get('[data-testid="layout-table-top"]');
    expect(Number(square.attributes('width'))).toBe(1220);
    expect(Number(square.attributes('height'))).toBe(1220);
  });

  it('draws the image under the tables, the hall wide, at half strength', () => {
    const map = draw();
    const image = map.get('[data-testid="layout-map-image"]');
    expect(image.attributes('href')).toBe('blob:fixture');
    expect(Number(image.attributes('width'))).toBeCloseTo(30_000);
    expect(Number(image.attributes('height'))).toBeCloseTo(22_500);
    expect(image.attributes('opacity')).toBe('0.5');
    const order = [...map.element.querySelectorAll('image, [data-testid="layout-table"]')];
    expect(order[0].tagName).toBe('image');
  });

  it('leaves the image out when told to, or with none to draw', () => {
    expect(draw({ showImage: false }).find('[data-testid="layout-map-image"]').exists()).toBe(
      false,
    );
    wrapper?.unmount();
    expect(draw({ imageUrl: '' }).find('[data-testid="layout-map-image"]').exists()).toBe(false);
  });
});

describe('how the map is painted', () => {
  const paint = (map: VueWrapper, id: string) => {
    const top = tableById(map, id).get('[data-testid="layout-table-top"]');
    return [top.attributes('fill'), top.attributes('stroke')];
  };

  it("fills and edges a table in its section's colour, sections with no style in order", () => {
    const map = draw();
    expect(paint(map, 'g1')).toEqual([
      'var(--layout-section-1-fill)',
      'var(--layout-section-1-edge)',
    ]);
    expect(paint(map, 's1')).toEqual([
      'var(--layout-section-2-fill)',
      'var(--layout-section-2-edge)',
    ]);
  });

  it('keeps the colour a style names and gives the next unused to the others', () => {
    const map = draw(
      {},
      layout({ sectionStyles: [{ sectionId: 'sec-silver', color: 1, labelAt: null }] }),
    );
    expect(paint(map, 's1')[0]).toBe('var(--layout-section-1-fill)');
    expect(paint(map, 'g1')[0]).toBe('var(--layout-section-2-fill)');
  });

  it('wraps a ninth section to the first colour', () => {
    const sections: SectionObject[] = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i + 1}`,
      name: `Row ${i + 1}`,
      location: UPPER,
      tier: null,
      count: 0,
    }));
    const map = draw(
      { sections },
      layout({
        tables: sections.map((section, i) =>
          table(`t${i + 1}`, section.id!, 1, 3000 * (i + 1), 3000),
        ),
      }),
    );
    expect(paint(map, 't8')[0]).toBe('var(--layout-section-8-fill)');
    expect(paint(map, 't9')[0]).toBe('var(--layout-section-1-fill)');
  });

  it('draws a table in no section grey, with no number', () => {
    const map = draw();
    expect(paint(map, 'loose')).toEqual([
      'var(--layout-no-section-fill)',
      'var(--layout-no-section-edge)',
    ]);
    expect(tableById(map, 'loose').find('[data-testid="layout-table-number"]').exists()).toBe(
      false,
    );
    expect(tableById(map, 'g2').get('[data-testid="layout-table-number"]').text()).toBe('2');
  });

  it('holds a number at 14 px on the screen at any zoom that has room for it', async () => {
    for (const pxPerMm of [0.04, 0.32]) {
      const map = draw({}, layout(), pxPerMm);
      await nextTick();
      const size = Number(
        tableById(map, 'g1').get('[data-testid="layout-table-number"]').attributes('font-size'),
      );
      expect(size * pxPerMm).toBeCloseTo(14);
      wrapper?.unmount();
    }
  });

  it('leaves the numbers out where a table is too small to carry one', async () => {
    const map = draw({}, layout(), 0.004);
    await nextTick();
    expect(map.findAll('[data-testid="layout-table-number"]')).toHaveLength(0);
    expect(tables(map)).toHaveLength(6);
  });

  it("writes each section's name in a pill edged in its colour, beside its tables", async () => {
    const map = draw();
    await nextTick();
    const labels = map.findAll('[data-testid="layout-map-label"]');
    expect(labels.map((label) => label.text())).toEqual(['Gold row', 'Silver aisle']);
    const pill = labels[0].get('rect');
    expect(pill.attributes('fill')).toBe('white');
    expect(pill.attributes('stroke')).toBe('var(--layout-section-1-edge)');
    // Under the row along the top, at its middle: 22 px tall, 6 px below the tables.
    const y = Number(pill.attributes('y'));
    const height = Number(pill.attributes('height'));
    expect(height * 0.04).toBeCloseTo(22);
    expect(y).toBeCloseTo(3380 + 6 / 0.04);
    expect(Number(pill.attributes('x')) + Number(pill.attributes('width')) / 2).toBeCloseTo(7000);
  });

  it("puts a name where its section's style says", () => {
    const map = draw(
      {},
      layout({
        sectionStyles: [{ sectionId: 'sec-gold', color: 1, labelAt: { xMm: 20_000, yMm: 10_000 } }],
      }),
    );
    const pill = map.get('[data-testid="layout-map-label"] rect');
    expect(Number(pill.attributes('x')) + Number(pill.attributes('width')) / 2).toBeCloseTo(20_000);
    expect(Number(pill.attributes('y')) + Number(pill.attributes('height')) / 2).toBeCloseTo(
      10_000,
    );
  });

  it('draws no shape with a negative corner, however far out', async () => {
    const map = draw({}, layout(), 0.004);
    await nextTick();
    for (const shape of map.findAll('rect[rx]')) {
      expect(Number(shape.attributes('rx'))).toBeGreaterThanOrEqual(0);
    }
    // The table the Tab key stops on carries its focus border, drawn inside its edge.
    expect(map.findAll('[data-focus-border]')).toHaveLength(1);
  });

  it('keeps its edges the same on the screen at any zoom', () => {
    const map = draw();
    for (const shape of map.findAll('rect[stroke]')) {
      expect(shape.attributes('vector-effect')).toBe('non-scaling-stroke');
    }
  });
});

describe('the one Tab stop', () => {
  const stops = (map: VueWrapper) =>
    tables(map)
      .filter((t) => t.attributes('tabindex') === '0')
      .map((t) => t.attributes('data-table-id'));

  it('is the first table, the rest reached from it', () => {
    const map = draw();
    expect(stops(map)).toEqual(['g1']);
    expect(tables(map).filter((t) => t.attributes('tabindex') === '-1')).toHaveLength(5);
  });

  it('is the first selected table in edit mode', () => {
    expect(stops(draw({ mode: 'edit', selection: ['s2', 's1'] }))).toEqual(['s1']);
  });

  it('follows the focus', async () => {
    const map = draw();
    (tableById(map, 's1').element as SVGGElement).focus();
    await map.vm.$nextTick();
    expect(stops(map)).toEqual(['s1']);
  });

  it('moves with an arrow key to the nearest table that way, and stays where none is', async () => {
    const map = draw();
    const first = tableById(map, 'g1');
    (first.element as SVGGElement).focus();
    await first.trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-table-id')).toBe('g2');
    await tableById(map, 'g2').trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-table-id')).toBe('s2');
    await tableById(map, 's2').trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('data-table-id')).toBe('s1');
    await tableById(map, 's1').trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('data-table-id')).toBe('s1');
    expect(stops(map)).toEqual(['s1']);
  });

  it('leaves a key the editor took alone', async () => {
    const map = draw({ mode: 'edit' });
    const first = tableById(map, 'g1');
    (first.element as SVGGElement).focus();
    const taken = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    taken.preventDefault();
    first.element.dispatchEvent(taken);
    expect(document.activeElement?.getAttribute('data-table-id')).toBe('g1');
  });
});

describe('a press, by mode', () => {
  it('emits activate with the id of a table pressed in read mode', async () => {
    const map = draw();
    await tableById(map, 's2').get('[data-testid="layout-table-top"]').trigger('click');
    expect(map.emitted('activate')).toEqual([['s2']]);
  });

  it('emits activate on Enter and on Space', async () => {
    const map = draw();
    await tableById(map, 'g3').trigger('keydown', { key: 'Enter' });
    await tableById(map, 'g1').trigger('keydown', { key: ' ' });
    expect(map.emitted('activate')).toEqual([['g3'], ['g1']]);
  });

  it('emits nothing for a press on the floor', async () => {
    const map = draw();
    await map.get('.layout-map__floor').trigger('click');
    expect(map.emitted('activate')).toBeUndefined();
  });

  it('leaves a press to the editor in edit mode, and outlines the selection', async () => {
    const map = draw({
      mode: 'edit',
      selection: ['g2'],
      guides: [{ x1Mm: 5000, y1Mm: 0, x2Mm: 5000, y2Mm: 22_500 }],
    });
    await tableById(map, 'g2').trigger('click');
    await tableById(map, 'g2').trigger('keydown', { key: 'Enter' });
    expect(map.emitted('activate')).toBeUndefined();
    expect(map.findAll('[data-testid="layout-table-selected"]')).toHaveLength(1);
    expect(tableById(map, 'g2').find('[data-testid="layout-table-selected"]').exists()).toBe(true);
    const guide = map.get('[data-testid="layout-map-guide"]');
    expect(guide.attributes('stroke')).toBe('var(--mm-blue)');
    expect(guide.attributes('stroke-dasharray')).toBe('4 4');
  });

  it('draws a table picked up by keyboard lifted in edit mode: a shadow straight down the screen, its outline dashed', async () => {
    // s1 is turned a quarter, so 3 px down the screen (75 mm at this scale) is along its own
    // width, toward its left end.
    const map = draw({ mode: 'edit', selection: ['g2', 's1'], carried: ['g2', 's1'] });
    await nextTick();
    expect(map.findAll('[data-carried]').map((t) => t.attributes('data-table-id'))).toEqual([
      'g2',
      's1',
    ]);
    const shift = (id: string) =>
      /translate\((\S+) (\S+)\)/
        .exec(
          tableById(map, id).get('[data-testid="layout-table-shadow"]').attributes('transform')!,
        )!
        .slice(1)
        .map(Number);
    const [flatX, flatY] = shift('g2');
    expect(flatX).toBeCloseTo(0);
    expect(flatY).toBeCloseTo(75);
    const [turnedX, turnedY] = shift('s1');
    expect(turnedX).toBeCloseTo(75);
    expect(turnedY).toBeCloseTo(0);
    expect(
      tableById(map, 'g2')
        .get('[data-testid="layout-table-selected"]')
        .attributes('stroke-dasharray'),
    ).toBe('6 4');
    // A table selected and not carried keeps its whole outline and has no shadow.
    const still = draw({ mode: 'edit', selection: ['g2'], carried: [] });
    expect(still.find('[data-testid="layout-table-shadow"]').exists()).toBe(false);
    expect(
      tableById(still, 'g2')
        .get('[data-testid="layout-table-selected"]')
        .attributes('stroke-dasharray'),
    ).toBeUndefined();
    still.unmount();
    // Read, nothing is carried.
    expect(
      draw({ carried: ['g2'] })
        .find('[data-carried]')
        .exists(),
    ).toBe(false);
  });

  it('is the Tab stop itself in edit mode while it has no table', () => {
    const empty = layout({ tables: [] });
    expect(
      draw({ mode: 'edit' }, empty).get('[data-testid="layout-map"]').attributes('tabindex'),
    ).toBe('0');
    wrapper?.unmount();
    expect(
      draw({ mode: 'read' }, empty).get('[data-testid="layout-map"]').attributes('tabindex'),
    ).toBeUndefined();
    wrapper?.unmount();
    expect(
      draw({ mode: 'edit' }).get('[data-testid="layout-map"]').attributes('tabindex'),
    ).toBeUndefined();
  });

  it('draws no selection and no guide outside edit mode', () => {
    const map = draw({
      selection: ['g2'],
      guides: [{ x1Mm: 5000, y1Mm: 0, x2Mm: 5000, y2Mm: 22_500 }],
    });
    expect(map.find('[data-testid="layout-table-selected"]').exists()).toBe(false);
    expect(map.find('[data-testid="layout-map-guide"]').exists()).toBe(false);
  });

  it('emits once for a key held down', async () => {
    const map = draw();
    await tableById(map, 'g3').trigger('keydown', { key: 'Enter' });
    await tableById(map, 'g3').trigger('keydown', { key: 'Enter', repeat: true });
    expect(map.emitted('activate')).toEqual([['g3']]);
  });

  it('leaves the image out of print unless asked, and draws it there as it is', () => {
    expect(draw({ mode: 'print' }).find('[data-testid="layout-map-image"]').exists()).toBe(false);
    wrapper?.unmount();
    const asked = draw({ mode: 'print', showImage: true }).get('[data-testid="layout-map-image"]');
    expect(asked.attributes('opacity')).toBeUndefined();
  });

  it('is a picture in print: no button, no stop, nothing emitted', async () => {
    const map = draw({ mode: 'print' });
    expect(map.attributes('role')).toBe('img');
    expect(map.attributes('aria-label')).toBe('Upper Hall layout, 6 tables');
    for (const drawn of tables(map)) {
      expect(drawn.attributes('role')).toBeUndefined();
      expect(drawn.attributes('tabindex')).toBeUndefined();
    }
    await tableById(map, 'g1').trigger('click');
    expect(map.emitted('activate')).toBeUndefined();
    expect(tableById(map, 'g1').get('[data-testid="layout-table-number"]').text()).toBe('1');
  });
});
