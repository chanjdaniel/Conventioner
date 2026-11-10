/**
 * A screen holding unsaved work asks before it is dropped (T271).
 *
 * Driven through a real router and a `RouterView`, as a screen meets it: the router's guards only
 * reach a component the routed view rendered. The question is the one `UnsavedWorkDialog`, mounted
 * beside the view as `App.vue` mounts it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { defineComponent, h, ref } from 'vue';

import UnsavedWorkDialog from '@/components/UnsavedWorkDialog.vue';
import { askToLeave, leaveQuestion, useUnsavedWork } from '@/utils/useUnsavedWork';

const SENTENCE = 'Your work is not saved. Leaving drops it.';

/** Whether the screen holds unsaved work, as the test sets it. */
const unsaved = ref(true);
let inApp: boolean | undefined;

const Work = defineComponent({
  setup() {
    useUnsavedWork({ unsaved: () => unsaved.value, sentence: SENTENCE, inApp });
    return () => h('div', { 'data-testid': 'work' });
  },
});
const Elsewhere = defineComponent({ render: () => h('div', { 'data-testid': 'elsewhere' }) });

let router: Router;
let wrapper: VueWrapper | null = null;

async function mountAt(at = '/work/a', options: { inApp?: boolean } = {}) {
  inApp = options.inApp;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/work/:id', component: Work },
      { path: '/elsewhere', component: Elsewhere },
      { path: '/login', name: 'login', component: Elsewhere },
    ],
  });
  await router.push(at);
  await router.isReady();
  const App = defineComponent({ render: () => [h(RouterView), h(UnsavedWorkDialog)] });
  wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
}

const find = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const asking = () => find('unsaved-work-window') !== null;
const where = () => router.currentRoute.value.fullPath;

/**
 * Start a move and let it reach its guard, which may then wait on the question. The move comes back
 * boxed: an async function handing back a promise would wait for it, and so for the answer.
 */
async function startMove(to: string): Promise<{ moved: Promise<unknown> }> {
  const moved = router.push(to);
  await flushPromises();
  return { moved };
}

/** Close the question as a person does, and let the move it held settle. */
async function answerBy(how: () => void, moved: Promise<unknown>) {
  how();
  await moved;
  await flushPromises();
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  unsaved.value = true;
  // A question a test left open would otherwise be answered by the next one's.
  leaveQuestion.value?.answer(false);
});

describe('a move in the app with unsaved work', () => {
  it('asks before a move to another route, with the screen’s sentence', async () => {
    await mountAt();
    const { moved } = await startMove('/elsewhere');

    expect(asking()).toBe(true);
    expect(find('unsaved-work-window')!.getAttribute('aria-label')).toBe('Leave without saving?');
    expect(find('unsaved-work-sentence')!.textContent?.trim()).toBe(SENTENCE);
    expect(find('unsaved-work-submit-button')!.textContent?.trim()).toBe('Leave');
    expect(find('unsaved-work-cancel-button')!.textContent?.trim()).toBe('Stay');
    // Leave drops the work, so it is drawn destructive and the question opens on Stay.
    expect(find('unsaved-work-submit-button')!.classList.contains('btn--destructive')).toBe(true);
    expect(document.activeElement).toBe(find('unsaved-work-cancel-button'));
    expect(where()).toBe('/work/a');

    await answerBy(() => find('unsaved-work-cancel-button')!.click(), moved);
  });

  it('asks before a move to another path of the same route', async () => {
    await mountAt();
    const { moved } = await startMove('/work/b');
    expect(asking()).toBe(true);
    await answerBy(() => find('unsaved-work-cancel-button')!.click(), moved);
    expect(where()).toBe('/work/a');
  });

  it('stays, with the work, on Stay', async () => {
    await mountAt();
    const { moved } = await startMove('/elsewhere');
    await answerBy(() => find('unsaved-work-cancel-button')!.click(), moved);

    expect(asking()).toBe(false);
    expect(where()).toBe('/work/a');
    expect(find('work')).not.toBeNull();
  });

  it.each([
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['the close control', () => find('unsaved-work-close-button')!.click()],
    ['the scrim', () => find('unsaved-work-background')!.click()],
  ])('stays on %s', async (_how, close) => {
    await mountAt();
    const { moved } = await startMove('/elsewhere');
    await answerBy(close, moved);

    expect(asking()).toBe(false);
    expect(where()).toBe('/work/a');
  });

  it('goes where it was asked on Leave', async () => {
    await mountAt();
    const { moved } = await startMove('/elsewhere');
    await answerBy(() => find('unsaved-work-submit-button')!.click(), moved);

    expect(asking()).toBe(false);
    expect(where()).toBe('/elsewhere');
  });

  it('never asks on a move that changes only the query or the hash', async () => {
    await mountAt();
    await router.replace('/work/a?step=questions');
    await router.push('/work/a?step=questions#preview');
    await flushPromises();

    expect(asking()).toBe(false);
    expect(where()).toBe('/work/a?step=questions#preview');
  });

  it('never asks on a move to the sign-in page', async () => {
    await mountAt();
    await router.push('/login');
    await flushPromises();

    expect(asking()).toBe(false);
    expect(where()).toBe('/login');
  });

  it('never asks while nothing is unsaved', async () => {
    unsaved.value = false;
    await mountAt();
    await router.push('/work/b');
    await router.push('/elsewhere');
    await flushPromises();

    expect(asking()).toBe(false);
    expect(where()).toBe('/elsewhere');
  });

  it('never asks in the app when the screen asks only on unload', async () => {
    await mountAt('/work/a', { inApp: false });
    await router.push('/elsewhere');
    await flushPromises();

    expect(asking()).toBe(false);
    expect(where()).toBe('/elsewhere');
  });
});

describe('a reload or a close of the tab', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    return event;
  };

  it('is asked by the browser only while the work is unsaved', async () => {
    await mountAt();
    expect(unload().defaultPrevented).toBe(true);

    unsaved.value = false;
    expect(unload().defaultPrevented).toBe(false);
  });

  it('is asked on unload by a screen that asks only on unload', async () => {
    await mountAt('/work/a', { inApp: false });
    expect(unload().defaultPrevented).toBe(true);
  });

  it('is never asked once the screen is gone', async () => {
    await mountAt('/work/a', { inApp: false });
    await router.push('/elsewhere');
    await flushPromises();

    expect(unload().defaultPrevented).toBe(false);
  });
});

describe('one question at a time', () => {
  it('answers an open question "stay" when another is asked, and shows the new one', async () => {
    await mountAt();
    const first = askToLeave('The first.');
    const second = askToLeave('The second.');
    await flushPromises();

    await expect(first).resolves.toBe(false);
    expect(find('unsaved-work-sentence')!.textContent?.trim()).toBe('The second.');

    find('unsaved-work-submit-button')!.click();
    await expect(second).resolves.toBe(true);
    await flushPromises();
    expect(asking()).toBe(false);
  });
});
