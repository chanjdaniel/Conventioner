import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  requestLoginCode,
  verifyLoginCode,
  resumeSignIn,
  endRememberedSignIn,
  type SignedIn,
  verifyErrorFrom,
  codeStateFrom,
  type CodeState,
  requestErrorFrom,
  saveErrorFrom,
  fetchApplicantApplication,
  saveApplicantApplication,
  checkInWithDoorCode,
  undoOwnCheckIn,
} from '@/utils/applicantApi';
import { getApiErrorMessage, getApiErrorStatus } from '@/utils/api';
import {
  IntakeMode,
  type Application,
  type EssentialFormOptions,
  type FormField,
} from '@/assets/types/datatypes';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';
import { fetchVendorPage, type VendorPageInfo, type VendorPageRead } from '@/utils/vendorPage';

/** What reading the vendor's own application found. */
export interface ApplicationRead {
  application: Application | null;
  failed: boolean;
}

/**
 * What reading a signed-in vendor's page found: `failed` when a read got no answer, `notFound` when
 * the market no longer has a vendor page (taken back to draft, say), which reads as a stranger's.
 */
export interface VendorRead {
  failed: boolean;
  notFound: boolean;
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
 *
 * "Remember me" (ADR 0022) changes none of this: it spares the code, not the tab. A remembered
 * device holds an HttpOnly cookie the server set, which this code never reads; a new tab asks the
 * server to resume from it and keeps the token it is given here, as a right code's is.
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

/**
 * A door code scanned at the entrance (ADR 0022), kept in this tab from the moment the page opens
 * on `?door=<code>` until it is used once, so it survives the sign-in it may take first.
 */
const DOOR_CODE_KEY = 'conventioner.doorCode';

interface HeldDoorCode {
  marketSlug: string;
  code: string;
}

function storedDoorCode(): HeldDoorCode | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DOOR_CODE_KEY) ?? 'null') as unknown;
    const held = parsed as Partial<HeldDoorCode> | null;
    return held?.marketSlug && held.code ? (held as HeldDoorCode) : null;
  } catch {
    return null;
  }
}

function keepDoorCode(held: HeldDoorCode | null): void {
  try {
    if (held) sessionStorage.setItem(DOOR_CODE_KEY, JSON.stringify(held));
    else sessionStorage.removeItem(DOOR_CODE_KEY);
  } catch {
    // Unavailable storage: the code lasts as long as the page.
  }
}

/** What a check-in or its undo came to: done, or refused with the sentence to show. */
export type CheckInResult = { ok: true } | { ok: false; message: string; signedOut: boolean };

