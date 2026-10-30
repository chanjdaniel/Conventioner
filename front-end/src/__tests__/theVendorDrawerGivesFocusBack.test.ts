/**
 * The vendor drawer takes focus as it opens and gives it back as it closes, as a dialog does
 * (T45, T123).
 *
 * It is modal: the row or name that opened it goes inert behind it, and closing unmounts its
 * controls. It once moved no focus in, and gave none back, so after every vendor a keyboard user
 * started again from the top of the page. These drive the real drawer through a host the way a
 * screen does: a button opens it on a vendor, and the host closes it on `close`, as the address
 * losing `?vendor=` does.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import VendorDrawer from '@/components/VendorDrawer.vue';
import { useVendorDetails } from '@/utils/vendorDetails';

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** A screen with a button that opens the drawer on a vendor, and closes it on `close`. */
const Host = defineComponent({
  props: { mounted: { type: Boolean, default: true } },
  setup(props, { expose }) {
    const email = ref<string | null>(null);
    const showOpener = ref(true);
    // No market id, so the drawer reads nothing from the server: these are about focus alone.
    const details = useVendorDetails(ref(''), ref(null));
    expose({ email, showOpener });
    return () =>
      h('main', [
        showOpener.value
          ? h(
              'button',
              { 'data-testid': 'opener', onClick: () => (email.value = 'nadia@ember.test') },
              'Nadia',
            )
          : null,
        h('button', { 'data-testid': 'elsewhere' }, 'Elsewhere'),
        props.mounted
          ? h(VendorDrawer, {
              market: null,
              details,
              email: email.value,
              tab: 'application',
              onClose: () => (email.value = null),
            })
          : null,
      ]);
  },
});

type HostVm = { email: string | null; showOpener: boolean };

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

/** Opens the drawer as a user does: focus on the opener, then a click on it. */
async function openFromTheButton() {
  const router = createRouter({ history: createMemoryHistory(), routes: [] });
  wrapper = mount(Host, { attachTo: document.body, global: { plugins: [router] } });
  const opener = byTestId('opener')!;
  opener.focus();
  opener.click();
  await flushPromises();
  // Focus is in the drawer, so giving it back is the drawer's doing: jsdom leaves focus on an
  // element that turns inert, where a browser drops it to `<body>`.
  expect(document.activeElement).toBe(byTestId('vendors-detail-close'));
  return opener;
}

describe('the vendor drawer opens on its close and gives focus back', () => {
  it.each([
    ['its close', () => byTestId('vendors-detail-close')!.click()],
    ['the scrim', () => byTestId('vendors-detail-overlay')!.click()],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    [
      'the screen, as the address losing `?vendor=` does',
      () => ((wrapper!.vm as unknown as HostVm).email = null),
    ],
  ])('gives focus back to its opener when it closes by %s', async (_how, close) => {
    const opener = await openFromTheButton();

    close();
    await flushPromises();

    expect(byTestId('vendors-detail-close')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('gives focus back when it is unmounted while open', async () => {
    const opener = await openFromTheButton();

    await wrapper!.setProps({ mounted: false });
    await flushPromises();

    expect(document.activeElement).toBe(opener);
  });

  it('leaves focus where it is when another vendor is shown in the open drawer', async () => {
    await openFromTheButton();
    const tab = byTestId('vendor-drawer-tab-application')!;
    tab.focus();

    (wrapper!.vm as unknown as HostVm).email = 'omar@ember.test';
    await flushPromises();

    expect(document.activeElement).toBe(tab);
  });

  it('not when the opener has left the page, and nothing throws', async () => {
    await openFromTheButton();
    (wrapper!.vm as unknown as HostVm).showOpener = false;
    await flushPromises();

    byTestId('vendors-detail-close')!.click();
    await flushPromises();

    expect(document.activeElement).toBe(document.body);
  });
});
