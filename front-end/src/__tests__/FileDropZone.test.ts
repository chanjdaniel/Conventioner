// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

import FileDropZone from '@/components/FileDropZone.vue';

/**
 * The one way a screen takes a file (T205/F11): the import, the start from a Google Form and the
 * floorplan all drop onto this zone, so what it does is said once, here.
 */

const LABEL = 'Drop your CSV here, or choose a file';
const HINT = 'Any form tool or spreadsheet that exports CSV will do.';

function zoneOf(props: Record<string, unknown> = {}): VueWrapper {
  return mount(FileDropZone, {
    props: {
      accept: '.csv,text/csv',
      label: LABEL,
      hint: HINT,
      testid: 'zone',
      inputTestid: 'zone-input',
      ...props,
    },
    attachTo: document.body,
  });
}

function fileOf(name = 'responses.csv'): File {
  return new File(['Email Address\nada@example.test\n'], name, { type: 'text/csv' });
}

async function choose(wrapper: VueWrapper, file: File): Promise<HTMLInputElement> {
  const input = wrapper.get('[data-testid="zone-input"]');
  const element = input.element as HTMLInputElement;
  Object.defineProperty(element, 'files', { value: [file], configurable: true });
  // A real input holds the file's name as its value until it is cleared.
  Object.defineProperty(element, 'value', {
    value: 'C:\\fakepath\\responses.csv',
    writable: true,
    configurable: true,
  });
  await input.trigger('change');
  return element;
}

async function drag(wrapper: VueWrapper, type: string, files: File[] = []): Promise<void> {
  await wrapper.get('[data-testid="zone"]').trigger(type, { dataTransfer: { files } });
}

const over = (wrapper: VueWrapper) =>
  wrapper.get('[data-testid="zone"]').attributes('data-dragging') === 'true';

describe('the file drop zone', () => {
  it('emits a chosen file once, and clears the input so the same file is read again', async () => {
    const wrapper = zoneOf();
    const file = fileOf();
    const input = await choose(wrapper, file);
    expect(wrapper.emitted('file')).toEqual([[file]]);
    expect(input.value).toBe('');
  });

  it('emits a dropped file', async () => {
    const wrapper = zoneOf();
    const file = fileOf();
    await drag(wrapper, 'drop', [file]);
    expect(wrapper.emitted('file')).toEqual([[file]]);
  });

  it('emits nothing for a drop that carries no file', async () => {
    const wrapper = zoneOf();
    await drag(wrapper, 'drop');
    expect(wrapper.emitted('file')).toBeUndefined();
  });

  it('is marked while a file is over it, and unmarked when it leaves', async () => {
    const wrapper = zoneOf();
    expect(over(wrapper)).toBe(false);
    await drag(wrapper, 'dragenter');
    expect(over(wrapper)).toBe(true);
    await drag(wrapper, 'dragover');
    expect(over(wrapper)).toBe(true);
    await drag(wrapper, 'dragleave');
    expect(over(wrapper)).toBe(false);
  });

  it('is unmarked once the file is dropped', async () => {
    const wrapper = zoneOf();
    await drag(wrapper, 'dragenter');
    await drag(wrapper, 'drop', [fileOf()]);
    expect(over(wrapper)).toBe(false);
  });

  it('while busy, disables its input, says it is busy and ignores a drop', async () => {
    const wrapper = zoneOf({ busy: true });
    const input = wrapper.get('[data-testid="zone-input"]').element as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(wrapper.get('[data-testid="zone"]').attributes('aria-busy')).toBe('true');
    await drag(wrapper, 'dragenter');
    expect(over(wrapper)).toBe(false);
    await drag(wrapper, 'drop', [fileOf()]);
    expect(wrapper.emitted('file')).toBeUndefined();
  });

  it('takes the files its caller names', () => {
    const wrapper = zoneOf({ accept: 'image/png,application/pdf' });
    expect(wrapper.get('[data-testid="zone-input"]').attributes('accept')).toBe(
      'image/png,application/pdf',
    );
  });

  it('names its input by its words, and describes it by its hint', () => {
    const wrapper = zoneOf();
    const input = wrapper.get('[data-testid="zone-input"]').element;
    const named = document.getElementById(input.getAttribute('aria-labelledby') ?? '');
    const described = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(named?.textContent?.trim()).toBe(LABEL);
    expect(described?.textContent?.trim()).toBe(HINT);
    wrapper.unmount();
  });

  it('draws no hint, and describes nothing, when it is given none', () => {
    const wrapper = zoneOf({ hint: undefined });
    const input = wrapper.get('[data-testid="zone-input"]');
    expect(input.attributes('aria-describedby')).toBeUndefined();
    expect(wrapper.text()).toBe(LABEL);
    wrapper.unmount();
  });
});
