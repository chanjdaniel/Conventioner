// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { useInertBehind } from '@/utils/useInertBehind';

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

function mountWith(isOpen: ReturnType<typeof ref<boolean>>, parts: () => (HTMLElement | null)[]) {
  return mount(
    defineComponent({
      setup() {
        useInertBehind(isOpen as never, parts);
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
