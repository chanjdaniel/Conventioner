/**
 * An `IntersectionObserver` a test drives, since jsdom has none: `more` comes from a list's sentinel
 * scrolling into view, and nothing here can scroll.
 *
 * Install it before mounting, say what is in view with `showSentinels()`, and read `watched()` for
 * how many elements are observed now and `observed()` for how many times one has been asked for.
 */
import { flushPromises } from '@vue/test-utils';
import { afterEach, vi } from 'vitest';

type Fire = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

class FakeObserver {
  static all = new Set<FakeObserver>();
  static observes = 0;
  targets = new Set<Element>();

  constructor(readonly fire: Fire) {
    FakeObserver.all.add(this);
  }

  observe(target: Element) {
    FakeObserver.observes++;
    this.targets.add(target);
  }

  disconnect() {
    this.targets.clear();
  }
}

export function installIntersectionObserver() {
  FakeObserver.all.clear();
  FakeObserver.observes = 0;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  async function fire(isIntersecting: boolean) {
    for (const observer of FakeObserver.all) {
      const entries = [...observer.targets].map((target) => ({ isIntersecting, target }));
      if (entries.length) observer.fire(entries);
    }
    await flushPromises();
  }
  return {
    /** Says each observed sentinel is in view, as scrolling to the list's end does. */
    showSentinels: () => fire(true),
    /** Says each observed sentinel is out of view. */
    hideSentinels: () => fire(false),
    watched: () => [...FakeObserver.all].reduce((sum, o) => sum + o.targets.size, 0),
    observed: () => FakeObserver.observes,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});
