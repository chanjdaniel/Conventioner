import axios from 'axios';

/**
 * `withCredentials` is the whole of the client's side of authentication: the session cookie says
 * who the caller is, and the back end reads it and nothing else.
 *
 * This used to also send an `X-Owner-Email` header read from localStorage, and the back end
 * authorized against *that* (E07/F01/S02). A value the browser sets cannot prove identity, so any
 * signed-in user could act as any other by changing it. The header is no longer read by anything;
 * do not reintroduce it, and do not add another one like it.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_FLASK_HOST,
  withCredentials: true,
});

/**
 * Extract a human-readable message from a caught request error, falling back to
 * the provided default when the error is not an Axios error or carries no message.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error || err.response?.data?.message || fallback;
  }
  return fallback;
}

/** The HTTP status of a caught request error, or null when it never reached the server. */
export function getApiErrorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
}
