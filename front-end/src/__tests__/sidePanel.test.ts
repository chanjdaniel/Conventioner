/**
 * The side panel's shell (T200): a modal that slides in from a side, modal the way `AppDialog` is,
 * through the same composables. These drive it through a host, as a screen does: a button opens it,
 * and it closes on `close`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import SidePanel from '@/components/SidePanel.vue';

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const panel = () => byTestId('details-window')!;

const Host = defineComponent({
  props: {
    side: { type: String as () => 'right' | 'left', default: undefined },
    width: { type: String as () => 'narrow' | 'wide', default: undefined },
    mounted: { type: Boolean, default: true },
  },
  setup(props, { expose }) {
    const open = ref(false);
    const showOpener = ref(true);
    const asking = ref(false);
    expose({ open, showOpener, asking });
    return () =>
      h('main', [
        showOpener.value
          ? h('button', { 'data-testid': 'opener', onClick: () => (open.value = true) }, 'Open')
          : null,
        h('button', { 'data-testid': 'elsewhere' }, 'Elsewhere'),
        props.mounted
          ? h(
              SidePanel,
              {
                open: open.value,
                title: 'Ana Ceramics',
                testid: 'details',
                side: props.side,
                width: props.width,
                onClose: () => (open.value = false),
              },
              () => [
                h('p', { 'data-testid': 'details-text' }, 'What they sell'),
                h('button', { 'data-testid': 'ask', onClick: () => (asking.value = true) }, 'Ask'),
              ],
            )
          : null,
        h(AppDialog, {
          open: asking.value,
          title: 'Sure?',
          testid: 'asking',
          confirmLabel: 'Yes',
          onClose: () => (asking.value = false),
        }),
      ]);
  },
});

type HostProps = { side?: 'right' | 'left'; width?: 'narrow' | 'wide' };

let wrapper: VueWrapper<InstanceType<typeof Host>> | null = null;

function mountHost(props: HostProps = {}) {
  wrapper = mount(Host, { attachTo: document.body, props });
  return wrapper;
}

async function settle() {
  await flushPromises();
  await nextTick();
}

/** Opened as a person opens it: focus on the button, then a press. */
async function openIt() {
  byTestId('opener')!.focus();
  byTestId('opener')!.click();
  await settle();
}

const pressEscape = async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('SidePanel, what it draws', () => {
  it('draws nothing of its content while closed', async () => {
    mountHost();
    await settle();
    expect(byTestId('details-text')).toBeNull();
    expect(byTestId('details-close-button')).toBeNull();
    expect(panel().getAttribute('aria-hidden')).toBe('true');
  });

  it('is a named modal dialog, its title a heading, its content the slot', async () => {
    mountHost();
    await openIt();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Ana Ceramics');
    expect(panel().hasAttribute('aria-hidden')).toBe(false);
    expect(panel().querySelector('h2')?.textContent).toBe('Ana Ceramics');
    expect(byTestId('details-body')!.contains(byTestId('details-text'))).toBe(true);
  });

  it('keeps the title and the close button out of the body that scrolls', async () => {
    mountHost();
    await openIt();
    const body = byTestId('details-body')!;
    expect(body.contains(panel().querySelector('h2'))).toBe(false);
    expect(body.contains(byTestId('details-close-button'))).toBe(false);
  });

  it('names its close button', async () => {
    mountHost();
    await openIt();
    expect(byTestId('details-close-button')!.getAttribute('aria-label')).toBe('Close');
    expect(byTestId('details-close-button')!.getAttribute('type')).toBe('button');
  });

  it.each([
    [{}, 'side-panel__window--right', 'side-panel__window--narrow'],
    [{ side: 'left' }, 'side-panel__window--left', 'side-panel__window--narrow'],
    [{ width: 'wide' }, 'side-panel__window--right', 'side-panel__window--wide'],
    [{ side: 'left', width: 'wide' }, 'side-panel__window--left', 'side-panel__window--wide'],
  ] as [HostProps, string, string][])(
    'takes a side and a width: %j',
    async (props, side, width) => {
      mountHost(props);
      await openIt();
      expect(panel().classList).toContain(side);
      expect(panel().classList).toContain(width);
    },
  );
});

