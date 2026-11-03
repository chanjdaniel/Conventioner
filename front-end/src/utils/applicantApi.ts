import axios from 'axios';
import { api, getApiErrorMessage } from '@/utils/api';
import type { Application } from '@/assets/types/datatypes';

/**
 * Request a login code for the applicant's email.
 * POST /public/markets/<slug>/applicant-login/request-code
 *
 * The backend (5d) is oracle-free: always returns the same 200 response
 * whether or not the email is known to this market.
 */
export async function requestLoginCode(
  marketSlug: string,
  email: string,
): Promise<{ message: string }> {
  const { data } = await api.post(`/public/markets/${marketSlug}/applicant-login/request-code`, {
    email,
  });
  return data;
}

/**
 * Verify a login code for the applicant's email.
 * POST /public/markets/<slug>/applicant-login/verify-code
 *
 * On success (200): { success: true, marketId, applicantEmail, token? }
 * On failure (401): { message, codeState }, `codeState` "retry" for a wrong try at a code with
 * tries left, "spent" for every other way a code cannot pass (`codeStateFrom`).
 *
 * A code lasts ten minutes and takes five tries; neither answer says whether the address applied.
 * With `remember`, a right code also leaves this device remembered for the market (ADR 0022): the
 * server sets an HttpOnly cookie no script here reads, which `resumeSignIn` spends.
 */
export async function verifyLoginCode(
  marketSlug: string,
  email: string,
  code: string,
  remember: boolean,
): Promise<SignedIn> {
  const { data } = await api.post(`/public/markets/${marketSlug}/applicant-login/verify-code`, {
    email,
    code,
    remember,
  });
  return signedInFrom(data);
}

/** What a right code, or a live remembered sign-in, answers. */
export interface SignedIn {
  success: boolean;
  marketId: string;
  applicantEmail: string;
  token?: string;
}

function signedInFrom(data: Record<string, unknown>): SignedIn {
  return {
    success: true,
    marketId: String(data.marketId ?? ''),
    applicantEmail: String(data.applicantEmail ?? ''),
    token: typeof data.token === 'string' ? data.token : undefined,
  };
}

/**
 * Sign this device's remembered vendor straight back in (ADR 0022).
 * POST /public/markets/<slug>/applicant-login/resume
 *
 * The browser sends the market's remember cookie itself (`withCredentials`); a live one is answered
 * as a right code is. Every other way, no cookie among them, is a 401, and the page asks for a code.
 */
export async function resumeSignIn(marketSlug: string): Promise<SignedIn> {
  const { data } = await api.post(`/public/markets/${marketSlug}/applicant-login/resume`, null, {
    timeout: APPLICANT_READ_TIMEOUT_MS,
  });
  return signedInFrom(data);
}

/**
 * End this device's remembered sign-in at the market, on the server too, so a copy of the cookie
 * stops working. POST /public/markets/<slug>/applicant-login/sign-out; 204 whether or not there was one.
 */
export async function endRememberedSignIn(marketSlug: string): Promise<void> {
  await api.post(`/public/markets/${marketSlug}/applicant-login/sign-out`, null, {
    timeout: APPLICANT_READ_TIMEOUT_MS,
  });
}

/** What a refused code's step says: the server's sentence, which says what to do next. */
export function verifyErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'That code could not be checked. Please try again.');
}

/**
 * Where a refused code stands (T191 F22): "retry" while it has tries left, so the field clears for
 * another; "spent" once it no longer works, so only "Send a new code" is offered. Null for a
 * refusal that says nothing of the code - too many tries from this address, or no answer at all -
 * which leaves the step as it was.
 */
export type CodeState = 'retry' | 'spent';

export function codeStateFrom(err: unknown): CodeState | null {
  const data = axios.isAxiosError(err) ? err.response?.data : undefined;
  const state = (data as { codeState?: unknown } | undefined)?.codeState;
  return state === 'retry' || state === 'spent' ? state : null;
}

/** Suitable error message for unexpected request-code failures. */
export function requestErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'Unable to send code. Please try again.');
}

/** What the application section says of a save the server refused, when it gave no sentence. */
export function saveErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'Your application could not be saved. Please try again.');
}

/**
 * How long an applicant waits for a read before being told it did not load. Generous, because a
 * phone on a bad connection is the normal case, but bounded - an unbounded request leaves the
 * page on its loading state for ever, with nothing to retry and nothing to read.
 *
 * One bound for every read the vendor page waits on. Signed in, it waits on two at once (the
 * vendor's application and the form), and when only the form's was bounded, a stall in the other
 * kept the form page of old loading for ever anyway.
 */
export const APPLICANT_READ_TIMEOUT_MS = 15000;

/**
 * Fetch the authenticated applicant's application, or null when they have not applied yet.
 * GET /public/markets/<slug>/applicant/application
 * Requires Bearer token in Authorization header.
 */
export async function fetchApplicantApplication(
  marketSlug: string,
  token: string,
): Promise<Application | null> {
  const { data } = await api.get(`/public/markets/${marketSlug}/applicant/application`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: APPLICANT_READ_TIMEOUT_MS,
  });
  return (data.application as Application | null) ?? null;
}

