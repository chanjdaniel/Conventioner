/**
 * `AppDialog` grown (T200, T217): three widths, a body that scrolls with the title and actions
 * pinned, edge shades and a pinned tray, all opt-in; a dialog that asks for none of them scrolls
 * whole, inside a `ScrollBox`.
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
    actions: { type: Boolean, default: false },
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
            ...(props.actions
              ? { actions: () => h('button', { 'data-testid': 'people-reset' }, 'Reset') }
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
async function openFromTheButton(dialog: DialogProps = {}, tray = false, actions = false) {
  wrapper = mount(Host, { attachTo: document.body, props: { dialog, tray, actions } });
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
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));
  [root, ...root.querySelectorAll('*')].forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^data-v-[0-9a-f]+$/.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  });
  return root.outerHTML;
}

/*
 * These pin the markup of a dialog that asks for no `scroll`. It changed once, on purpose, in T217:
 * the window became a rounded frame that no longer scrolls, with a `ScrollBox` inside it over the
 * title and the body, so a bar can never square its corners and its close stays put. Everything
 * inside that box is as it was, but for the error line's `role="alert"` (T263), so it is announced.
 */
describe('a dialog that asks for none of the new props scrolls whole, in a ScrollBox', () => {
  it('a single form', async () => {
    await openFromTheButton({ error: 'That did not save.' });

    expect(windowMarkup()).toMatchInlineSnapshot(
      `"<div class="dialog-window" role="dialog" aria-modal="true" aria-label="Choose people" data-testid="people-window" tabindex="-1"><button type="button" class="dialog-close" aria-label="Close" data-dialog-close="" data-testid="people-close-button"> × </button><div class="scroll-box dialog-whole" data-scroll-box=""><div class="scroll-box__scroller scroll-box__scroller--y" data-testid="people-scroll"><div class="scroll-box__content"><div class="dialog-parts"><h2 class="dialog-title">Choose people</h2><form class="dialog-body"><input data-testid="people-find" class="field"><p data-testid="people-long-row">A long row of people</p><p class="dialog-error" role="alert" data-testid="people-error">That did not save.</p><footer class="dialog-actions"><button type="button" class="btn btn--secondary" data-testid="people-cancel-button">Cancel</button><button type="submit" class="btn btn--primary" data-testid="people-submit-button">Save</button></footer></form></div></div></div></div></div>"`,
    );
  });

  it('several actions and no footer', async () => {
    await openFromTheButton({ confirmLabel: undefined });

    expect(windowMarkup()).toMatchInlineSnapshot(
      `"<div class="dialog-window" role="dialog" aria-modal="true" aria-label="Choose people" data-testid="people-window" tabindex="-1"><button type="button" class="dialog-close" aria-label="Close" data-dialog-close="" data-testid="people-close-button"> × </button><div class="scroll-box dialog-whole" data-scroll-box=""><div class="scroll-box__scroller scroll-box__scroller--y" data-testid="people-scroll"><div class="scroll-box__content"><div class="dialog-parts"><h2 class="dialog-title">Choose people</h2><div class="dialog-body"><input data-testid="people-find" class="field"><p data-testid="people-long-row">A long row of people</p></div></div></div></div></div></div>"`,
    );
  });

  it.each(['window', 'body'] as const)(
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
});

describe('with `closeDisabled`', () => {
  it('nothing closes it, and Cancel and the close control are drawn disabled', async () => {
    const { state } = await openFromTheButton({ closeDisabled: true });
    expect(byTestId('people-close-button')?.hasAttribute('disabled')).toBe(true);
    expect(byTestId('people-cancel-button')?.hasAttribute('disabled')).toBe(true);

    byTestId('people-background')!.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    byTestId('people-close-button')!.click();
    byTestId('people-cancel-button')!.click();
    await flushPromises();
    expect(state.closes).toBe(0);
    expect(state.open).toBe(true);
  });

  it('every close works again once it ends', async () => {
    const { state } = await openFromTheButton({ closeDisabled: true });
    await wrapper!.setProps({ dialog: { closeDisabled: false } });
    expect(byTestId('people-close-button')?.hasAttribute('disabled')).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(state.closes).toBe(1);
  });

  /*
   * A save in flight disables the control that held the focus, so the browser drops it to
   * `<body>`, outside the dialog and behind nothing a Tab can reach; a refusal ends the hold with
   * the dialog still open.
   */
  it('a hold released with the focus on the body puts the focus inside the window', async () => {
    await openFromTheButton({ closeDisabled: true });
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    await wrapper!.setProps({ dialog: { closeDisabled: false } });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-find'));
  });

  it('a hold released with the focus already inside leaves it where it is', async () => {
    await openFromTheButton({ closeDisabled: true });
    byTestId('people-submit-button')!.focus();

    await wrapper!.setProps({ dialog: { closeDisabled: false } });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-submit-button'));
  });

  it('a hold released with the focus in another dialog, opened over it, leaves it there', async () => {
    await openFromTheButton({ closeDisabled: true });
    const over = document.createElement('div');
    over.setAttribute('role', 'dialog');
    over.innerHTML = '<button data-testid="over-button">Done</button>';
    document.body.append(over);
    byTestId('over-button')!.focus();

    await wrapper!.setProps({ dialog: { closeDisabled: false } });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('over-button'));
  });

  it('a hold released with the focus on the page behind puts the focus inside the window', async () => {
    await openFromTheButton({ closeDisabled: true });
    byTestId('opener')!.focus();

    await wrapper!.setProps({ dialog: { closeDisabled: false } });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-find'));
  });
});

