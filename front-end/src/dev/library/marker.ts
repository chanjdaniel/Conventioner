/**
 * A string only the component library holds, rendered on its index (`LibraryIndexView.vue`).
 *
 * `scripts/no-dev-pages.ts` fails a production build in which any emitted file contains it, so a
 * slip that bundles the library (a static import of `src/dev/` from the app, or the router's
 * development block surviving the build) is caught before it ships.
 */
export const LIBRARY_MARKER = 'conventioner-component-library-is-dev-only';

/** Where the library lives, which a production build must not mention either. */
export const LIBRARY_PATH = '/dev/components';