/**
 * Save/submit the authenticated applicant's application.
 * PUT /public/markets/<slug>/applicant/application
 * Requires Bearer token in Authorization header.
 */
export async function saveApplicantApplication(
  marketSlug: string,
  token: string,
  formData: Record<string, unknown>,
): Promise<Application> {
  const { data } = await api.put(
    `/public/markets/${marketSlug}/applicant/application`,
    { formData },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data.application as Application;
}

/**
 * Fetch all applications for a market (organizer only, requires session auth).
 * GET /markets/<id>/applications
 */
export async function fetchMarketApplications(marketId: string): Promise<Application[]> {
  const { data } = await api.get(`/markets/${marketId}/applications`);
  return data.applications as Application[];
}

/**
 * What a reviewer saw of an application: its status, its verdict's time and its answers' time. A
 * verdict is written only while all three still stand (E34/F03/S01).
 */
function seenOf(application: Application) {
  return {
    status: application.status,
    verdictAt: application.verdictAt ?? null,
    updatedAt: application.updatedAt,
  };
}

/**
 * What a verdict wrote: the application as it now stands, and how many seconds its giver may undo it
 * for (E38/F10/S01), the server's window, so the client keeps no second copy of it; 0 for a verdict
 * that changed one, which is never undone.
 */
export interface VerdictWritten {
  application: Application;
  undoSeconds: number;
}

/**
 * Record a review verdict on an application (organizer only).
 * PUT /markets/<id>/applications/<app_id>/review
 */
export async function reviewApplication(
  marketId: string,
  /** The application as the reviewer saw it: the verdict lands only if it still is (E34/F03/S01). */
  application: Application,
  status: string,
  /** A follow-up's owner, when not the reviewer (E34/F02/S01). */
  ownerEmail?: string,
): Promise<VerdictWritten> {
  const { data } = await api.put(`/markets/${marketId}/applications/${application.id}/review`, {
    status,
    seen: seenOf(application),
    ...(ownerEmail ? { ownerEmail } : {}),
  });
  return { application: data.application as Application, undoSeconds: data.undoSeconds ?? 0 };
}

/**
 * A verdict to undo (E38/F10/S01): the application as the verdict left it. What it returns to is the
 * server's, kept by the verdict, so the client names only what it saw.
 */
export interface UndoItem {
  application: Application;
}

function undoBody({ application }: UndoItem) {
  return { seen: seenOf(application) };
}

/**
 * Undo the verdict the signed-in reviewer just gave (E38/F10/S01): theirs, within the window.
 * POST /markets/<id>/applications/<app_id>/review/undo
 */
export async function undoVerdict(marketId: string, item: UndoItem): Promise<Application> {
  const { data } = await api.post(
    `/markets/${marketId}/applications/${item.application.id}/review/undo`,
    undoBody(item),
  );
  return data.application as Application;
}

/** Undo what a selection's verdict wrote, each as one is undone, saying what it skipped and why. */
export async function undoSelection(marketId: string, items: UndoItem[]): Promise<SelectionResult> {
  const { data } = await api.post(`/markets/${marketId}/applications/verdicts/undo`, {
    applications: items.map((item) => ({ id: item.application.id, ...undoBody(item) })),
  });
  return data as SelectionResult;
}

/**
 * Who changed an application since the reviewer opened it, and the application as it now stands,
 * when a verdict was refused for it (E34/F03/S01); null for any other failure.
 */
export function changedSinceSeen(
  err: unknown,
): { message: string; application: Application } | null {
  const response = (err as { response?: { status?: number; data?: Record<string, unknown> } })
    ?.response;
  if (response?.status !== 409 || !response.data?.application) return null;
  return {
    message: String(response.data.error ?? ''),
    application: response.data.application as Application,
  };
}

/** What a verdict on a selection wrote, and what it skipped and why (E34/F04/S02). */
export interface SelectionResult {
  written: string[];
  skipped: { id: string; email: string | null; reason: string }[];
  /**
   * How many seconds what it wrote may be undone for (E38/F10/S01): only when it wrote any, and each
   * on an application still awaiting a verdict.
   */
  undoSeconds?: number;
}

/** One verdict for a ticked selection, each written only on what the reviewer saw. */
export async function reviewSelection(
  marketId: string,
  applications: Application[],
  status: string,
): Promise<SelectionResult> {
  const { data } = await api.post(`/markets/${marketId}/applications/verdicts`, {
    status,
    applications: applications.map((app) => ({
      id: app.id,
      seen: seenOf(app),
    })),
  });
  return data as SelectionResult;
}

/** Hand a follow-up to someone else with a role on the market (E34/F02/S01). */
export async function reassignFollowUp(
  marketId: string,
  applicationId: string,
  ownerEmail: string,
): Promise<Application> {
  const { data } = await api.put(
    `/markets/${marketId}/applications/${applicationId}/follow-up-owner`,
    { ownerEmail },
  );
  return data.application as Application;
}

/**
 * Publish review results, making verdicts visible to applicants (organizer only).
 * POST /markets/<id>/publish-results
 */
export async function publishResults(marketId: string): Promise<{ results_published: boolean }> {
  const { data } = await api.post(`/markets/${marketId}/publish-results`);
  return data;
}
