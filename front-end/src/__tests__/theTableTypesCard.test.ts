/**
 * The layout page's "Table types" card (T257 ticket 10): the market's types with their sizes and
 * how many tables are of each; adding, editing and removing one, a type tables use refused with
 * their count; and saving the types under a name and using a saved set, by name, in another
 * market.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { FloorplanObject, TableTypeObject } from '@/assets/types/datatypes';
import LayoutPanelTypes from '@/components/layout/LayoutPanelTypes.vue';
import { api } from '@/utils/api';
import {
  LayoutNotSaved,
  listSavedTypes,
  sideIn,
  sizeInWords,
  tablesOfEachType,
  typeInUse,
  typeOf,
  typedTypeErrors,
  withSavedTypes,
  type SavedTypes,
} from '@/components/layout/layoutTypes';

const SIX_FOOT: TableTypeObject = {
  id: 'tt-six',
  name: 'Standard 6 ft',
  widthMm: 1830,
  depthMm: 760,
};
const SQUARE: TableTypeObject = {
  id: 'tt-square',
  name: 'Square 4 ft',
  widthMm: 1220,
  depthMm: 1220,
};

const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.querySelector<T>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

function layout(id: string, locationId: string | null, types: string[]): FloorplanObject {
  return {
    id,
    locationId,
    revision: 1,
    tables: types.map((tableTypeId, n) => ({
      id: `${id}-${n}`,
      sectionId: null,
      number: null,
      tableTypeId,
      xMm: 0,
      yMm: 0,
      rotation: 0,
    })),
    zones: [],
    sectionStyles: [],
    startingCounts: [],
  };
}

describe('a table type in words', () => {
  it('is its size in centimetres, to a tenth', () => {
    expect(sizeInWords(SIX_FOOT)).toBe('183 x 76 cm');
    expect(sizeInWords({ widthMm: 1219.2, depthMm: 1219.2 })).toBe('121.9 x 121.9 cm');
  });

  it('shows a side in the unit chosen', () => {
    expect(sideIn(1830, 'cm')).toBe('183');
    expect(sideIn(1830, 'm')).toBe('1.83');
    expect(sideIn(1219.2, 'ft')).toBe('4');
  });

  it('says why a type tables use is kept, one table and many', () => {
    expect(typeInUse(12, 'Square 4 ft')).toBe('12 tables are Square 4 ft. Change them first.');
    expect(typeInUse(1, 'Square 4 ft')).toBe('1 table is Square 4 ft. Change it first.');
  });
});

describe('the tables of each type', () => {
  it("are counted over the market's layouts, the edited one as it stands, a beta's left out", () => {
    const stored = [
      layout('fp-upper', 'loc-upper', ['tt-six']),
      layout('fp-lower', 'loc-lower', ['tt-square', 'tt-square']),
      layout('fp-beta', null, ['tt-square']),
    ];
    const working = layout('fp-upper', 'loc-upper', ['tt-square', 'tt-six', 'tt-six']);

    const counts = tablesOfEachType(stored, working);

    expect(counts.get('tt-square')).toBe(3);
    expect(counts.get('tt-six')).toBe(2);
  });
});

describe('a typed type', () => {
  const typed = { name: 'Square 4 ft', width: '122', depth: '122', unit: 'cm' as const };

  it('is kept in millimetres to a tenth, its name trimmed', () => {
    expect(typeOf({ ...typed, name: '  Square 4 ft ' }, 'id-1')).toEqual({
      id: 'id-1',
      name: 'Square 4 ft',
      widthMm: 1220,
      depthMm: 1220,
    });
    expect(typeOf({ ...typed, width: '4', depth: '4', unit: 'ft' }, 'id-1').widthMm).toBe(1219.2);
  });

  it('needs a name of its own and sides in range', () => {
    expect(typedTypeErrors(typed, [SIX_FOOT])).toEqual({});
    expect(typedTypeErrors({ ...typed, name: ' ' }, []).name).toBe('Give the type a name.');
    expect(typedTypeErrors({ ...typed, name: 'standard 6 FT' }, [SIX_FOOT]).name).toBe(
      'There is a type named standard 6 FT already.',
    );
    expect(typedTypeErrors({ ...typed, width: 'wide' }, []).width).toBe(
      'Type the width as a number of cm.',
    );
    expect(typedTypeErrors({ ...typed, depth: '5' }, []).depth).toBe(
      'The depth is between 10 and 2000 cm.',
    );
  });
});

describe('a saved set of types', () => {
  const VENUE: SavedTypes = {
    id: 'tpl-1',
    name: 'Riverside Hall',
    tableTypes: [
      { name: 'standard 6 FT', widthMm: 1800, depthMm: 750 },
      { name: 'Round 5 ft', widthMm: 1520, depthMm: 1520 },
    ],
  };

  it('adds the types the market has none of by name, each a new id', () => {
    let n = 0;
    const next = withSavedTypes([SIX_FOOT], VENUE, () => `new-${++n}`);
    expect(next).toEqual([
      SIX_FOOT,
      { id: 'new-1', name: 'Round 5 ft', widthMm: 1520, depthMm: 1520 },
    ]);
  });
});

describe('the saved sets listed', () => {
  it("are the person's own alone where they are not in the market's organization", async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { templates: [{ id: 't1', name: 'Mine', tableTypes: [] }] },
    });
    const listed = await listSavedTypes(null);
    expect(get).toHaveBeenCalledTimes(1);
    expect(listed.map((one) => one.name)).toEqual(['Mine']);
    get.mockRestore();
  });

  it("are the organization's too, each once, the own kept when the organization's fail", async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ data: { templates: [{ id: 't1', name: 'Mine', tableTypes: [] }] } })
      .mockRejectedValueOnce(new Error('403'));
    expect((await listSavedTypes('org-1')).map((one) => one.name)).toEqual(['Mine']);
    get.mockRestore();
  });
});

// ── The card ─────────────────────────────────────────────────────────────────

function card(props: Partial<InstanceType<typeof LayoutPanelTypes>['$props']> = {}): VueWrapper {
  return mount(LayoutPanelTypes, {
    attachTo: document.body,
    props: {
      tableTypes: [SIX_FOOT, SQUARE],
      counts: new Map([
        ['tt-six', 4],
        ['tt-square', 12],
      ]),
      editable: true,
      ...props,
    },
  });
}

async function choose(wrapper: VueWrapper, type: TableTypeObject, item: 'edit' | 'remove') {
  byTestId(`layout-type-menu-${type.id}-button`)!.click();
  await wrapper.vm.$nextTick();
  byTestId(`layout-type-menu-${type.id}-${item}`)!.click();
  await flushPromises();
}

async function type(wrapper: VueWrapper, testid: string, value: string) {
  const field = byTestId<HTMLInputElement>(testid)!;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await wrapper.vm.$nextTick();
}

async function submit(prefix: string) {
  byTestId(`${prefix}-submit-button`)!.closest('form')!.dispatchEvent(new Event('submit'));
  await flushPromises();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the Table types card', () => {
  it('lists each type with its size and its count of tables', () => {
    card();
    const rows = all('layout-type-row');
    expect(
      rows.map((row) => row.querySelector('[data-testid="layout-type-size"]')!.textContent),
    ).toEqual(['183 x 76 cm', '122 x 122 cm']);
    expect(all('layout-type-count').map((count) => count.textContent!.trim())).toEqual([
      '4 tables',
      '12 tables',
    ]);
  });

  it('offers a reader no control', () => {
    card({ editable: false });
    expect(byTestId('layout-types-add')).toBeNull();
    expect(byTestId('layout-type-menu-tt-six-button')).toBeNull();
  });

  it('adds a type, written with the others, and says so', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = card({ save });
    byTestId('layout-types-add')!.click();
    await flushPromises();
    expect(byTestId('layout-type-window')!.getAttribute('aria-label')).toBe('Add a table type');

    await type(wrapper, 'layout-type-name', 'Round 5 ft');
    await type(wrapper, 'layout-type-width', '152');
    await type(wrapper, 'layout-type-depth', '152');
    await submit('layout-type');

    const [types] = save.mock.calls[0];
    expect(types.slice(0, 2)).toEqual([SIX_FOOT, SQUARE]);
    expect(types[2]).toMatchObject({ name: 'Round 5 ft', widthMm: 1520, depthMm: 1520 });
    expect(byTestId('layout-type-window')).toBeNull();
    expect(byTestId('layout-types-said')!.textContent!.trim()).toBe('Added Round 5 ft.');
  });

  it('edits a type in place, keeping its id, its sides shown in cm', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = card({ save });
    await choose(wrapper, SQUARE, 'edit');
    expect(byTestId<HTMLInputElement>('layout-type-width')!.value).toBe('122');

    await type(wrapper, 'layout-type-width', '120');
    await type(wrapper, 'layout-type-depth', '120');
    await submit('layout-type');

    expect(save).toHaveBeenCalledWith([
      SIX_FOOT,
      { id: 'tt-square', name: 'Square 4 ft', widthMm: 1200, depthMm: 1200 },
    ]);
  });

  it('carries the sides typed into a new unit', async () => {
    const wrapper = card();
    await choose(wrapper, SIX_FOOT, 'edit');
    const unit = byTestId<HTMLSelectElement>('layout-type-unit')!;
    unit.value = 'm';
    unit.dispatchEvent(new Event('change'));
    await wrapper.vm.$nextTick();
    expect(byTestId<HTMLInputElement>('layout-type-width')!.value).toBe('1.83');
    expect(byTestId<HTMLInputElement>('layout-type-depth')!.value).toBe('0.76');
  });

  it('writes nothing for a type that is refused, and says why under the field', async () => {
    const save = vi.fn();
    const wrapper = card({ save });
    byTestId('layout-types-add')!.click();
    await flushPromises();
    await type(wrapper, 'layout-type-name', 'Square 4 ft');
    await submit('layout-type');

    expect(save).not.toHaveBeenCalled();
    expect(byTestId('layout-type-name-error')!.textContent).toBe(
      'There is a type named Square 4 ft already.',
    );
  });

  it('keeps the dialog open with the refusal written in it', async () => {
    const save = vi.fn().mockRejectedValue(new LayoutNotSaved('Could not save the layout.'));
    const wrapper = card({ save });
    await choose(wrapper, SQUARE, 'edit');
    await submit('layout-type');

    expect(byTestId('layout-type-error')!.textContent).toContain('Could not save the layout.');
  });

  it('refuses removing a type 12 tables use, with their count, and writes nothing', async () => {
    const save = vi.fn();
    const wrapper = card({ save });
    await choose(wrapper, SQUARE, 'remove');

    expect(save).not.toHaveBeenCalled();
    const said = byTestId('layout-types-said')!;
    expect(said.getAttribute('role')).toBe('alert');
    expect(said.textContent!.trim()).toBe('12 tables are Square 4 ft. Change them first.');
  });

  it('removes a type no table uses, and gives the focus to "Add a type"', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = card({ save, counts: new Map([['tt-six', 4]]) });
    await choose(wrapper, SQUARE, 'remove');

    expect(save).toHaveBeenCalledWith([SIX_FOOT]);
    expect(byTestId('layout-types-said')!.textContent!.trim()).toBe('Removed Square 4 ft.');
    expect(document.activeElement).toBe(byTestId('layout-types-add'));
  });

  it('saves these types under a name', async () => {
    const saveAs = vi.fn().mockResolvedValue(undefined);
    const wrapper = card({ saveAs });
    byTestId('layout-types-save')!.click();
    await flushPromises();
    await submit('layout-save-types');
    expect(saveAs).not.toHaveBeenCalled();
    expect(byTestId('layout-save-types-name-error')).not.toBeNull();

    await type(wrapper, 'layout-save-types-name', '  Riverside Hall ');
    await submit('layout-save-types');

    expect(saveAs).toHaveBeenCalledWith('Riverside Hall');
    expect(byTestId('layout-types-said')!.textContent!.trim()).toBe(
      'Saved these types as Riverside Hall.',
    );
  });

  it('uses a saved set, adding the types it lacks by name', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const listSaved = vi.fn().mockResolvedValue([
      {
        id: 'tpl-1',
        name: 'Riverside Hall',
        tableTypes: [
          { name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 },
          { name: 'Round 5 ft', widthMm: 1520, depthMm: 1520 },
        ],
      },
    ]);
    card({ save, listSaved });
    byTestId('layout-types-use-saved')!.click();
    await flushPromises();

    const [choice] = all('layout-saved-choice');
    expect(choice.querySelector('.saved-name')!.textContent).toBe('Riverside Hall');
    expect(choice.querySelector('.saved-types')!.textContent!.trim()).toBe(
      '2 types: Square 4 ft (122 x 122 cm), Round 5 ft (152 x 152 cm)',
    );
    await submit('layout-saved-types');

    const [types] = save.mock.calls[0];
    expect(types.map((one: TableTypeObject) => one.name)).toEqual([
      'Standard 6 ft',
      'Square 4 ft',
      'Round 5 ft',
    ]);
    expect(byTestId('layout-types-said')!.textContent!.trim()).toBe(
      'Added 1 type from Riverside Hall.',
    );
  });

  it('says when nothing is saved yet', async () => {
    card({ listSaved: vi.fn().mockResolvedValue([]) });
    byTestId('layout-types-use-saved')!.click();
    await flushPromises();
    expect(byTestId('layout-saved-none')).not.toBeNull();
    expect(byTestId<HTMLButtonElement>('layout-saved-types-submit-button')!.disabled).toBe(true);
  });

  it('says when a saved set adds nothing', async () => {
    const save = vi.fn();
    card({
      save,
      listSaved: vi.fn().mockResolvedValue([
        {
          id: 'tpl-1',
          name: 'Same',
          tableTypes: [{ name: 'Square 4 ft', widthMm: 1, depthMm: 1 }],
        },
      ]),
    });
    byTestId('layout-types-use-saved')!.click();
    await flushPromises();
    await submit('layout-saved-types');

    expect(save).not.toHaveBeenCalled();
    expect(byTestId('layout-saved-types-error')!.textContent).toContain(
      'This market has every type Same holds.',
    );
  });
});
