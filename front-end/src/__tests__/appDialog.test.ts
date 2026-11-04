/**
 * `AppDialog` grown (T200): three widths, a body that scrolls with the title and actions pinned,
 * edge shades and a pinned tray, all opt-in, so a dialog that asks for none of them is today's.
 *
 * These drive the shell through a host the way a parent does: a page with a button that opens the
 * dialog, which closes on `close` and on `submit`. What the browser lays out (the widths, the
 * corners, a phone's height) is the library's E2E, `the-component-library-dialog.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref, type PropType } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import SearchPicker from '@/components/SearchPicker.vue';

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

type DialogProps = Record<string, unknown>;

/** A page with a button that opens the dialog; it closes on `close` and on `submit`. */
const Host = defineComponent({
  props: {
    dialog: { type: Object as PropType<DialogProps>, default: () => ({}) },
    tray: { type: Boolean, default: false },
  },
  setup(props, { expose }) {
    const open = ref(false);
    const closes = ref(0);
    const submits = ref(0);
    expose({ open, closes, submits });
    return () =>
      h('main', { 'data-testid': 'page' }, [
        h('button', { 'data-testid': 'opener', onClick: () => (open.value = true) }, 'Open'),
        h(
          AppDialog,
          {
            open: open.value,
            title: 'Choose people',
            testid: 'people',
            confirmLabel: 'Save',
            ...props.dialog,
            onClose: () => {
              closes.value++;
              open.value = false;
            },
            onSubmit: () => {
              submits.value++;
              open.value = false;
            },
          },
          {
            default: () => [
              h('input', { 'data-testid': 'people-find', class: 'field' }),
              h('p', { 'data-testid': 'people-long-row' }, 'A long row of people'),
            ],
            ...(props.tray
              ? { tray: () => h('p', { 'data-testid': 'people-cart' }, 'Chosen') }
              : {}),
          },
        ),
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

interface HostState {
  open: boolean;
  closes: number;
  submits: number;
}

/** Opens the dialog as a user does: focus on the opener, then a click on it. */
async function openFromTheButton(dialog: DialogProps = {}, tray = false) {
  wrapper = mount(Host, { attachTo: document.body, props: { dialog, tray } });
  const opener = byTestId('opener')!;
  opener.focus();
  opener.click();
  await flushPromises();
  return { opener, state: wrapper.vm as unknown as HostState };
}

/** The window's own markup, without Vue's comment anchors and its scoped-style attributes. */
function windowMarkup(): string {
  const root = byTestId('people-window')!.cloneNode(true) as HTMLElement;
  const comments: Node[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((comment) => comment.remove());
  [root, ...root.querySelectorAll('*')].forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^data-v-[0-9a-f]+$/.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  });
  return root.outerHTML;
}

describe('a dialog that asks for none of the new props is drawn as today', () => {
  it('a single form', async () => {
    await openFromTheButton({ error: 'That did not save.' });

    expect(windowMarkup()).toMatchInlineSnapshot(
      `"<div class="dialog-window" role="dialog" aria-modal="true" aria-label="Choose people" data-testid="people-window" tabindex="-1"><button type="button" class="dialog-close" aria-label="Close" data-dialog-close="" data-testid="people-close-button"> × </button><h2 class="dialog-title">Choose people</h2><form class="dialog-body"><input data-testid="people-find" class="field"><p data-testid="people-long-row">A long row of people</p><p class="dialog-error" data-testid="people-error">That did not save.</p><footer class="dialog-actions"><button type="button" class="btn btn--secondary" data-testid="people-cancel-button">Cancel</button><button type="submit" class="btn btn--primary" data-testid="people-submit-button">Save</button></footer></form></div>"`,
    );
  });

  it('several actions and no footer', async () => {
    await openFromTheButton({ confirmLabel: undefined });

    expect(windowMarkup()).toMatchInlineSnapshot(
      `"<div class="dialog-window" role="dialog" aria-modal="true" aria-label="Choose people" data-testid="people-window" tabindex="-1"><button type="button" class="dialog-close" aria-label="Close" data-dialog-close="" data-testid="people-close-button"> × </button><h2 class="dialog-title">Choose people</h2><div class="dialog-body"><input data-testid="people-find" class="field"><p data-testid="people-long-row">A long row of people</p></div></div>"`,
    );
  });

  it.each(['window', 'body'])(
    "several actions, scroll %s: an inner form's submit is its own, and the dialog emits none",
    async (scroll) => {
      wrapper = mount(AppDialog, {
        attachTo: document.body,
        props: { open: true, title: 'Manage market', testid: 'people', scroll },
        slots: {
          default: () =>
            h('form', { 'data-testid': 'people-rename' }, [
              h('button', { type: 'submit' }, 'Save'),
            ]),
        },
      });
      await flushPromises();

      const submit = new Event('submit', { bubbles: true, cancelable: true });
      byTestId('people-rename')!.dispatchEvent(submit);

      expect(wrapper.emitted('submit')).toBeUndefined();
      expect(submit.defaultPrevented).toBe(false);
    },
  );

  it('wide', async () => {
    await openFromTheButton({ wide: true });

    expect(byTestId('people-window')!.className).toBe('dialog-window dialog-window--wide');
  });
});

describe('its sizes', () => {
  it.each([
    ['narrow', 'dialog-window'],
    ['wide', 'dialog-window dialog-window--wide'],
    ['broad', 'dialog-window dialog-window--broad'],
  ])('%s', async (size, className) => {
    await openFromTheButton({ size });

    expect(byTestId('people-window')!.className).toBe(className);
  });

  it('a size wins over the `wide` it replaces', async () => {
    await openFromTheButton({ wide: true, size: 'broad' });

    expect(byTestId('people-window')!.className).toBe('dialog-window dialog-window--broad');
  });
});

describe('with `scroll="body"`', () => {
  const body = { scroll: 'body' };

  it('only the body scrolls: the title, close, error and actions are outside it', async () => {
    await openFromTheButton({ ...body, error: 'That did not save.' });

    const scroller = byTestId('people-body')!;
    expect(byTestId('people-window')!.classList).toContain('dialog-window--body');
    expect(scroller.contains(byTestId('people-find'))).toBe(true);
    expect(scroller.contains(byTestId('people-long-row'))).toBe(true);
    for (const pinned of ['close-button', 'error', 'cancel-button', 'submit-button']) {
      expect(byTestId(`people-${pinned}`), pinned).not.toBeNull();
      expect(scroller.contains(byTestId(`people-${pinned}`)), pinned).toBe(false);
    }
    expect(scroller.contains(document.querySelector('.dialog-title'))).toBe(false);
  });

  it('the body, the error and the actions are still one form', async () => {
    const { state } = await openFromTheButton(body);

    const form = byTestId('people-find')!.closest('form')!;
    expect(form.contains(byTestId('people-submit-button'))).toBe(true);
    expect(byTestId('people-submit-button')!.getAttribute('type')).toBe('submit');
    form.dispatchEvent(new Event('submit'));
    await flushPromises();

    expect(state.submits).toBe(1);
    expect(state.closes).toBe(0);
  });

  it('a disabled confirm makes Enter inert, as today', async () => {
    await openFromTheButton({ ...body, confirmDisabled: true });

    expect((byTestId('people-submit-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a dialog of several actions scrolls its body too', async () => {
    await openFromTheButton({ ...body, confirmLabel: undefined });

    expect(byTestId('people-body')!.contains(byTestId('people-find'))).toBe(true);
    expect(byTestId('people-cancel-button')).toBeNull();
  });

  it('opens on its first control and gives focus back on close', async () => {
    const { opener } = await openFromTheButton(body);

    expect(document.activeElement).toBe(byTestId('people-find'));
    byTestId('people-close-button')!.click();
    await flushPromises();

    expect(byTestId('people-window')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a destructive one opens on Cancel', async () => {
    await openFromTheButton({ ...body, destructive: true });

    expect(document.activeElement).toBe(byTestId('people-cancel-button'));
  });

  it.each([
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['the scrim', () => byTestId('people-background')!.click()],
    ['Cancel', () => byTestId('people-cancel-button')!.click()],
  ])('closes by %s, never as a save', async (_how, close) => {
    const { opener, state } = await openFromTheButton(body);

    close();
    await flushPromises();

    expect(state.closes).toBe(1);
    expect(state.submits).toBe(0);
    expect(document.activeElement).toBe(opener);
  });

  it('holds the page behind inert while open', async () => {
    await openFromTheButton(body);

    expect(byTestId('opener')!.closest('[inert]')).not.toBeNull();
    expect(byTestId('people-find')!.closest('[inert]')).toBeNull();
    byTestId('people-close-button')!.click();
    await flushPromises();

    expect(byTestId('opener')!.closest('[inert]')).toBeNull();
  });
});

/** Gives the body a size, as a browser lays it out, and scrolls it to `top`. */
function scrollBodyTo(top: number, { scrollHeight = 1000, clientHeight = 300 } = {}) {
  const scroller = byTestId('people-body')!;
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: clientHeight });
  scroller.scrollTop = top;
  scroller.dispatchEvent(new Event('scroll'));
}

describe('the edge shades', () => {
  const shades = () => ({
    top: byTestId('people-shade-top') !== null,
    bottom: byTestId('people-shade-bottom') !== null,
  });

  it('show only while there is more that way, as the body scrolls', async () => {
    await openFromTheButton({ scroll: 'body' });

    scrollBodyTo(0);
    await flushPromises();
    expect(shades()).toEqual({ top: false, bottom: true });

    scrollBodyTo(350);
    await flushPromises();
    expect(shades()).toEqual({ top: true, bottom: true });

    scrollBodyTo(700);
    await flushPromises();
    expect(shades()).toEqual({ top: true, bottom: false });

    scrollBodyTo(0);
    await flushPromises();
    expect(shades()).toEqual({ top: false, bottom: true });
  });

  it('a body that fits draws none', async () => {
    await openFromTheButton({ scroll: 'body' });

    scrollBodyTo(0, { scrollHeight: 300, clientHeight: 300 });
    await flushPromises();

    expect(shades()).toEqual({ top: false, bottom: false });
  });

  it('a window that scrolls whole draws none', async () => {
    await openFromTheButton();

    expect(byTestId('people-body')).toBeNull();
    expect(shades()).toEqual({ top: false, bottom: false });
  });
});

describe('the tray', () => {
  it('is pinned between the body and the actions', async () => {
    await openFromTheButton({ scroll: 'body', error: 'That did not save.' }, true);

    const tray = byTestId('people-tray')!;
    expect(tray.contains(byTestId('people-cart'))).toBe(true);
    expect(byTestId('people-body')!.contains(tray)).toBe(false);
    const order = [...byTestId('people-find')!.closest('form')!.children].map(
      (child) => child.getAttribute('data-testid') ?? child.className,
    );
    expect(order).toEqual(['dialog-scroll', 'people-tray', 'people-error', 'dialog-actions']);
  });

  it('is in a dialog of several actions too', async () => {
    await openFromTheButton({ scroll: 'body', confirmLabel: undefined }, true);

    expect(byTestId('people-tray')!.contains(byTestId('people-cart'))).toBe(true);
  });

  it('is not drawn when not given', async () => {
    await openFromTheButton({ scroll: 'body' });

    expect(byTestId('people-tray')).toBeNull();
  });
});

describe('a dialog that opens on a picker of several choices (T200)', () => {
  it("opens on the field, never on a chip's Remove, which one stray Enter would take", async () => {
    const options = ['Ana', 'Ben'].map((label) => ({ value: label, label }));
    const wrapper = mount(AppDialog, {
      props: { open: false, title: 'Choose reviewers', testid: 'reviewers', confirmLabel: 'Save' },
      slots: {
        default: () =>
          h(SearchPicker, {
            multiple: true,
            modelValue: ['Ana', 'Ben'],
            groups: [{ options }],
            finds: () => true,
            label: 'Reviewers',
            testid: 'reviewer-picker',
          }),
      },
      attachTo: document.body,
    });

    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('reviewer-picker-input'));
    wrapper.unmount();
  });
});
