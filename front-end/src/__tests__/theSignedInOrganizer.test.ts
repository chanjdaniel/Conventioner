// @vitest-environment happy-dom
/**
 * How the stored user reads (T209): the shell reads it this way, and the app bar offers what it says.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { signedInEmail } from '@/utils/signedIn';

afterEach(() => localStorage.clear());

describe('signedInEmail', () => {
  it('reads the address the app stores', () => {
    localStorage.setItem('user', JSON.stringify('organizer@example.com'));
    expect(signedInEmail()).toBe('organizer@example.com');
  });

  it("reads an object's email, as a test's fixture stores it", () => {
    localStorage.setItem('user', JSON.stringify({ email: 'organizer@example.com' }));
    expect(signedInEmail()).toBe('organizer@example.com');
  });

  it.each([
    ['nothing stored', null],
    ['an empty address', '""'],
    ['an object with no email', '{"id":"u-1"}'],
    ['an object whose email is no address', '{"email":7}'],
    ['a number', '7'],
    ['what is not JSON', 'organizer@example.com'],
  ])('is null for %s', (_name, stored) => {
    if (stored !== null) localStorage.setItem('user', stored);
    expect(signedInEmail()).toBeNull();
  });
});
