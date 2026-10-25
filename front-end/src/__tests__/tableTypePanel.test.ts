/**
 * The floorplan's table types, on the product's own primitives (T45).
 *
 * The panel was built on a component library with no theme installed (ADR 0015), so its Edit Table
 * Type dialog drew with no window and no scrim, Max Capacity showed no selected value, and Save
 * stayed disabled until a dimension field lost focus, because the library's number field committed
 * on blur.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TableTypePanel from '@/components/floorplan/TableTypePanel.vue';
import { useFloorplanStore } from '@/stores/floorplan';

const SIX_FOOT = {
  id: 'six-foot',
  name: 'Six-foot',
  widthMm: 1800,
  heightMm: 750,
  maxCapacity: 2,
  color: '#4A90D9',
};

function panel(): VueWrapper {
  return mount(TableTypePanel, { attachTo: document.body });
}

/** The HTML spec's valid floating-point number: anything else a number field reports as empty. */
const VALID_FLOAT = /^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Type into a field the way a keyboard does: an `input` event per keystroke, no blur.
 *
 * A browser's number field reports a half-typed "1." as empty while still showing it; happy-dom
 * reports "1.", so that is done here by hand. Without it, a field redrawn from its parsed number
 * passes this suite while turning "1.05" into "15" in a browser.
 */
async function type(wrapper: VueWrapper, selector: string, text: string): Promise<void> {
  const field = wrapper.find<HTMLInputElement>(selector);
  const isNumber = field.element.type === 'number';
  let onScreen = field.element.value;
  for (const key of text) {
    onScreen += key;
    const reported = isNumber && !VALID_FLOAT.test(onScreen) ? '' : onScreen;
    field.element.value = reported;
    await field.trigger('input');
    // A component that redraws the field changes what is on screen, and the next key lands there.
    if (field.element.value !== reported) onScreen = field.element.value;
  }
}

let store: ReturnType<typeof useFloorplanStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  store = useFloorplanStore();
  document.body.innerHTML = '';
});

describe('the add form', () => {
  async function opened(): Promise<VueWrapper> {
    const wrapper = panel();
    await wrapper.find('[data-testid="floorplan-table-type-add-btn"]').trigger('click');
    return wrapper;
  }

  it('enables Save once a name, a width and a height are typed, without leaving the field', async () => {
    const wrapper = await opened();
    const save = wrapper.find<HTMLButtonElement>('[data-testid="floorplan-table-type-save-btn"]');

    await type(wrapper, '[data-testid="floorplan-table-type-name-input"]', 'Six-foot');
    await type(wrapper, '[data-testid="floorplan-table-type-width-input"]', '1800');
    expect(save.element.disabled).toBe(true);
    await type(wrapper, '[data-testid="floorplan-table-type-height-input"]', '750');

    expect(save.element.disabled).toBe(false);
  });

  it('keeps a number as it is typed, so "1.05" is not turned into "15" on the way', async () => {
    const wrapper = await opened();
    await type(wrapper, '[data-testid="floorplan-table-type-width-input"]', '1.05');

    expect(
      wrapper.find<HTMLInputElement>('[data-testid="floorplan-table-type-width-input"]').element
        .value,
    ).toBe('1.05');
  });

  it('saves what was typed, in millimetres', async () => {
    const wrapper = await opened();
    await type(wrapper, '[data-testid="floorplan-table-type-name-input"]', 'Six-foot');
    await type(wrapper, '[data-testid="floorplan-table-type-width-input"]', '6');
    await type(wrapper, '[data-testid="floorplan-table-type-height-input"]', '2.5');
    await wrapper.find('#tt-unit').setValue('ft');
    await wrapper.find('form.tt-inline-form').trigger('submit');

    expect(store.tableTypes).toHaveLength(1);
    expect(store.tableTypes[0].name).toBe('Six-foot');
    expect(store.tableTypes[0].widthMm).toBeCloseTo(1828.8, 9);
    expect(store.tableTypes[0].heightMm).toBeCloseTo(762, 9);
  });

  it('shows Max Capacity as a named group with two seated by default', async () => {
    const wrapper = await opened();
    const group = wrapper.find('fieldset[data-testid="floorplan-table-type-capacity"]');

    expect(group.find('legend').text()).toBe('Max Capacity');
    const radios = group.findAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.map((r) => r.element.value)).toEqual(['1', '2']);
    expect(radios.map((r) => r.element.checked)).toEqual([false, true]);
  });
  it.each(['0', '-5'])(
    'refuses a width of %s with its own message, and saves nothing',
    async (text) => {
      const wrapper = await opened();
      await type(wrapper, '[data-testid="floorplan-table-type-name-input"]', 'Six-foot');
      await type(wrapper, '[data-testid="floorplan-table-type-width-input"]', text);
      await type(wrapper, '[data-testid="floorplan-table-type-height-input"]', '750');
      await wrapper.find('form.tt-inline-form').trigger('submit');

      expect(wrapper.find('.tt-error').text()).toBe('Width must be a positive number.');
      expect(store.tableTypes).toHaveLength(0);
    },
  );
});