/*
 * A dialog that disables its confirm while it saves, without holding its closes (Record payment,
 * T315): pressing the confirm drops the focus to `<body>`, and a refusal enables it again with the
 * dialog open and its error shown, so the shell answers that as it answers a hold's end.
 */
describe('with `confirmDisabled` ending', () => {
  it('the confirm enabled again with the focus on the body puts the focus inside the window', async () => {
    await openFromTheButton({ confirmDisabled: true });
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    await wrapper!.setProps({ dialog: { confirmDisabled: false, error: 'That did not save.' } });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-find'));
  });

  /*
   * The field is also the first safe control, so Cancel is the case that tells a focus left alone
   * from one moved there.
   */
  it.each(['people-find', 'people-cancel-button'])(
    'a confirm that toggles as a field is typed leaves the focus on %s',
    async (testid) => {
      await openFromTheButton({ confirmDisabled: true });
      const focused = byTestId(testid)!;
      focused.focus();

      await wrapper!.setProps({ dialog: { confirmDisabled: false } });
      await flushPromises();
      await wrapper!.setProps({ dialog: { confirmDisabled: true } });
      await flushPromises();
      await wrapper!.setProps({ dialog: { confirmDisabled: false } });
      await flushPromises();

      expect(document.activeElement).toBe(focused);
    },
  );

  it('the confirm enabled again with the focus in a dialog over it leaves it there', async () => {
    await openFromTheButton({ confirmDisabled: true });
    const over = document.createElement('div');
    over.setAttribute('role', 'dialog');
    over.innerHTML = '<button data-testid="over-button">Done</button>';
    document.body.append(over);
    byTestId('over-button')!.focus();

    await wrapper!.setProps({ dialog: { confirmDisabled: false } });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('over-button'));
  });
});

describe('its title', () => {
  it('is the `title` string, which also names the dialog', async () => {
    await openFromTheButton();
    expect(document.querySelector('.dialog-title')?.textContent).toBe('Choose people');
    expect(byTestId('people-window')?.getAttribute('aria-label')).toBe('Choose people');
  });

  it('draws an address in it so it breaks only before its "@" or a dot, the string naming the dialog', async () => {
    const words = 'Remove e2e-remove-hyphen-name@example.com from this organization?';
    await openFromTheButton({ title: words });
    const title = document.querySelector('.dialog-title')!;
    expect(title.textContent).toBe(words);
    expect([...title.querySelectorAll('.email-address')].map((half) => half.textContent)).toEqual([
      'e2e-remove-hyphen-name',
      '@example.com',
    ]);
    expect([...title.querySelectorAll('.email-address-break')].map((p) => p.textContent)).toEqual([
      '@example',
      '.com',
    ]);
    expect(
      [...title.querySelectorAll('.email-address-held')].map((run) => run.textContent),
    ).toEqual(['-r', '-h', '-n']);
    expect(byTestId('people-window')?.getAttribute('aria-label')).toBe(words);
  });
});

