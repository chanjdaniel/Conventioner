import { ref, type InjectionKey, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { OFFLINE_MESSAGE } from '@/utils/api';

/**
 * A page that could not be opened (E38/F11/S01). A screen's code is fetched when it is first
 * opened, so with no connection, or once a deploy has replaced the files it was built into, the
 * navigation fails and the click did nothing. The shell says so instead, and Try again loads the
 * page afresh, which also fetches the files a deploy put in their place.
 */

export const PAGE_NOT_OPENED_MESSAGE = 'The page could not be opened. Try again to load it.';

export interface PageFailed {
  /** Where the navigation was going, which Try again opens. */
  to: string;
  message: string;
}

/** What `main.ts` provides the shell: `watchPageFailed`'s answer. */
export const PAGE_FAILED: InjectionKey<Ref<PageFailed | null>> = Symbol('pageFailed');

/**
 * The navigation that last failed, with what to say of it, or null once a page opens. Offline is
 * said in the words every other offline failure uses.
 */
export function watchPageFailed(router: Router): Ref<PageFailed | null> {
  const failed = ref<PageFailed | null>(null);
  router.onError((_err, to) => {
    const message = navigator.onLine === false ? OFFLINE_MESSAGE : PAGE_NOT_OPENED_MESSAGE;
    failed.value = { to: to.fullPath, message };
  });
  router.afterEach((_to, _from, failure) => {
    if (!failure) failed.value = null;
  });
  return failed;
}

/** Load `to` as a new page, the app's code with it. */
export function openAfresh(to: string): void {
  window.location.assign(to);
}