describe('SidePanel, how it closes', () => {
  it('closes by its close button', async () => {
    mountHost();
    await openIt();
    byTestId('details-close-button')!.click();
    await settle();
    expect(byTestId('details-text')).toBeNull();
  });

  it('closes by a press on the scrim', async () => {
    mountHost();
    await openIt();
    byTestId('details-background')!.click();
    await settle();
    expect(byTestId('details-text')).toBeNull();
  });

  it('stays open for a press inside it', async () => {
    mountHost();
    await openIt();
    byTestId('details-text')!.click();
    await settle();
    expect(byTestId('details-text')).not.toBeNull();
  });

  it('closes by Escape, and only while it is open', async () => {
    const shell = mount(SidePanel, {
      attachTo: document.body,
      props: { open: false, title: 'Ana Ceramics', testid: 'details' },
    });
    await pressEscape();
    expect(shell.emitted('close')).toBeUndefined();

    await shell.setProps({ open: true });
    await pressEscape();
    expect(shell.emitted('close')).toHaveLength(1);
    shell.unmount();
  });

  it('gives Escape to a dialog opened from it first', async () => {
    mountHost();
    await openIt();
    byTestId('ask')!.click();
    await settle();
    expect(byTestId('asking-window')).not.toBeNull();

    await pressEscape();
    expect(byTestId('asking-window')).toBeNull();
    expect(byTestId('details-text')).not.toBeNull();

    await pressEscape();
    expect(byTestId('details-text')).toBeNull();
  });
});

describe('SidePanel, focus', () => {
  it('moves focus in, to the body the keys scroll, when it opens', async () => {
    mountHost();
    await openIt();
    expect(document.activeElement).toBe(byTestId('details-body'));
    expect(byTestId('details-body')!.getAttribute('tabindex')).toBe('0');
  });

  it('moves focus in when it is mounted open', async () => {
    const opened = mount(SidePanel, {
      attachTo: document.body,
      props: { open: true, title: 'Ana Ceramics', testid: 'details' },
    });
    await settle();
    expect(document.activeElement).toBe(byTestId('details-body'));
    opened.unmount();
  });

  it.each([
    ['its close button', () => byTestId('details-close-button')!.click()],
    ['the scrim', () => byTestId('details-background')!.click()],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
  ])('gives focus back to what opened it, closed by %s', async (_how, close) => {
    mountHost();
    await openIt();
    close();
    await settle();
    expect(document.activeElement).toBe(byTestId('opener'));
  });

  it('leaves focus alone when what opened it has left the page', async () => {
    const host = mountHost();
    await openIt();
    (host.vm as unknown as { showOpener: boolean }).showOpener = false;
    await settle();
    byTestId('details-close-button')!.click();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('SidePanel, the page behind', () => {
  it('holds the page inert while open, and lets it go on closing', async () => {
    mountHost();
    await settle();
    expect(byTestId('elsewhere')!.hasAttribute('inert')).toBe(false);

    await openIt();
    expect(byTestId('elsewhere')!.hasAttribute('inert')).toBe(true);
    expect(byTestId('opener')!.hasAttribute('inert')).toBe(true);
    expect(panel().closest('[inert]')).toBeNull();

    await pressEscape();
    expect(byTestId('elsewhere')!.hasAttribute('inert')).toBe(false);
    expect(byTestId('opener')!.hasAttribute('inert')).toBe(false);
  });

  it('holds the page when it is mounted open', async () => {
    const page = document.body.appendChild(document.createElement('button'));
    const opened = mount(SidePanel, {
      attachTo: document.body,
      props: { open: true, title: 'Ana Ceramics', testid: 'details' },
    });
    await settle();
    expect(page.hasAttribute('inert')).toBe(true);
    opened.unmount();
    expect(page.hasAttribute('inert')).toBe(false);
    page.remove();
  });

  it('lets the page go when it is unmounted open', async () => {
    const host = mountHost();
    await openIt();
    await host.setProps({ mounted: false });
    await settle();
    expect(byTestId('elsewhere')!.hasAttribute('inert')).toBe(false);
  });

  it('keeps a dialog opened from it live, and is live again once it closes', async () => {
    mountHost();
    await openIt();
    byTestId('ask')!.click();
    await settle();
    expect(byTestId('asking-window')!.closest('[inert]')).toBeNull();
    expect(panel().closest('[inert]')).not.toBeNull();

    await pressEscape();
    expect(panel().closest('[inert]')).toBeNull();
    expect(byTestId('ask')!.closest('[inert]')).toBeNull();
  });
});
