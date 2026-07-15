import type { Router } from 'vue-router';
import { useApplicationStore } from '@/stores/application';

/**
 * Register the handler that fires when the applicant's session is rejected.
 *
 * On the 5d backend there is no applicant session token yet, so this handler
 * is a no-op. It exists as the hook point for when applicant auth (JWT or
 * similar) is added, at which point a 401 on an applicant API call will
 * clear the session and redirect to login.
 */
export function installApplicantSessionExpiry(router: Router): void {
  // No-op for 5d backend: no applicant session token exists yet.
  // When session-based applicant auth is added, register a 401 interceptor
  // handler here that calls useApplicationStore().clearSession() and
  // router.push to applicant-login.
  void router;
  void useApplicationStore;
}
