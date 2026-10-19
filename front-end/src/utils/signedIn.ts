/**
 * The address the organizer signed in with, as the shell keeps it in `localStorage` (`user`), or
 * null when nobody is signed in or the stored value is not an address. Who they are is the
 * server's to know (the session); this is only for showing them themselves - "(you)" beside their
 * name in a list.
 */
export function signedInEmail(): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem('user') || 'null') as unknown;
    return typeof parsed === 'string' && parsed ? parsed : null;
  } catch {
    return null;
  }
}