export const useApplicationStore = defineStore('application', () => {
  const kept = storedSession();
  const marketId = ref<string | null>(kept?.marketId ?? null);
  const marketSlug = ref<string | null>(kept?.marketSlug ?? null);
  const applicantEmail = ref<string | null>(kept?.applicantEmail ?? null);
  const token = ref<string | null>(kept?.token ?? null);
  const application = ref<Application | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Where the last refused code stands, beside `error`'s sentence; null until one is refused. */
  const codeState = ref<CodeState | null>(null);
  /**
   * The vendor page's one state (ADR 0022): the market as the page reads it before sign-in, and,
   * signed in, the form's questions - its own and the essential ones the plan offers - that the
   * vendor's answers are shown against and edited in. Every section reads it here.
   */
  const page = ref<VendorPageInfo | null>(null);
  const formFields = ref<FormField[]>([]);
  const essentialOptions = ref<EssentialFormOptions>(EMPTY_ESSENTIAL_OPTIONS);
  const heldDoorCode = ref<HeldDoorCode | null>(storedDoorCode());

  function isAuthenticatedFor(slug: string): boolean {
    return token.value !== null && marketSlug.value === slug;
  }

  /** Read the market's vendor page, as anyone may before signing in. */
  async function loadPage(slug: string): Promise<VendorPageRead> {
    const read = await fetchVendorPage(slug);
    page.value = read.page;
    return read;
  }

  /**
   * Read what a signed-in vendor's page shows: their application, and on a market whose vendors
   * apply, the form's questions. A sign-in that has ended is renewed from a remembered device, or
   * else clears itself (`fetchApplication`).
   *
   * Both arrive before the page is drawn, so the form opens on what the vendor already answered
   * (bug 21): its own defaults - a ranking seeded in the plan's order - fill only what they never
   * answered, and never race their answers.
   */
  async function loadVendorRead(): Promise<VendorRead> {
    const slug = marketSlug.value;
    if (!slug) return { failed: false, notFound: false };
    const asksQuestions = page.value?.intakeMode === IntakeMode.Form;
    const [read, form] = await Promise.all([
      fetchApplication(),
      asksQuestions ? fetchPublicApplicationForm(slug) : Promise.resolve(null),
    ]);
    formFields.value = form?.fields ?? [];
    essentialOptions.value = form?.essentialOptions ?? EMPTY_ESSENTIAL_OPTIONS;
    return {
      failed: read.failed || Boolean(form?.failed && !form.notFound),
      notFound: Boolean(form?.notFound),
    };
  }

  async function requestCode(slug: string, email: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await requestLoginCode(slug, email);
      codeState.value = null;
    } catch (err: unknown) {
      error.value = requestErrorFrom(err);
    } finally {
      loading.value = false;
    }
  }

  /** Hold a sign-in the server gave, from a right code or a remembered one, for this tab. */
  function holdSignIn(slug: string, result: SignedIn & { token: string }): void {
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
  }

  async function verifyCode(
    slug: string,
    email: string,
    code: string,
    remember = false,
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;
    codeState.value = null;
    try {
      const result = await verifyLoginCode(slug, email, code, remember);
      // Every successful sign-in carries a token now, applied or not (E26/F07/S01). Without one
      // this reported success and the page went back to "Sign In" with no word (bug 6), so a
      // reply without one is a failure, said as one.
      if (!result.token) {
        error.value = 'Sign-in did not complete. Please request a new code and try again.';
        return false;
      }
      holdSignIn(slug, { ...result, token: result.token });
      return true;
    } catch (err: unknown) {
      error.value = verifyErrorFrom(err);
      codeState.value = codeStateFrom(err);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Sign a remembered device straight back in (ADR 0022); true when it was.
   *
   * Asked once, by a page with no sign-in in this tab, before it draws the sign-in, and by a
   * signed-in request that finds this tab's sign-in ended (`withRenewal`). Anything but a live
   * remembered sign-in - none, one that has ended, or no answer at all - is false, and says
   * nothing: the page simply asks for a code, as it would have.
   */
  async function resume(slug: string): Promise<boolean> {
    try {
      const result = await resumeSignIn(slug);
      if (!result.token) return false;
      holdSignIn(slug, { ...result, token: result.token });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Make a signed-in request, and when it finds this tab's sign-in ended (a 401), ask once whether
   * the device is remembered and make it again with the sign-in that gives (ADR 0022). The 30-minute
   * sign-in ends while a vendor waits at the door; a remembered one should not then be sent a code.
   * Anything else, or a device that is not remembered, is the first answer, thrown as it came.
   */
  async function withRenewal<T>(call: (slug: string, token: string) => Promise<T>): Promise<T> {
    const slug = marketSlug.value;
    if (!slug || !token.value) throw new Error('Not signed in');
    try {
      return await call(slug, token.value);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 401 || !(await resume(slug)) || !token.value) throw err;
      return call(slug, token.value);
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
      const app = await withRenewal(fetchApplicantApplication);
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
      const app = await withRenewal((slug, current) =>
        saveApplicantApplication(slug, current, formData),
      );
      application.value = app;
      return app;
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        clearSession();
        error.value = 'Your session has expired. Please sign in again.';
      } else {
        error.value = saveErrorFrom(err);
      }
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** Keep a door code scanned at this market's entrance until the page uses it. */
  function holdDoorCode(slug: string, code: string): void {
    heldDoorCode.value = { marketSlug: slug, code };
    keepDoorCode(heldDoorCode.value);
  }

  /** The door code held for this market, taken: it is used once. */
  function takeDoorCode(slug: string): string | null {
    const held = heldDoorCode.value;
    if (!held || held.marketSlug !== slug) return null;
    heldDoorCode.value = null;
    keepDoorCode(null);
    return held.code;
  }

  /** Mark the vendor's seat on `date` as checked in at `at`, or not, as the server now holds it. */
  function setCheckedIn(date: string, at: string | null): void {
    const app = application.value;
    if (!app?.seats) return;
    app.seats = app.seats.map((seat) => (seat.date === date ? { ...seat, checkedInAt: at } : seat));
  }

  /** A refused check-in or undo, in its sentence; an ended sign-in clears itself. */
  function checkInRefusal(err: unknown, fallback: string): CheckInResult {
    if (getApiErrorStatus(err) === 401) return signedOutRefusal();
    return { ok: false, message: getApiErrorMessage(err, fallback), signedOut: false };
  }

  function signedOutRefusal(): CheckInResult {
    clearSession();
    error.value = 'Your session has expired. Please sign in again.';
    return { ok: false, message: error.value, signedOut: true };
  }

  /** Check the vendor in for `date` with the market's door code, scanned or typed (ADR 0022). */
  async function checkIn(date: string, doorCode: string): Promise<CheckInResult> {
    if (!token.value || !marketSlug.value) return signedOutRefusal();
    try {
      const { checkedInAt } = await withRenewal((slug, current) =>
        checkInWithDoorCode(slug, current, date, doorCode),
      );
      setCheckedIn(date, checkedInAt);
      return { ok: true };
    } catch (err: unknown) {
      return checkInRefusal(err, 'You were not checked in. Please try again.');
    }
  }

  /** Take back the vendor's own check-in for `date`, after a mis-tap. */
  async function undoCheckIn(date: string): Promise<CheckInResult> {
    if (!token.value || !marketSlug.value) return signedOutRefusal();
    try {
      await withRenewal((slug, current) => undoOwnCheckIn(slug, current, date));
      setCheckedIn(date, null);
      return { ok: true };
    } catch (err: unknown) {
      return checkInRefusal(err, 'Your check-in was not undone. Please try again.');
    }
  }

  function clearSession(): void {
    marketId.value = null;
    marketSlug.value = null;
    applicantEmail.value = null;
    token.value = null;
    application.value = null;
    formFields.value = [];
    essentialOptions.value = EMPTY_ESSENTIAL_OPTIONS;
    error.value = null;
    codeState.value = null;
    keepSession(null);
  }

  /**
   * Sign out: end this device's remembered sign-in on the server, then this tab's (ADR 0022).
   *
   * False, still signed in, when the server could not be reached: a remembered device left as it
   * was would sign them straight back in on their next visit, which is not what Sign out says.
   */
  async function signOut(slug: string): Promise<boolean> {
    try {
      await endRememberedSignIn(slug);
    } catch {
      return false;
    }
    clearSession();
    return true;
  }

  return {
    marketId,
    marketSlug,
    applicantEmail,
    token,
    application,
    loading,
    error,
    codeState,
    page,
    formFields,
    essentialOptions,
    heldDoorCode,
    isAuthenticatedFor,
    loadPage,
    loadVendorRead,
    requestCode,
    verifyCode,
    resume,
    fetchApplication,
    saveApplication,
    clearSession,
    signOut,
    holdDoorCode,
    takeDoorCode,
    checkIn,
    undoCheckIn,
  };
});
