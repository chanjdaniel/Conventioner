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
 * On failure (401): { message: "Invalid or expired code." }
 *
 * The backend is oracle-free: every failure branch collapses to one identical
 * 401 response. One attempt per code - a wrong code consumes it.
 */
export async function verifyLoginCode(
  marketSlug: string,
  email: string,
  code: string,
): Promise<{ success: boolean; marketId: string; applicantEmail: string; token?: string }> {
  const { data } = await api.post(`/public/markets/${marketSlug}/applicant-login/verify-code`, {
    email,
    code,
  });
  return {
    success: true,
    marketId: data.marketId,
    applicantEmail: data.applicantEmail,
    token: data.token,
  };
}

/** Uniform error message for verification failures (anti-oracle ruling). */
export function verifyErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'Invalid or expired code.');
}

/** Suitable error message for unexpected request-code failures. */
export function requestErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'Unable to send code. Please try again.');
}

/**
 * Fetch the authenticated applicant's application.
 * GET /public/markets/<slug>/applicant/application
 * Requires Bearer token in Authorization header.
 */
export async function fetchApplicantApplication(
  marketSlug: string,
  token: string,
): Promise<Application> {
  const { data } = await api.get(`/public/markets/${marketSlug}/applicant/application`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.application as Application;
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
 * Record a review verdict on an application (organizer only).
 * PUT /markets/<id>/applications/<app_id>/review
 */
export async function reviewApplication(
  marketId: string,
  applicationId: string,
  status: string,
): Promise<Application> {
  const { data } = await api.put(`/markets/${marketId}/applications/${applicationId}/review`, {
    status,
  });
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
