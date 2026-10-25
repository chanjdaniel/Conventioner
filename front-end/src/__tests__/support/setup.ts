/**
 * Every unit test gets a fresh Pinia (E21/F02).
 *
 * The open market lives in one store, and the phase rail, the market screens and the review
 * highlights all reach for it - so any test that mounts one of them needs a Pinia, and no test may
 * see a market another test left behind.
 */
import { beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

beforeEach(() => {
  setActivePinia(createPinia());
});

// jsdom has no layout, so it does not implement scrolling and logs an error for each call. A screen
// that starts a new step at the top of the page (the form tab, E33/F01/S01) scrolls; nothing here
// can see where to. A test that runs in Node (`@vitest-environment node`) has no window at all.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
