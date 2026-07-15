import { api, getApiErrorMessage } from '@/utils/api'

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
  })
  return data
}

/**
 * Verify a login code for the applicant's email.
 * POST /public/markets/<slug>/applicant-login/verify-code
 *
 * On success (200): { success: true, marketId, applicantEmail }
 * On failure (401): { message: "Invalid or expired code." }
 *
 * The backend is oracle-free: every failure branch collapses to one identical
 * 401 response. One attempt per code - a wrong code consumes it.
 */
export async function verifyLoginCode(
  marketSlug: string,
  email: string,
  code: string,
): Promise<{ success: boolean; marketId: string; applicantEmail: string }> {
  const { data } = await api.post(`/public/markets/${marketSlug}/applicant-login/verify-code`, {
    email,
    code,
  })
  return { success: true, marketId: data.marketId, applicantEmail: data.applicantEmail }
}

/** Uniform error message for verification failures (anti-oracle ruling). */
export function verifyErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'Invalid or expired code.')
}

/** Suitable error message for unexpected request-code failures. */
export function requestErrorFrom(err: unknown): string {
  return getApiErrorMessage(err, 'Unable to send code. Please try again.')
}
