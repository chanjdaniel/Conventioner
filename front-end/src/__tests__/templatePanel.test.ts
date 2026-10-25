/**
 * The floorplan's template dialogs, on the product's own dialog (T45).
 *
 * Save Template and Load Template were PrimeVue dialogs with no theme installed, so both drew with
 * no window and no scrim, and the overrides meant to style them never reached the teleported markup.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { FloorplanTemplate, TableTypeObject } from '@/assets/types/datatypes';

const post = vi.fn();
const get = vi.fn();
vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  api: {
    post: (...args: unknown[]) => post(...args),
    get: (...args: unknown[]) => get(...args),
  },
}));

import TemplatePanel from '@/components/floorplan/TemplatePanel.vue';
import { useFloorplanStore } from '@/stores/floorplan';

const SOURCE = readFileSync(
  resolve(__dirname, '../components/floorplan/TemplatePanel.vue'),
  'utf-8',
);

const SIX_FOOT: TableTypeObject = {
  id: 'six-foot',
  name: 'Six-foot',
  widthMm: 1800,
  heightMm: 750,
  maxCapacity: 2,
  color: '#4A90D9',
};

const EIGHT_FOOT: TableTypeObject = { ...SIX_FOOT, id: 'eight-foot', name: 'Eight-foot' };
const ROUND: TableTypeObject = { ...SIX_FOOT, id: 'round', name: 'Round' };

const STANDARD: FloorplanTemplate = {
  id: 'tpl-standard',
  name: 'Standard layout',
  tableTypes: [EIGHT_FOOT, ROUND],
  aisles: { wallBufferMm: 1500, tableSpacingMm: 1200, walkwayWidthMm: 2000 },
  createdAt: '2026-10-01T10:00:00',
  updatedAt: '2026-10-01T10:00:00',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let store: ReturnType<typeof useFloorplanStore>;

beforeEach(() => {
  setActivePinia(createPinia());
  store = useFloorplanStore();
  store.tableTypes = [{ ...SIX_FOOT }];
  document.body.innerHTML = '';
  post.mockReset();
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function panel(): VueWrapper {
  return mount(TemplatePanel, { attachTo: document.body });
}

it('uses nothing from PrimeVue', () => {
  expect(SOURCE).not.toMatch(/from ['"]primevue/);
});

describe('Save Template', () => {
  async function opened(): Promise<VueWrapper> {
    const wrapper = panel();
    await wrapper.get('button.tp-btn--save').trigger('click');
    return wrapper;
  }

  const nameField = () => document.querySelector<HTMLInputElement>('#template-name')!;
  const submit = () =>
    document.querySelector<HTMLButtonElement>(
      '[data-testid="floorplan-template-save-submit-button"]',
    )!;

  async function typeName(wrapper: VueWrapper, name: string) {
    nameField().value = name;
    nameField().dispatchEvent(new Event('input'));
    await wrapper.vm.$nextTick();
  }

  it('is the product dialog, its name a plain text field under its label', async () => {
    await opened();

    const saveWindow = byTestId('floorplan-template-save-window')!;
    expect(saveWindow.getAttribute('role')).toBe('dialog');
    expect(saveWindow.getAttribute('aria-label')).toBe('Save Template');
    expect(saveWindow.querySelector('form')).not.toBeNull();
    expect(nameField().type).toBe('text');
    expect(nameField().classList.contains('field')).toBe(true);
    expect(nameField().maxLength).toBe(100);
    expect(saveWindow.querySelector('label[for="template-name"]')!.textContent).toBe(
      'Template name',
    );
    expect(document.activeElement).toBe(nameField());
  });

  it('enables Save only once a name is typed', async () => {
    const wrapper = await opened();
    expect(submit().disabled).toBe(true);

    await typeName(wrapper, '   ');
    expect(submit().disabled).toBe(true);

    await typeName(wrapper, 'Standard layout');
    expect(submit().disabled).toBe(false);
  });

  it('saves the trimmed name with the current table types, then closes and says so', async () => {
    post.mockResolvedValue({ data: {} });
    const wrapper = await opened();
    await typeName(wrapper, '  Standard layout ');

    submit().closest('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();

    expect(post).toHaveBeenCalledWith(
      '/floorplans/templates',
      expect.objectContaining({ name: 'Standard layout', tableTypes: [SIX_FOOT] }),
    );
    expect(byTestId('floorplan-template-save-window')).toBeNull();
    // The quotes were written as `&ldquo;` in a script string, which text never decodes.
    expect(wrapper.get('.feedback-toast').text()).toBe('Template “Standard layout” saved.');
  });

  it('does not close while a save is in flight, by any of its closes', async () => {
    const answer = deferred<{ data: object }>();
    post.mockReturnValue(answer.promise);
    const wrapper = await opened();
    await typeName(wrapper, 'Standard layout');

    submit().closest('form')!.dispatchEvent(new Event('submit'));
    await wrapper.vm.$nextTick();

    expect(submit().textContent!.trim()).toBe('Saving…');
    expect(submit().disabled).toBe(true);
    expect(nameField().disabled).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    byTestId('floorplan-template-save-background')!.click();
    byTestId('floorplan-template-save-close-button')!.click();
    byTestId('floorplan-template-save-cancel-button')!.click();
    await wrapper.vm.$nextTick();
    expect(byTestId('floorplan-template-save-window')).not.toBeNull();

    answer.resolve({ data: {} });
    await flushPromises();
    expect(byTestId('floorplan-template-save-window')).toBeNull();
  });

  it('keeps the dialog open with the server error in it', async () => {
    post.mockRejectedValue({ response: { data: { error: 'Template name is required' } } });
    const wrapper = await opened();
    await typeName(wrapper, 'Standard layout');

    submit().closest('form')!.dispatchEvent(new Event('submit'));
    await flushPromises();

    expect(byTestId('floorplan-template-save-error')!.textContent).toBe(
      'Template name is required',
    );
    expect(nameField().value).toBe('Standard layout');
  });

  it('closes without saving, and opens empty again', async () => {
    const wrapper = await opened();
    await typeName(wrapper, 'Standard layout');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(byTestId('floorplan-template-save-window')).toBeNull();
    expect(post).not.toHaveBeenCalled();

    await wrapper.get('button.tp-btn--save').trigger('click');
    expect(nameField().value).toBe('');
  });
});

describe('Load Template', () => {
  async function opened(templates: FloorplanTemplate[] = [STANDARD]): Promise<VueWrapper> {
    get.mockResolvedValue({ data: { templates } });
    const wrapper = panel();
    await wrapper.get('button.tp-btn--load').trigger('click');
    await flushPromises();
    return wrapper;
  }

  const loadWindow = () => byTestId('floorplan-template-load-window')!;
  const cards = () => [...loadWindow().querySelectorAll<HTMLButtonElement>('.tp-template-card')];
  const button = (name: string) =>
    [...loadWindow().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent!.trim() === name,
    )!;

  it('is the wide product dialog of several actions, with no form of its own', async () => {
    await opened();

    expect(loadWindow().getAttribute('aria-label')).toBe('Load Template');
    expect(loadWindow().classList.contains('dialog-window--wide')).toBe(true);
    expect(loadWindow().querySelector('form')).toBeNull();
    expect(byTestId('floorplan-template-load-submit-button')).toBeNull();
  });

  it('says so when nothing is saved yet', async () => {
    await opened([]);
    expect(loadWindow().textContent).toContain('No templates saved yet.');
  });

  it('shows a failed read as the dialog error', async () => {
    get.mockRejectedValue({ response: { data: { error: 'User not found' } } });
    const wrapper = panel();
    await wrapper.get('button.tp-btn--load').trigger('click');
    await flushPromises();

    expect(byTestId('floorplan-template-load-error')!.textContent).toBe('User not found');
  });

  it('confirms a choice, and Cancel goes back to the list', async () => {
    const wrapper = await opened();
    expect(cards().map((c) => c.querySelector('.tp-template-name')!.textContent)).toEqual([
      'Standard layout',
    ]);

    cards()[0].click();
    await wrapper.vm.$nextTick();
    expect(loadWindow().getAttribute('aria-label')).toBe('Confirm Load');
    expect(
      loadWindow().querySelector('.tp-confirm-text')!.textContent!.replace(/\s+/g, ' '),
    ).toContain('Replace the current 1 table type with 2 from “Standard layout”?');
    expect(button('Cancel').type).toBe('button');
    expect(button('Replace Table Types').classList.contains('btn--destructive')).toBe(true);

    button('Cancel').click();
    await wrapper.vm.$nextTick();
    expect(loadWindow().getAttribute('aria-label')).toBe('Load Template');
    expect(cards()).toHaveLength(1);
    expect(store.tableTypes).toEqual([SIX_FOOT]);
  });

  it('replaces the table types and closes', async () => {
    const wrapper = await opened();
    cards()[0].click();
    await wrapper.vm.$nextTick();

    button('Replace Table Types').click();
    await wrapper.vm.$nextTick();

    expect(byTestId('floorplan-template-load-window')).toBeNull();
    expect(store.tableTypes).toEqual([EIGHT_FOOT, ROUND]);
    expect(wrapper.get('.feedback-toast').text()).toBe('Template “Standard layout” loaded.');
  });

  it('closes from the confirm view without replacing anything, and reopens on the list', async () => {
    const wrapper = await opened();
    cards()[0].click();
    await wrapper.vm.$nextTick();

    byTestId('floorplan-template-load-close-button')!.click();
    await wrapper.vm.$nextTick();
    expect(byTestId('floorplan-template-load-window')).toBeNull();
    expect(store.tableTypes).toEqual([SIX_FOOT]);

    await wrapper.get('button.tp-btn--load').trigger('click');
    await flushPromises();
    expect(loadWindow().getAttribute('aria-label')).toBe('Load Template');
  });
});
