import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  requestLoginCode,
  verifyLoginCode,
  verifyErrorFrom,
  requestErrorFrom,
  fetchApplicantApplication,
  saveApplicantApplication,
} from '@/utils/applicantApi';
import type { Application } from '@/assets/types/datatypes';

/** What reading the vendor's own application found. */
export interface ApplicationRead {
  application: Application | null;
  failed: boolean;
}

/**
 * Where a vendor's sign-in is kept: this tab's sessionStorage (decided 2026-10-02, bug 36).
 *
 * It lived only in memory, so a reload - of a long form, half filled - signed the vendor out, and
 * the next code was a minute's wait away. The tab is the right lifetime: it survives a reload and
 * moving between Your Application and the form, a new tab asks to sign in again, and closing the
 * tab ends it. The token itself still expires after 30 minutes on the server.
 *
 * Every read and write is guarded: storage can be unavailable (a private window, blocked site
 * data), and then the sign-in simply lasts as long as the page, as it always did.
 */
const SESSION_KEY = 'conventioner.applicantSession';

interface StoredSession {
  marketId: string;
  marketSlug: string;
  applicantEmail: string;
  token: string;
}

function storedSession(): StoredSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const session = parsed as Partial<StoredSession>;
    if (!session.marketId || !session.marketSlug || !session.applicantEmail || !session.token) {
      return null;
    }
    return session as StoredSession;
  } catch {
    return null;
  }
}

function keepSession(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Unavailable storage: the sign-in lasts as long as the page.
  }
}

export const useApplicationStore = defineStore('application', () => {
  const kept = storedSession();
  const marketId = ref<string | null>(kept?.marketId ?? null);
  const marketSlug = ref<string | null>(kept?.marketSlug ?? null);
  const applicantEmail = ref<string | null>(kept?.applicantEmail ?? null);
  const token = ref<string | null>(kept?.token ?? null);
  const application = ref<Application | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function isAuthenticatedFor(slug: string): boolean {
    return token.value !== null && marketSlug.value === slug;
  }

  async function requestCode(slug: string, email: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await requestLoginCode(slug, email);
    } catch (err: unknown) {
      error.value = requestErrorFrom(err);
    } finally {
      loading.value = false;
    }
  }

  async function verifyCode(slug: string, email: string, code: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const result = await verifyLoginCode(slug, email, code);
      // Every successful sign-in carries a token now, applied or not (E26/F07/S01). Without one
      // this reported success and the page went back to "Sign In" with no word (bug 6), so a
      // reply without one is a failure, said as one.
      if (!result.token) {
        error.value = 'Sign-in did not complete. Please request a new code and try again.';
        return false;
      }
      marketId.value = result.marketId;
      marketSlug.value = slug;
      applicantEmail.value = result.applicantEmail;
      token.value = result.token;
      keepSession({
        marketId: result.marketId,
        marketSlug: slug,
        applicantEmail: result.applicantEmail,
        token: result.token,
      });
      return true;
    } catch (err: unknown) {
      error.value = verifyErrorFrom(err);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * The vendor's own application: theirs, none yet, or `failed` when the read got no answer.
   *
   * A failed read is never reported as "none". It was, and on a slow connection Your Application
   * told a vendor who had applied that they had not, and the apply page opened empty over answers
   * a save would then replace.
   */
  async function fetchApplication(): Promise<ApplicationRead> {
    if (!token.value || !marketSlug.value) return { application: null, failed: false };
    loading.value = true;
    error.value = null;
    try {
      const app = await fetchApplicantApplication(marketSlug.value, token.value);
      application.value = app;
      return { application: app, failed: false };
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        // Not a failure to load: the sign-in has ended, and the caller sends them to sign in.
        clearSession();
        error.value = 'Your session has expired. Please sign in again.';
        return { application: null, failed: false };
      }
      error.value = requestErrorFrom(err);
      return { application: null, failed: true };
    } finally {
      loading.value = false;
    }
  }

  async function saveApplication(formData: Record<string, unknown>): Promise<Application | null> {
    if (!token.value || !marketSlug.value) return null;
    loading.value = true;
    error.value = null;
    try {
      const app = await saveApplicantApplication(marketSlug.value, token.value, formData);
      application.value = app;
      return app;
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        clearSession();
        error.value = 'Your session has expired. Please sign in again.';
      } else {
        error.value = requestErrorFrom(err);
      }
      return null;
    } finally {
      loading.value = false;
    }
  }

  function clearSession(): void {
    marketId.value = null;
    marketSlug.value = null;
    applicantEmail.value = null;
    token.value = null;
    application.value = null;
    error.value = null;
    keepSession(null);
  }

  function logout(): void {
    clearSession();
  }

  return {
    marketId,
    marketSlug,
    applicantEmail,
    token,
    application,
    loading,
    error,
    isAuthenticatedFor,
    requestCode,
    verifyCode,
    fetchApplication,
    saveApplication,
    clearSession,
    logout,
  };
});
