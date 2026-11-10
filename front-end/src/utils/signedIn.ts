/**
 * The address the organizer signed in with, as the shell keeps it in `localStorage` (`user`), or
 * null when nobody is signed in or the stored value is not an address. Who they are is the
 * server's to know (the session); this is only for showing them themselves - the app bar and what
 * it offers, "(you)" beside their name in a list, Mine in the review's All view, whether a card
 * someone holds is their own, and which page the router's guard opens. Nothing is decided by it:
 * every request is judged on the session.
 *
 * The app stores a string; a test's fixture stores an object with an `email`, and both read here.
 */
export function signedInEmail(): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem('user') || 'null') as unknown;
    const email = (parsed as { email?: unknown } | null)?.email ?? parsed;
    return typeof email === 'string' && email ? email : null;
  } catch {
    return null;
  }
}
