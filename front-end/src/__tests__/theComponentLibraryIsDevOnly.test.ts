import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitsAPhone } from '@/utils/fitsAPhone';
import { loadedRoute } from './support/loadedRoute';

/**
 * The component library (`src/dev/library/`) is a page of a development build only: its two
 * routes exist where `import.meta.env.DEV` is true, open with no sign-in, and lay out on a phone.
 * A production build has neither, so its addresses fall through to "page not found"; that the
 * build emits none of it is `theComponentLibraryNeverShips.test.ts`'s to prove.
 */

async function freshRouter() {
  vi.resetModules();
  return (await import('@/router')).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('in a development build', () => {
  it.each(['/dev/components', '/dev/components/primitives'])(
    '%s is a library page, public and fitting a phone',
    async (path) => {
      const route = loadedRoute(await freshRouter(), path);
      expect(route.name).toMatch(/^component-library/);
      expect(route.matched.every((record) => record.meta.public === true)).toBe(true);
      expect(fitsAPhone(route)).toBe(true);
    },
  );
});

describe('in a production build', () => {
  it.each(['/dev/components', '/dev/components/primitives'])('%s is no page', async (path) => {
    vi.stubEnv('DEV', false);
    expect((await freshRouter()).resolve(path).name).toBe('not-found');
  });
});
