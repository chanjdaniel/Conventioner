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
