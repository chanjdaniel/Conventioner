/**
 * Fill an area's dialog (T257 ticket 09): the section, the type, how many, the rows' direction
 * and the aisle, with "Fill what is in view"; Fill hands the choice on, and while the placement
 * runs the dialog holds, saying "Placing…". With the sentences the keys' corners are said in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { SectionObject } from '@/assets/types/datatypes';
import LayoutFillDialog from '@/components/layout/LayoutFillDialog.vue';
import { saidCorner, saidCornerTaken } from '@/components/layout/layoutAnnouncements';
import { FILL_CHOICES_AT_FIRST, fillChoices, type FillArea } from '@/components/layout/layoutFill';

const SECTIONS = [
  { id: 'gold', name: 'Gold row', location: null, tier: null, count: 0 },
  { id: 'silver', name: 'Silver aisle', location: null, tier: null, count: 0 },
] as SectionObject[];
const TYPES = [
  { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 },
  { id: 'square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 },
];
const BOX: FillArea = { kind: 'box', box: { left: 0, top: 0, right: 12_000, bottom: 8000 } };

let wrapper: VueWrapper;

function open(props: Record<string, unknown> = {}) {
  wrapper = mount(LayoutFillDialog, {
    attachTo: document.body,
    props: {
      open: true,
      sections: SECTIONS,
      tableTypes: TYPES,
      area: BOX,
      sectionId: 'gold',
      tableTypeId: 'six-foot',
      inView: false,
      ...props,
    },
  });
  return wrapper;
}
const at = (id: string) => wrapper.get(`[data-testid="${id}"]`);
const submit = () => wrapper.get('form').trigger('submit');

beforeEach(() => Object.assign(fillChoices, FILL_CHOICES_AT_FIRST));
afterEach(() => wrapper?.unmount());

describe("Fill an area's dialog", () => {
  it('opens asking for 30 tables in rows across with an aisle of 120 cm, of the section and type the strip held', () => {
    open();

    expect(at('layout-fill-window').attributes('aria-label')).toBe('Fill an area');
    expect((at('layout-fill-section').element as HTMLSelectElement).value).toBe('gold');
    expect((at('layout-fill-type').element as HTMLSelectElement).value).toBe('six-foot');
    expect((at('layout-fill-count-choice').element as HTMLInputElement).checked).toBe(true);
    expect((at('layout-fill-count').element as HTMLInputElement).value).toBe('30');
    expect((at('layout-fill-direction').element as HTMLSelectElement).value).toBe('across');
    expect((at('layout-fill-aisle').element as HTMLInputElement).value).toBe('120');
    expect(at('layout-fill-submit-button').text()).toBe('Fill');
    expect(at('layout-fill-cancel-button').text()).toBe('Cancel');
  });

  it('offers every section of the location and no section, and every table type', () => {
    open();

    expect(
      at('layout-fill-section')
        .findAll('option')
        .map((o) => o.text()),
    ).toEqual(['Gold row', 'Silver aisle', 'No section']);
    expect(
      at('layout-fill-type')
        .findAll('option')
        .map((o) => o.text()),
    ).toEqual(['Standard 6 ft', 'Square 4 ft']);
  });

  it('names the area drawn, and what is in view once that is ticked', async () => {
    open();
    expect(at('layout-fill-area-text').text()).toBe('Area: A box 12.0 m by 8.0 m');

    await at('layout-fill-in-view').setValue(true);
    expect(wrapper.emitted('update:inView')).toEqual([[true]]);
    await wrapper.setProps({ inView: true });

    expect(at('layout-fill-area-text').text()).toBe('Area: What is in view');
  });

  it('opened with no area drawn, fills what is in view, and the tick cannot be taken off', () => {
    open({ area: null, inView: true });

    const tick = at('layout-fill-in-view').element as HTMLInputElement;
    expect(tick.checked).toBe(true);
    expect(tick.disabled).toBe(true);
    expect(at('layout-fill-area-text').text()).toBe('Area: What is in view');
  });

  it('Fill hands on the count, the direction and the aisle in millimetres', async () => {
    open();
    await at('layout-fill-count').setValue('12');
    await at('layout-fill-direction').setValue('down');
    await at('layout-fill-aisle').setValue('90');

    await submit();

    expect(wrapper.emitted('fill')).toEqual([[{ count: 12, direction: 'down', aisleMm: 900 }]]);
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('"As many as fit" hands on no count, and the number field stands by', async () => {
    open();
    await at('layout-fill-fit-choice').setValue(true);

    expect((at('layout-fill-count').element as HTMLInputElement).disabled).toBe(true);
    await submit();

    expect(wrapper.emitted('fill')).toEqual([
      [{ count: null, direction: 'across', aisleMm: 1200 }],
    ]);
  });

  it('a count that is no whole number from 1 to 500 is said under the field, and Fill waits for one', async () => {
    open();

    for (const typed of ['', '0', '2.5', 'lots', '501']) {
      await at('layout-fill-count').setValue(typed);
      expect(at('layout-fill-count-error').text()).toBe('Type a whole number of tables, 1 to 500.');
      expect(at('layout-fill-count').attributes('aria-invalid')).toBe('true');
      expect((at('layout-fill-submit-button').element as HTMLButtonElement).disabled).toBe(true);
      await submit();
    }
    expect(wrapper.emitted('fill')).toBeUndefined();

    // As many as fit needs no number: what was typed is not in its way.
    await at('layout-fill-fit-choice').setValue(true);
    expect(wrapper.find('[data-testid="layout-fill-count-error"]').exists()).toBe(false);
    expect((at('layout-fill-submit-button').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('an aisle that is no length from 0 to 1,000 cm is said under the field, and Fill waits for one', async () => {
    open();

    for (const typed of ['', '-5', 'wide', '1001']) {
      await at('layout-fill-aisle').setValue(typed);
      expect(at('layout-fill-aisle-error').text()).toBe(
        "Type the aisle's width in centimetres, 0 to 1,000.",
      );
      expect(at('layout-fill-aisle').attributes('aria-invalid')).toBe('true');
      expect((at('layout-fill-submit-button').element as HTMLButtonElement).disabled).toBe(true);
      await submit();
    }
    expect(wrapper.emitted('fill')).toBeUndefined();

    await at('layout-fill-aisle').setValue('0');
    expect(wrapper.find('[data-testid="layout-fill-aisle-error"]').exists()).toBe(false);
    await at('layout-fill-aisle').setValue('1000');
    await submit();
    expect(wrapper.emitted('fill')![0][0]).toMatchObject({ aisleMm: 10_000 });
  });

  it("the section and the type chosen are the strip's", async () => {
    open();

    await at('layout-fill-section').setValue('');
    await at('layout-fill-type').setValue('square');

    expect(wrapper.emitted('update:sectionId')).toEqual([['']]);
    expect(wrapper.emitted('update:tableTypeId')).toEqual([['square']]);
  });

  it('while the placement runs, Fill says "Placing…" and nothing closes or changes the dialog', async () => {
    open({ busy: true });

    const fill = at('layout-fill-submit-button');
    expect(fill.text()).toBe('Placing…');
    expect((fill.element as HTMLButtonElement).disabled).toBe(true);
    expect((at('layout-fill-cancel-button').element as HTMLButtonElement).disabled).toBe(true);
    expect((at('layout-fill-section').element as HTMLSelectElement).disabled).toBe(true);
    expect((at('layout-fill-count').element as HTMLInputElement).disabled).toBe(true);
    await submit();
    await at('layout-fill-background').trigger('click');

    expect(wrapper.emitted('fill')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it("writes the server's refusal into the dialog", () => {
    open({ error: 'An area is drawn with 3 to 50 corners that do not cross.' });

    expect(at('layout-fill-error').text()).toBe(
      'An area is drawn with 3 to 50 corners that do not cross.',
    );
  });

  it('keeps what was chosen for the next area', async () => {
    open();
    await at('layout-fill-fit-choice').setValue(true);
    await at('layout-fill-direction').setValue('down');
    wrapper.unmount();

    open();

    expect((at('layout-fill-fit-choice').element as HTMLInputElement).checked).toBe(true);
    expect((at('layout-fill-direction').element as HTMLSelectElement).value).toBe('down');
  });
});

describe('what the keys say of an area', () => {
  it('says each corner laid, with its place', () => {
    expect(saidCorner(3, { xMm: 12_400, yMm: 6100 })).toBe('Corner 3 at 12.4 m, 6.1 m.');
  });

  it('says a corner taken back, and when none is left', () => {
    expect(saidCornerTaken(3)).toBe('Corner 3 taken back.');
    expect(saidCornerTaken(1)).toBe('Corner 1 taken back. No corners left.');
  });
});
