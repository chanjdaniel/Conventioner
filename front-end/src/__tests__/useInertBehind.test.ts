// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h, ref, nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useInertBehind } from '@/utils/useInertBehind';
import { useModalRoot } from '@/utils/useModalRoot';
import ChoosePathOverlay from '@/components/floorplan/ChoosePathOverlay.vue';

/**
 * The page shape this exists for: the app's own header sits in a different branch from the view's
 * content, and the modal's two parts are siblings of that content.
 *
 *   body
 *     div.app
 *       header            <- a different branch, and the one a first attempt missed
 *       div.view
 *         div.content     <- the page behind the modal
 *         div.scrim       <- part of the modal
 *         aside.panel     <- part of the modal
 */
function buildPage() {
  document.body.innerHTML = `
    <div class="app">
      <header><button id="nav">Menu</button></header>
      <div class="view">
        <div class="content"><button id="publish">Publish Market</button></div>
        <div class="scrim"></div>
        <aside class="panel"><button id="close">Close</button></aside>
      </div>
    </div>
  `;
  return {
    header: document.querySelector('header') as HTMLElement,
    content: document.querySelector('.content') as HTMLElement,
    scrim: document.querySelector('.scrim') as HTMLElement,
    panel: document.querySelector('.panel') as HTMLElement,
  };
}

function mountWith(isOpen: Ref<boolean>, parts: () => (HTMLElement | null)[]) {
  return mount(
    defineComponent({
      setup() {
        useInertBehind(isOpen, parts);
        return () => h('div');
      },
    }),
  );
}

