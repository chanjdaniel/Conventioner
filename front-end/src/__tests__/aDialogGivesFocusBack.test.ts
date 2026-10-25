/**
 * A dialog gives focus back to what opened it when it closes (T45).
 *
 * Closing unmounts the window, which dropped focus to `<body>`: a keyboard user who opened a dialog
 * from deep in a page started again from its top after every close. `AppDialog` now takes the
 * opener as it opens and focuses it again once the page behind is no longer inert, whichever way
 * the dialog closed. These drive the shell through a host the way a parent does: it opens the
 * dialog from a button and closes it on `close` or after `submit`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import AppDialog from '@/components/AppDialog.vue';

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** A page with a button that opens a dialog, which closes on `close` and on `submit`. */
const Host = defineComponent({
  props: { mounted: { type: Boolean, default: true } },
  setup(props, { expose }) {
    const open = ref(false);
    const showOpener = ref(true);
    expose({ open, showOpener });
    return () =>
      h('main', [
        showOpener.value
          ? h('button', { 'data-testid': 'opener', onClick: () => (open.value = true) }, 'Open')
          : null,
        h('button', { 'data-testid': 'elsewhere' }, 'Elsewhere'),
        props.mounted
          ? h(
              AppDialog,
              {
                open: open.value,
                title: 'Rename',
                testid: 'rename',
                confirmLabel: 'Save',
                onClose: () => (open.value = false),
                onSubmit: () => (open.value = false),
              },
              () => h('input', { 'data-testid': 'rename-input', class: 'field' }),
            )
          : null,
      ]);
  },
});

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

/** Opens the dialog as a user does: focus on the opener, then a click on it. */
async function openFromTheButton() {
  wrapper = mount(Host, { attachTo: document.body });
  const opener = byTestId('opener')!;
  opener.focus();
  opener.click();
  await flushPromises();
  expect(document.activeElement).toBe(byTestId('rename-input'));
  return opener;
}

describe('a dialog gives focus back to what opened it', () => {
  it.each([
    ['the close control', () => byTestId('rename-close-button')!.click()],
    ['Cancel', () => byTestId('rename-cancel-button')!.click()],
    ['the backdrop', () => byTestId('rename-background')!.click()],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    [
      'a submit that closes it',
      () => byTestId('rename-input')!.closest('form')!.dispatchEvent(new Event('submit')),
    ],
  ])('when it closes by %s', async (_how, close) => {
    const opener = await openFromTheButton();

    close();
    await flushPromises();

    expect(byTestId('rename-window')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('when it is unmounted while open', async () => {
    const opener = await openFromTheButton();

    await wrapper!.setProps({ mounted: false });
    await flushPromises();

    expect(byTestId('rename-window')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('not when the opener has left the page, and nothing throws', async () => {
    await openFromTheButton();
    (wrapper!.vm as unknown as { showOpener: boolean }).showOpener = false;
    await flushPromises();

    byTestId('rename-close-button')!.click();
    await flushPromises();

    expect(byTestId('rename-window')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('not over a place the parent put focus itself as it closed', async () => {
    await openFromTheButton();
    const elsewhere = byTestId('elsewhere')!;

    // As a parent does that focuses what the dialog made: in the same tick as the close.
    (wrapper!.vm as unknown as { open: boolean }).open = false;
    void nextTick(() => elsewhere.focus());
    await flushPromises();

    expect(document.activeElement).toBe(elsewhere);
  });
});
