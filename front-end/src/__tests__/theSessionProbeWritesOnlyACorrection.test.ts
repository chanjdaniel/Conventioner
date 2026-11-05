// @vitest-environment happy-dom
/**
 * The shell's session probe writes the stored user only to correct it. A tab that may not yet have
 * heard another tab's sign-out cannot tell it is too late, so an answer that repeats what it reads
 * must write nothing, or it would put back the user that sign-out took away, and leave both tabs
 * naming an account that has gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import axios from 'axios';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '@/App.vue';

const SIGNED_IN = 'organizer@example.com';
const SOMEONE_ELSE = 'someone-else@example.com';

let writes: unknown[][];

/** Opens the shell on an organizer's page, the probe answering when `answered` resolves. */
async function openTheShell(answered: Promise<unknown>) {
  vi.spyOn(axios, 'get').mockReturnValue(answered as ReturnType<typeof axios.get>);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/markets', component: { template: '<div />' } }],
  });
  await router.push('/markets');
  mount(App, {
    global: {
      plugins: [router, createPinia()],
      stubs: { AppBar: true, RouterView: true },
    },
  });
  await flushPromises();
}

const answerAs = (email: string) => ({ status: 200, data: { email } });

beforeEach(() => {
  writes = [];
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === 'user') writes.push([value]);
    write.call(this, key, value);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the shell's session probe, answering", () => {
  it('writes nothing when it repeats the stored user', async () => {
    localStorage.setItem('user', JSON.stringify(SIGNED_IN));
    writes = [];

    await openTheShell(Promise.resolve(answerAs(SIGNED_IN)));

    expect(writes).toEqual([]);
    expect(localStorage.getItem('user')).toBe(JSON.stringify(SIGNED_IN));
  });

  it('stores the user when none is stored', async () => {
    await openTheShell(Promise.resolve(answerAs(SIGNED_IN)));

    expect(localStorage.getItem('user')).toBe(JSON.stringify(SIGNED_IN));
  });

  it('corrects a stored user the session is not', async () => {
    localStorage.setItem('user', JSON.stringify(SOMEONE_ELSE));

    await openTheShell(Promise.resolve(answerAs(SIGNED_IN)));

    expect(localStorage.getItem('user')).toBe(JSON.stringify(SIGNED_IN));
  });

  it('brings nothing back after a sign-out it can read', async () => {
    localStorage.setItem('user', JSON.stringify(SIGNED_IN));
    let answer!: (value: unknown) => void;
    await openTheShell(new Promise((resolve) => (answer = resolve)));

    localStorage.clear();
    answer(answerAs(SIGNED_IN));
    await flushPromises();

    expect(localStorage.getItem('user')).toBeNull();
  });
});
