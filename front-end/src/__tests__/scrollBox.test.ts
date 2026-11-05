/**
 * `ScrollBox`, the one in-app scroller (T217): its shades say there is more that way, and a Tab stop
 * stands in for the bar it hides when nothing inside it can take focus.
 *
 * These mount it as a screen does and give the scroller a size as a browser lays it out, since jsdom
 * lays out nothing: a scroll event and a resize are what a browser sends. What a browser draws (the
 * bar gone, a shade's ground, print) is `the-component-library-components.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import ScrollBox from '@/components/ScrollBox.vue';

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** Every `ResizeObserver` the box made, so a test can say the box or its content was resized. */
const observers: { callback: () => void; observed: Element[]; disconnected: boolean }[] = [];

class FakeResizeObserver {
  private readonly record: (typeof observers)[number];
  constructor(callback: () => void) {
    this.record = { callback, observed: [], disconnected: false };
    observers.push(this.record);
  }
  observe(element: Element) {
    this.record.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

async function resized() {
  observers.forEach((observer) => observer.callback());
  await flushPromises();
}

interface Layout {
  scrollHeight?: number;
  clientHeight?: number;
  scrollWidth?: number;
  clientWidth?: number;
}

/** The scroller's size, as a browser would lay it out. */
function layOut(scroller: HTMLElement, layout: Layout) {
  for (const [name, value] of Object.entries(layout)) {
    Object.defineProperty(scroller, name, { configurable: true, value });
  }
}

/** Scrolls it there and sends the event a browser sends. */
async function scrollTo(scroller: HTMLElement, position: { top?: number; left?: number }) {
  if (position.top !== undefined) scroller.scrollTop = position.top;
  if (position.left !== undefined) scroller.scrollLeft = position.left;
  scroller.dispatchEvent(new Event('scroll'));
  await flushPromises();
}

const EDGES = ['top', 'bottom', 'left', 'right'] as const;

/** The edges with a shade drawn. */
const shaded = (testid = 'box') =>
  EDGES.filter((edge) => byTestId(`${testid}-shade-${edge}`) !== null);

let wrapper: VueWrapper | null = null;

function mountBox(props: Record<string, unknown> = {}, content: () => unknown = () => 'Rows') {
  wrapper = mount(ScrollBox, {
    attachTo: document.body,
    props: { testid: 'box', ...props },
    slots: { default: content as () => string },
  });
  return byTestId((props.testid as string | undefined) ?? 'box')!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

const TALL = { scrollHeight: 1000, clientHeight: 300 };
const WIDE = { scrollWidth: 1000, clientWidth: 300 };

describe('its markup', () => {
  it('is a root that takes the class, a scroller with the test id, and the content', () => {
    wrapper = mount(ScrollBox, {
      attachTo: document.body,
      attrs: { class: 'a-screens-cap' },
      props: { testid: 'box' },
      slots: { default: () => h('p', { 'data-testid': 'row' }, 'A row') },
    });

    const root = wrapper.element as HTMLElement;
    expect(root.hasAttribute('data-scroll-box')).toBe(true);
    expect(root.classList).toContain('a-screens-cap');
    const scroller = byTestId('box')!;
    expect(scroller.parentElement).toBe(root);
    expect(scroller.classList).not.toContain('a-screens-cap');
    expect(scroller.contains(byTestId('row'))).toBe(true);
  });

  it('exposes the scroller, for the few screens that move it themselves', () => {
    const scroller = mountBox();

    expect((wrapper!.vm as unknown as { scroller: HTMLElement }).scroller).toBe(scroller);
  });

  it('a label names the scroller as a region while it scrolls; without one it is no landmark', async () => {
    const labelled = mountBox({ axis: 'x', label: 'The prices' });
    expect(labelled.hasAttribute('role'), 'it fits, so it is no landmark').toBe(false);
    expect(labelled.hasAttribute('aria-label')).toBe(false);

    layOut(labelled, { scrollWidth: 400, clientWidth: 100 });
    await resized();
    expect(labelled.getAttribute('role')).toBe('region');
    expect(labelled.getAttribute('aria-label')).toBe('The prices');

    layOut(labelled, { scrollWidth: 100, clientWidth: 100 });
    await resized();
    expect(labelled.hasAttribute('role'), 'it fits again').toBe(false);
    wrapper!.unmount();

    const stop = mountBox({ label: 'The panel', focusable: true });
    expect(stop.getAttribute('role'), 'a stop always says what it is').toBe('region');
    expect(stop.getAttribute('aria-label')).toBe('The panel');
    wrapper!.unmount();

    const bare = mountBox({ axis: 'x' });
    layOut(bare, { scrollWidth: 400, clientWidth: 100 });
    await resized();
    expect(bare.hasAttribute('role')).toBe(false);
    expect(bare.hasAttribute('aria-label')).toBe(false);
  });

  it('shades take a test id prefix of their own when a screen keeps older ids', async () => {
    const scroller = mountBox({ testid: 'people-body', shadeTestid: 'people' });
    layOut(scroller, TALL);
    await resized();

    expect(byTestId('people-shade-bottom')).not.toBeNull();
    expect(byTestId('people-body-shade-bottom')).toBeNull();
  });

  it('a shade says nothing to a screen reader', async () => {
    const scroller = mountBox();
    layOut(scroller, TALL);
    await resized();

    expect(byTestId('box-shade-bottom')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the shades, down', () => {
  it('come and go as it scrolls, each only while there is more that way', async () => {
    const scroller = mountBox();
    layOut(scroller, TALL);

    await scrollTo(scroller, { top: 0 });
    expect(shaded()).toEqual(['bottom']);

    await scrollTo(scroller, { top: 350 });
    expect(shaded()).toEqual(['top', 'bottom']);

    await scrollTo(scroller, { top: 700 });
    expect(shaded()).toEqual(['top']);

    await scrollTo(scroller, { top: 0 });
    expect(shaded()).toEqual(['bottom']);
  });

  it('come as the content grows and go as it shrinks, with no scroll', async () => {
    const scroller = mountBox();
    expect(shaded()).toEqual([]);

    layOut(scroller, TALL);
    await resized();
    expect(shaded()).toEqual(['bottom']);

    layOut(scroller, { scrollHeight: 300, clientHeight: 300 });
    await resized();
    expect(shaded()).toEqual([]);
  });

  it('keep a pixel of slack, since a zoomed browser stops a fraction short of the end', async () => {
    const scroller = mountBox();
    layOut(scroller, TALL);

    await scrollTo(scroller, { top: 699.5 });

    expect(shaded()).toEqual(['top']);
  });

  it('watch the scroller and its content, and let go when it leaves', () => {
    const scroller = mountBox();

    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed).toContain(scroller);
    expect(observers[0]!.observed).toContain(scroller.firstElementChild);

    wrapper!.unmount();
    wrapper = null;
    expect(observers[0]!.disconnected).toBe(true);
  });

  it('never sideways: a list that is also wide draws only its own axis', async () => {
    const scroller = mountBox({ axis: 'y' });
    layOut(scroller, { ...TALL, ...WIDE });

    await scrollTo(scroller, { top: 10, left: 10 });

    expect(shaded()).toEqual(['top', 'bottom']);
  });
});

describe('the shades, sideways', () => {
  it('come and go as it scrolls', async () => {
    const scroller = mountBox({ axis: 'x' });
    layOut(scroller, WIDE);

    await scrollTo(scroller, { left: 0 });
    expect(shaded()).toEqual(['right']);

    await scrollTo(scroller, { left: 350 });
    expect(shaded()).toEqual(['left', 'right']);

    await scrollTo(scroller, { left: 700 });
    expect(shaded()).toEqual(['left']);
  });

  it('never down: a strip that is also tall draws only its own axis', async () => {
    const scroller = mountBox({ axis: 'x' });
    layOut(scroller, { ...TALL, ...WIDE });

    await scrollTo(scroller, { top: 10, left: 10 });

    expect(shaded()).toEqual(['left', 'right']);
  });
});

describe('the shades, both ways', () => {
  it('each edge answers for itself', async () => {
    const scroller = mountBox({ axis: 'both' });
    layOut(scroller, { ...TALL, ...WIDE });

    await scrollTo(scroller, { top: 0, left: 0 });
    expect(shaded()).toEqual(['bottom', 'right']);

    await scrollTo(scroller, { top: 700, left: 350 });
    expect(shaded()).toEqual(['top', 'left', 'right']);
  });
});

describe('its tone', () => {
  it.each([
    [undefined, false],
    ['light', false],
    ['dark', true],
  ])('tone %s', (tone, dark) => {
    wrapper = mount(ScrollBox, {
      attachTo: document.body,
      props: { testid: 'box', tone } as never,
    });

    expect((wrapper.element as HTMLElement).classList.contains('scroll-box--dark')).toBe(dark);
  });
});

describe('the Tab stop', () => {
  const stop = (scroller: HTMLElement) => scroller.getAttribute('tabindex');

  it('is always there when a screen moves focus to the box, whatever it holds or overflows', async () => {
    const scroller = mountBox({ focusable: true }, () => h('button', 'Ask'));
    expect(stop(scroller)).toBe('0');

    layOut(scroller, TALL);
    await resized();
    expect(stop(scroller)).toBe('0');
  });

  it('is there while it overflows with nothing inside to take focus', async () => {
    const scroller = mountBox();
    expect(stop(scroller)).toBeNull();

    layOut(scroller, TALL);
    await resized();
    expect(stop(scroller)).toBe('0');

    layOut(scroller, { scrollHeight: 300, clientHeight: 300 });
    await resized();
    expect(stop(scroller)).toBeNull();
  });

  it('sideways too', async () => {
    const scroller = mountBox({ axis: 'x' });

    layOut(scroller, WIDE);
    await resized();

    expect(stop(scroller)).toBe('0');
  });

  it.each([
    ['a button', () => h('button', 'Save')],
    ['a link', () => h('a', { href: '#row' }, 'Row')],
    ['a field', () => h('input')],
    ['a select', () => h('select')],
    ['a text area', () => h('textarea')],
    ['a disclosure', () => h('details', [h('summary', 'More')])],
    ['a stop of its own', () => h('div', { tabindex: '0' }, 'Row')],
  ])('is not there when %s can take the keys', async (_what, content) => {
    const scroller = mountBox({}, content);

    layOut(scroller, TALL);
    await resized();

    expect(stop(scroller)).toBeNull();
  });

  it.each([
    ['a disabled button', () => h('button', { disabled: true }, 'Save')],
    ['a hidden input', () => h('input', { type: 'hidden' })],
    ['a link with no address', () => h('a', 'Row')],
    ['what only a script focuses', () => h('div', { tabindex: '-1' }, 'Row')],
  ])('is there when all that is inside is %s', async (_what, content) => {
    const scroller = mountBox({}, content);

    layOut(scroller, TALL);
    await resized();

    expect(stop(scroller)).toBe('0');
  });

  it('follows what is inside it, with no resize', async () => {
    const withButton = ref(true);
    const Host = defineComponent({
      setup: () => () =>
        h(
          ScrollBox,
          { testid: 'box' },
          { default: () => (withButton.value ? h('button', 'Save') : h('span', 'Saved')) },
        ),
    });
    wrapper = mount(Host, { attachTo: document.body });
    const scroller = byTestId('box')!;
    layOut(scroller, TALL);
    await resized();
    expect(stop(scroller)).toBeNull();

    withButton.value = false;
    await flushPromises();
    expect(stop(scroller)).toBe('0');

    withButton.value = true;
    await flushPromises();
    expect(stop(scroller)).toBeNull();
  });

  it('stays while it holds the focus, when a control arrives inside, and goes as the focus leaves', async () => {
    // A read-only dialog opens on this stop, and its changes arrive after it with a "Load more".
    const withButton = ref(false);
    const Host = defineComponent({
      setup: () => () =>
        h(
          ScrollBox,
          { testid: 'box' },
          { default: () => (withButton.value ? h('button', 'Load more') : h('span', 'Rows')) },
        ),
    });
    wrapper = mount(Host, { attachTo: document.body });
    const scroller = byTestId('box')!;
    layOut(scroller, TALL);
    await resized();
    scroller.focus();
    expect(document.activeElement).toBe(scroller);

    withButton.value = true;
    await flushPromises();
    expect(stop(scroller), 'still the stop that holds the focus').toBe('0');
    expect(document.activeElement).toBe(scroller);

    scroller.querySelector('button')!.focus();
    await flushPromises();
    expect(stop(scroller), 'a control has the keys now').toBeNull();
  });
});