describe('the edit dialog', () => {
  async function editing(): Promise<VueWrapper> {
    store.tableTypes.push({ ...SIX_FOOT });
    const wrapper = panel();
    await wrapper.find('button[aria-label="Edit table type"]').trigger('click');
    await flushPromises();
    return wrapper;
  }

  const width = (wrapper: VueWrapper) =>
    wrapper.find<HTMLInputElement>('[data-testid="floorplan-table-type-edit-width-input"]');
  const height = (wrapper: VueWrapper) =>
    wrapper.find<HTMLInputElement>('[data-testid="floorplan-table-type-edit-height-input"]');

  it('is the product dialog, titled and named, with the type filled in', async () => {
    const wrapper = await editing();
    const dialog = wrapper.find('[data-testid="floorplan-table-type-edit-window"]');

    expect(dialog.attributes('role')).toBe('dialog');
    expect(dialog.attributes('aria-label')).toBe('Edit Table Type');
    expect(dialog.find('.dialog-title').text()).toBe('Edit Table Type');
    expect(
      wrapper.find<HTMLInputElement>('[data-testid="floorplan-table-type-edit-name-input"]').element
        .value,
    ).toBe('Six-foot');
    expect(width(wrapper).element.value).toBe('1800');
    expect(height(wrapper).element.value).toBe('750');
    expect(wrapper.find('[data-testid="floorplan-table-type-edit-submit-button"]').text()).toBe(
      'Update',
    );
  });

  it('shows the capacity it was saved with, in a group named Max Capacity', async () => {
    store.tableTypes.push({ ...SIX_FOOT, id: 'one-seat', maxCapacity: 1 });
    const wrapper = panel();
    await wrapper.findAll('button[aria-label="Edit table type"]')[0].trigger('click');
    await flushPromises();
    const group = wrapper.find('fieldset[data-testid="floorplan-table-type-edit-capacity"]');

    expect(group.find('legend').text()).toBe('Max Capacity');
    expect(group.findAll<HTMLInputElement>('input').map((r) => r.element.checked)).toEqual([
      true,
      false,
    ]);
  });

  it('gives each capacity group its own name, so choosing in one never clears the other', async () => {
    store.tableTypes.push({ ...SIX_FOOT });
    const wrapper = panel();
    await wrapper.find('[data-testid="floorplan-table-type-add-btn"]').trigger('click');
    await wrapper.find('button[aria-label="Edit table type"]').trigger('click');
    const names = wrapper
      .findAll<HTMLInputElement>('input[type="radio"]')
      .map((r) => r.element.name);

    expect(new Set(names).size).toBe(2);
  });

  it('shows at most three decimals after a unit change', async () => {
    const wrapper = await editing();
    await wrapper.find('[data-testid="floorplan-table-type-edit-unit-select"]').setValue('ft');

    // 1800 / 304.8 is 5.905511811…, 750 / 304.8 is 2.460629921…
    expect(width(wrapper).element.value).toBe('5.906');
    expect(height(wrapper).element.value).toBe('2.461');
  });

  it('saves the same millimetres for dimensions it did not touch, whatever the unit', async () => {
    const wrapper = await editing();
    for (const unit of ['ft', 'in', 'cm']) {
      await wrapper.find('[data-testid="floorplan-table-type-edit-unit-select"]').setValue(unit);
    }
    await wrapper.find('[data-testid="floorplan-table-type-edit-window"] form').trigger('submit');

    expect(store.tableTypes[0]).toMatchObject({ widthMm: 1800, heightMm: 750 });
  });

  it('saves a typed dimension in the unit it was typed in', async () => {
    const wrapper = await editing();
    await wrapper.find('[data-testid="floorplan-table-type-edit-unit-select"]').setValue('cm');
    width(wrapper).element.value = '';
    await width(wrapper).trigger('input');
    await type(wrapper, '[data-testid="floorplan-table-type-edit-width-input"]', '152.5');
    await wrapper.find('[data-testid="floorplan-table-type-edit-window"] form').trigger('submit');

    expect(store.tableTypes[0]).toMatchObject({ widthMm: 1525, heightMm: 750 });
  });

  it('closes on save and on cancel, and a cancel saves nothing', async () => {
    const wrapper = await editing();
    await wrapper
      .find<HTMLInputElement>('[data-testid="floorplan-table-type-edit-name-input"]')
      .setValue('Renamed');
    await wrapper.find('[data-testid="floorplan-table-type-edit-cancel-button"]').trigger('click');

    expect(wrapper.find('[data-testid="floorplan-table-type-edit-window"]').exists()).toBe(false);
    expect(store.tableTypes[0].name).toBe('Six-foot');
  });

  it('opens a 40 ft type in millimetres the browser accepts, and Update saves it untouched', async () => {
    store.tableTypes.push({ ...SIX_FOOT, widthMm: 12192, heightMm: 750 });
    const wrapper = panel();
    await wrapper.find('button[aria-label="Edit table type"]').trigger('click');
    await flushPromises();
    const form = wrapper.find<HTMLFormElement>(
      '[data-testid="floorplan-table-type-edit-window"] form',
    );

    expect(
      wrapper.find<HTMLSelectElement>('[data-testid="floorplan-table-type-edit-unit-select"]')
        .element.value,
    ).toBe('mm');
    expect(width(wrapper).element.value).toBe('12192');
    expect(form.element.checkValidity()).toBe(true);
    await form.trigger('submit');

    expect(store.tableTypes[0]).toMatchObject({ widthMm: 12192, heightMm: 750 });
  });

  it('shows 250 mm as 0.82 ft, which the browser accepts, and Update saves 250 mm', async () => {
    store.tableTypes.push({ ...SIX_FOOT, widthMm: 250, heightMm: 250 });
    const wrapper = panel();
    await wrapper.find('button[aria-label="Edit table type"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="floorplan-table-type-edit-unit-select"]').setValue('ft');
    const form = wrapper.find<HTMLFormElement>(
      '[data-testid="floorplan-table-type-edit-window"] form',
    );

    expect(width(wrapper).element.value).toBe('0.82');
    expect(height(wrapper).element.value).toBe('0.82');
    expect(form.element.checkValidity()).toBe(true);
    await form.trigger('submit');

    expect(store.tableTypes[0]).toMatchObject({ widthMm: 250, heightMm: 250 });
  });

  it.each(['0', '-5'])(
    'refuses a width of %s with its own message, and saves nothing',
    async (text) => {
      const wrapper = await editing();
      width(wrapper).element.value = '';
      await width(wrapper).trigger('input');
      await type(wrapper, '[data-testid="floorplan-table-type-edit-width-input"]', text);
      await wrapper.find('[data-testid="floorplan-table-type-edit-window"] form').trigger('submit');

      expect(wrapper.find('[data-testid="floorplan-table-type-edit-error"]').text()).toBe(
        'Width must be a positive number.',
      );
      expect(wrapper.find('[data-testid="floorplan-table-type-edit-window"]').exists()).toBe(true);
      expect(store.tableTypes[0]).toMatchObject({ widthMm: 1800, heightMm: 750 });
    },
  );

  it('cannot Update with a dimension cleared', async () => {
    const wrapper = await editing();
    width(wrapper).element.value = '';
    await width(wrapper).trigger('input');

    expect(
      wrapper.find<HTMLButtonElement>('[data-testid="floorplan-table-type-edit-submit-button"]')
        .element.disabled,
    ).toBe(true);
  });
});

it('lists a type entered in feet at three decimals, not every digit of the conversion', () => {
  // Six feet is 1828.8000000000002 mm in floating point, and the card printed all of it.
  store.tableTypes.push({ ...SIX_FOOT, widthMm: 6 * 304.8, heightMm: 2.5 * 304.8 });
  const wrapper = panel();

  expect(wrapper.find('.tt-type-dims').text()).toMatch(/^1828\.8×762 mm/);
});