describe('its error line', () => {
  it('is announced, as an alert', async () => {
    await openFromTheButton({ error: 'That did not save.' });
    expect(byTestId('people-error')?.getAttribute('role')).toBe('alert');
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
function scrollBodyTo(
  top: number,
  { scrollHeight = 1000, clientHeight = 300 } = {},
  testid = 'people-body',
) {
  const scroller = byTestId(testid)!;
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

  it('a window that scrolls whole shades its edges too, with its close left where it was', async () => {
    await openFromTheButton();
    expect(byTestId('people-body')).toBeNull();
    expect(shades()).toEqual({ top: false, bottom: false });

    scrollBodyTo(350, {}, 'people-scroll');
    await flushPromises();

    expect(shades()).toEqual({ top: true, bottom: true });
    const scroller = byTestId('people-scroll')!;
    expect(scroller.contains(document.querySelector('.dialog-title'))).toBe(true);
    expect(scroller.contains(byTestId('people-find'))).toBe(true);
    expect(scroller.contains(byTestId('people-submit-button'))).toBe(true);
    expect(scroller.contains(byTestId('people-close-button'))).toBe(false);
  });
});

describe('the tray', () => {
  it('is pinned between the body and the actions', async () => {
    await openFromTheButton({ scroll: 'body', error: 'That did not save.' }, true);

    const tray = byTestId('people-tray')!;
    expect(tray.contains(byTestId('people-cart'))).toBe(true);
    expect(byTestId('people-body')!.contains(tray)).toBe(false);
    const form = byTestId('people-find')!.closest('form')!;
    const order = [...form.children].map((child) => {
      const part = child.matches('[data-scroll-box]') ? child.firstElementChild! : child;
      return part.getAttribute('data-testid') ?? part.className;
    });
    expect(order).toEqual(['people-body', 'people-tray', 'people-error', 'dialog-actions']);
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

describe('its footer', () => {
  it('with `confirmLabel` it is the Cancel and the submit, and the body is the form', async () => {
    await openFromTheButton();

    expect(byTestId('people-find')!.closest('form')).not.toBeNull();
    expect(byTestId('people-cancel-button')).not.toBeNull();
    expect(byTestId('people-submit-button')).not.toBeNull();
  });

  it('with `confirmLabel` and the slot, the slot takes its place in the one form', async () => {
    await openFromTheButton({}, false, true);

    expect(byTestId('people-reset')!.closest('form')).toBe(
      byTestId('people-find')!.closest('form'),
    );
    expect(byTestId('people-cancel-button')).toBeNull();
  });

  it.each(['window', 'body'] as const)(
    'with the slot alone, scroll %s, it draws and the body is no form',
    async (scroll) => {
      await openFromTheButton({ scroll, confirmLabel: undefined }, false, true);

      const reset = byTestId('people-reset')!;
      expect(reset.closest('footer')!.classList).toContain('dialog-actions');
      expect(reset.closest('form')).toBeNull();
      expect(byTestId('people-find')!.closest('form')).toBeNull();
      expect(byTestId('people-cancel-button')).toBeNull();
      expect(byTestId('people-submit-button')).toBeNull();
    },
  );

  it('with the slot alone it stays outside the body that scrolls', async () => {
    await openFromTheButton({ scroll: 'body', confirmLabel: undefined }, false, true);

    expect(byTestId('people-body')!.contains(byTestId('people-reset'))).toBe(false);
  });

  it("with the slot alone an inner form's submit is its own", async () => {
    wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Permissions', testid: 'people', scroll: 'body' },
      slots: {
        default: () => h('form', { 'data-testid': 'people-rename' }),
        actions: () => h('button', 'Reset'),
      },
    });
    await flushPromises();

    const submit = new Event('submit', { bubbles: true, cancelable: true });
    byTestId('people-rename')!.dispatchEvent(submit);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(submit.defaultPrevented).toBe(false);
  });

  it('with neither there is none', async () => {
    await openFromTheButton({ confirmLabel: undefined });

    expect(document.querySelector('.dialog-actions')).toBeNull();
  });
});

describe('a dialog with nothing to focus', () => {
  const TALLER_THAN_IT_SHOWS = { scrollHeight: 1000, clientHeight: 300 };

  const readOnly = (props: DialogProps) =>
    mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Who may do what', testid: 'people', ...props } as never,
      slots: { default: () => h('p', 'A row to read') },
    });

  /** Every scroller in the dialog has more to show than it can hold. */
  function overflowing() {
    for (const [name, value] of Object.entries(TALLER_THAN_IT_SHOWS)) {
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
    }
  }

  afterEach(() => {
    for (const name of Object.keys(TALLER_THAN_IT_SHOWS)) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });

  it('but a fold in the body is a control: it opens on the summary, where the keys reach', async () => {
    overflowing();
    wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Who may do what', testid: 'people', scroll: 'body' } as never,
      slots: { default: () => h('details', [h('summary', 'More'), h('p', 'A row to read')]) },
    });
    await flushPromises();

    expect(document.activeElement?.tagName).toBe('SUMMARY');
  });

  it('and a body with more to show opens on that body, where the keys scroll it', async () => {
    overflowing();
    wrapper = readOnly({ scroll: 'body' });
    await flushPromises();

    expect(byTestId('people-body')!.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(byTestId('people-body'));
  });

  it('opened from a page, the same', async () => {
    overflowing();
    wrapper = readOnly({ open: false, scroll: 'body' });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-body'));
  });

  it('scrolling whole, the same: it opens on what scrolls', async () => {
    overflowing();
    wrapper = readOnly({});
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-scroll'));
  });

  it('and a body that fits opens on its window, as before', async () => {
    wrapper = readOnly({ scroll: 'body' });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-window'));
    expect(byTestId('people-body')!.hasAttribute('tabindex')).toBe(false);
  });

  it('a control to open on still wins over a body with more to show', async () => {
    overflowing();
    await openFromTheButton({ scroll: 'body' });

    expect(document.activeElement).toBe(byTestId('people-find'));
    // A field keeps the arrow keys, so the body keeps its stop for them, one Shift+Tab away (T223).
    expect(byTestId('people-body')!.getAttribute('tabindex')).toBe('0');
  });

  it('so does a field in a dialog that scrolls whole, its scroller keeping the stop', async () => {
    overflowing();
    wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Who may do what', testid: 'people' },
      slots: {
        default: () => [
          h('input', { 'data-testid': 'people-find', class: 'field' }),
          h('p', 'A row to read'),
        ],
      },
    });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-find'));
    expect(byTestId('people-scroll')!.getAttribute('tabindex')).toBe('0');
  });

  it('a footer button wins too, and the body keeps its Tab stop for the keys', async () => {
    overflowing();
    wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Who may do what', testid: 'people', scroll: 'body' },
      slots: {
        default: () => h('p', 'A row to read'),
        actions: () => h('button', { 'data-testid': 'people-done' }, 'Done'),
      },
    });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-done'));
    expect(byTestId('people-body')!.getAttribute('tabindex')).toBe('0');
  });

  it('a body whose only controls may not be first opens on its window', async () => {
    overflowing();
    wrapper = mount(AppDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Who may do what', testid: 'people', scroll: 'body' },
      slots: { default: () => h('button', { 'data-dialog-not-first': '' }, 'Remove') },
    });
    await flushPromises();

    expect(document.activeElement).toBe(byTestId('people-window'));
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
