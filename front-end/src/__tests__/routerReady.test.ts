// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';

import { routerSettled } from '@/utils/routerReady';

const Home = defineComponent({ render: () => h('div', 'home') });

function routerThatFailsItsFirstNavigation(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: Home }],
  });
  router.beforeEach(() => {
    throw new Error('the first navigation failed');
  });
  return router;
}

async function settlesPromptly(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  return done;
}

describe('waiting for the first navigation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers every caller once the first navigation has succeeded', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: Home }],
    });
    const mount = routerSettled(router);
    router.push('/');

    await expect(mount).resolves.toBeUndefined();
    await expect(routerSettled(router)).resolves.toBeUndefined();
  });

  it('answers every caller when the first navigation has failed', async () => {
    const router = routerThatFailsItsFirstNavigation();

    const mount = routerSettled(router);
    router.push('/').catch(() => {});
    await expect(mount).resolves.toBeUndefined();

    expect(await settlesPromptly(routerSettled(router))).toBe(true);
    expect(await settlesPromptly(router.isReady())).toBe(false);
  });
});
