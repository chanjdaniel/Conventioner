/**
 * The address the organizer signed in with, as the shell keeps it in `localStorage` (`user`), or
 * null when nobody is signed in or the stored value is not an address. Who they are is the
 * server's to know (the session); this is only for showing them themselves - "(you)" beside their
 * name in a list, Mine in the review's All view, and whether a card someone holds is their own.
 * Nothing is decided by it: every write is judged on the session.
 */
export function signedInEmail(): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem('user') || 'null') as unknown;
    return typeof parsed === 'string' && parsed ? parsed : null;
  } catch {
    return null;
  }
}
