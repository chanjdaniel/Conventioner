import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_FLASK_HOST,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const raw = localStorage.getItem("user");
  if (raw) {
    try {
      const userEmail = JSON.parse(raw);
      if (typeof userEmail === "string" && userEmail.length > 0) {
        config.headers.set("X-Owner-Email", userEmail);
      }
    } catch {
      // Ignore parse errors — user data may not be set yet
    }
  }
  return config;
});

/**
 * Extract a human-readable message from a caught request error, falling back to
 * the provided default when the error is not an Axios error or carries no message.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error || fallback;
  }
  return fallback;
}

/** The HTTP status of a caught request error, or null when it never reached the server. */
export function getApiErrorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
}