describe('useInertBehind', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves the page alone while the modal is closed', async () => {
    const page = buildPage();
    const open = ref(false);
    mountWith(open, () => [page.scrim, page.panel]);
    await nextTick();

    expect(page.content.hasAttribute('inert')).toBe(false);
    expect(page.header.hasAttribute('inert')).toBe(false);
  });

  it('marks the page content inert while it is open', async () => {
    const page = buildPage();
    const open = ref(false);
    mountWith(open, () => [page.scrim, page.panel]);

    open.value = true;
    await nextTick();

    expect(page.content.hasAttribute('inert')).toBe(true);
  });

  /** The first attempt marked one container and let the third Tab reach the header's nav button. */
  it('reaches a branch of the page the modal is not inside', async () => {
    const page = buildPage();
    const open = ref(false);
    mountWith(open, () => [page.scrim, page.panel]);

    open.value = true;
    await nextTick();

    expect(page.header.hasAttribute('inert')).toBe(true);
  });

  it('never marks the modal itself, so the scrim still takes its click', async () => {
    const page = buildPage();
    const open = ref(false);
    mountWith(open, () => [page.scrim, page.panel]);

    open.value = true;
    await nextTick();

    expect(page.scrim.hasAttribute('inert')).toBe(false);
    expect(page.panel.hasAttribute('inert')).toBe(false);
  });

  it('gives the page back when the modal closes', async () => {
    const page = buildPage();
    const open = ref(false);
    mountWith(open, () => [page.scrim, page.panel]);

    open.value = true;
    await nextTick();
    open.value = false;
    await nextTick();

    expect(page.content.hasAttribute('inert')).toBe(false);
    expect(page.header.hasAttribute('inert')).toBe(false);
  });

  it('gives it back when the view unmounts while still open', async () => {
    const page = buildPage();
    const open = ref(false);
    const wrapper = mountWith(open, () => [page.scrim, page.panel]);

    open.value = true;
    await nextTick();
    wrapper.unmount();

    expect(page.content.hasAttribute('inert')).toBe(false);
    expect(page.header.hasAttribute('inert')).toBe(false);
  });

  /** A view can mount with its modal already open - a deep link, or a restored route. */
  it('marks the page when it mounts with the modal already open', async () => {
    const page = buildPage();
    const open = ref(true);
    mountWith(open, () => [page.scrim, page.panel]);
    await nextTick();

    expect(page.content.hasAttribute('inert')).toBe(true);
    expect(page.header.hasAttribute('inert')).toBe(true);
  });

  /**
   * The shape every real modal has: its root is a template ref, which binds only once the
   * component has mounted. A `v-if` dialog with `:open="true"` (the change-placement dialog, the
   * floorplan's choose-a-path overlay) is open from setup, so the first walk ran before the ref
   * existed, found no parts, and nothing came to run it again (T181).
   */
  describe('a modal mounted already open, its root bound by template ref', () => {
    function mountOpenModal(isOpen: Ref<boolean>) {
      document.body.innerHTML = `
        <header><button id="nav">Menu</button></header>
        <main><button id="publish">Publish Market</button></main>
        <div id="host"></div>
      `;
      const wrapper = mount(
        defineComponent({
          setup() {
            const root = useModalRoot(isOpen);
            return () => h('div', { ref: root, class: 'modal' }, [h('button', 'Close')]);
          },
        }),
        { attachTo: '#host' },
      );
      return {
        wrapper,
        header: document.querySelector('header') as HTMLElement,
        main: document.querySelector('main') as HTMLElement,
        modal: () => document.querySelector('.modal') as HTMLElement,
      };
    }

    it('marks the page once it has mounted', async () => {
      const page = mountOpenModal(ref(true));
      await nextTick();

      expect(page.main.hasAttribute('inert')).toBe(true);
      expect(page.header.hasAttribute('inert')).toBe(true);
      expect(page.modal().hasAttribute('inert')).toBe(false);
    });

    it('gives the page back when it closes', async () => {
      const open = ref(true);
      const page = mountOpenModal(open);
      await nextTick();

      open.value = false;
      await nextTick();

      expect(page.main.hasAttribute('inert')).toBe(false);
      expect(page.header.hasAttribute('inert')).toBe(false);
    });

    it('gives the page back when it unmounts while still open', async () => {
      const page = mountOpenModal(ref(true));
      await nextTick();

      page.wrapper.unmount();

      expect(page.main.hasAttribute('inert')).toBe(false);
      expect(page.header.hasAttribute('inert')).toBe(false);
    });

    it('holds the page again when it reopens', async () => {
      const open = ref(true);
      const page = mountOpenModal(open);
      await nextTick();
      open.value = false;
      await nextTick();

      open.value = true;
      await nextTick();

      expect(page.main.hasAttribute('inert')).toBe(true);
      page.wrapper.unmount();
      expect(page.main.hasAttribute('inert')).toBe(false);
    });

    /** The floorplan beta's choose-a-path overlay mounts with `v-if` and `:open="true"` too. */
    it("holds the page behind the floorplan's choose-a-path overlay", async () => {
      document.body.innerHTML = `
        <header><button id="nav">Menu</button></header>
        <main><button id="rail">Open Applications</button></main>
        <div id="host"></div>
      `;
      const wrapper = mount(ChoosePathOverlay, { attachTo: '#host' });
      await nextTick();

      const header = document.querySelector('header') as HTMLElement;
      const main = document.querySelector('main') as HTMLElement;
      expect(main.hasAttribute('inert')).toBe(true);
      expect(header.hasAttribute('inert')).toBe(true);
      expect(wrapper.find('[data-testid="choose-path-window"]').exists()).toBe(true);
      expect(wrapper.element.closest('[inert]')).toBeNull();

      wrapper.unmount();
      expect(main.hasAttribute('inert')).toBe(false);
      expect(header.hasAttribute('inert')).toBe(false);
    });
  });

  /**
   * Two modals can be open at once, and their marked sets overlap. With a per-instance flag the
   * first to close hands the page back while the second still needs it held.
   */
  it('keeps the page inert until the last modal using it has closed', async () => {
    const page = buildPage();
    const outer = ref(false);
    const inner = ref(false);
    mountWith(outer, () => [page.scrim, page.panel]);
    mountWith(inner, () => [page.scrim, page.panel]);

    outer.value = true;
    inner.value = true;
    await nextTick();
    expect(page.content.hasAttribute('inert')).toBe(true);

    inner.value = false;
    await nextTick();
    expect(page.content.hasAttribute('inert')).toBe(true);

    outer.value = false;
    await nextTick();
    expect(page.content.hasAttribute('inert')).toBe(false);
  });

  /**
   * A dialog opened from a dialog is a sibling of the one beneath it, which marked it; the one on
   * top takes `inert` off its own branch. The modal beneath walks again whenever one of its parts
   * changes while it is open (T181), and that walk must not put `inert` back on the dialog above.
   */
  it('keeps a dialog opened on top live when the modal beneath walks again', async () => {
    document.body.innerHTML = `
      <div class="view">
        <div class="content"><button>Publish Market</button></div>
        <div class="beneath"><section class="first"></section><section class="second"></section></div>
        <div class="on-top"><button>Confirm</button></div>
      </div>
    `;
    const content = document.querySelector('.content') as HTMLElement;
    const onTop = document.querySelector('.on-top') as HTMLElement;
    const beneathPart = ref(document.querySelector('.first') as HTMLElement);
    const beneathOpen = ref(true);
    const onTopOpen = ref(false);
    mountWith(beneathOpen, () => [beneathPart.value]);
    mountWith(onTopOpen, () => [onTop]);
    await nextTick();
    expect(onTop.hasAttribute('inert')).toBe(true);

    onTopOpen.value = true;
    await nextTick();
    expect(onTop.hasAttribute('inert')).toBe(false);

    beneathPart.value = document.querySelector('.second') as HTMLElement;
    await nextTick();
    expect(onTop.hasAttribute('inert')).toBe(false);
    expect(content.hasAttribute('inert')).toBe(true);

    onTopOpen.value = false;
    await nextTick();
    expect(onTop.hasAttribute('inert')).toBe(true);

    beneathOpen.value = false;
    await nextTick();
    expect(onTop.hasAttribute('inert')).toBe(false);
    expect(content.hasAttribute('inert')).toBe(false);
  });

  /**
   * A caller reading a component's `$el` gets `any` from Vue, and a fragment root yields a comment
   * node. Letting one through would put it on the spine and leave the real panel a sibling of it -
   * marked out of play by its own modal.
   */
  it('ignores a part that is not an element, rather than marking the modal itself', async () => {
    const page = buildPage();
    const notAnElement = document.createComment('a fragment root') as unknown as HTMLElement;
    const open = ref(false);
    mountWith(open, () => [notAnElement, page.panel]);

    open.value = true;
    await nextTick();

    expect(page.panel.hasAttribute('inert')).toBe(false);
    expect(page.content.hasAttribute('inert')).toBe(true);
  });

  /**
   * Something else may have marked an element inert for its own reasons. Releasing only what this
   * marked keeps the two from fighting over the attribute.
   */
  it('leaves an element that was already inert exactly as it found it', async () => {
    const page = buildPage();
    page.content.setAttribute('inert', '');
    const open = ref(false);
    mountWith(open, () => [page.scrim, page.panel]);

    open.value = true;
    await nextTick();
    open.value = false;
    await nextTick();

    expect(page.content.hasAttribute('inert')).toBe(true);
  });
});
