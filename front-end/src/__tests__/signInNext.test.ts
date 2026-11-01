import { describe, expect, it } from 'vitest';
import { loginAddress, safeNext } from '@/utils/signInNext';

/**
 * Signing in returns to the page it was asked from, and only to a page of this app (E38/F11/S01):
 * `next` is a value anyone can put in a link, so whatever is not a same-origin path is dropped.
 */
describe('where signing in continues to', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeNext('/markets/m-1/applications?view=all&status=undecided')).toBe(
      '/markets/m-1/applications?view=all&status=undecided',
    );
    expect(safeNext('/dashboard')).toBe('/dashboard');
  });

  it.each([
    ['another host, protocol-relative', '//evil.example'],
    ['another host, protocol-relative with a path', '//evil.example/markets'],
    ['a full address', 'https://evil.example/markets'],
    ['a full address to this host', 'http://localhost/markets'],
    ['a backslash the browser reads as a slash', '/\\evil.example'],
    ['a backslash after the slash, with a path', '/\\/evil.example/x'],
    ['a script', 'javascript:alert(1)'],
    ['a relative path', 'markets'],
    ['the sign-in page itself', '/login'],
    ['the sign-in page with a next of its own', '/login?next=/markets'],
    ['the sign-in page in capitals', '/Login'],
    ['the sign-in page in capitals with a next of its own', '/LOGIN?next=/markets'],
    ['the sign-in page with a trailing slash', '/login/'],
    ['nothing', ''],
    ['a tab inside the host', '/\t/evil.example'],
  ])('drops %s', (_name, next) => {
    expect(safeNext(next)).toBeNull();
  });

  it('drops a value that is not one string', () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext(['/markets', '/dashboard'])).toBeNull();
  });

  it('builds the sign-in address that returns to a page', () => {
    expect(loginAddress('/markets/m-1/applications?view=all')).toEqual({
      path: '/login',
      query: { next: '/markets/m-1/applications?view=all' },
    });
    expect(loginAddress('/markets', { ended: true })).toEqual({
      path: '/login',
      query: { next: '/markets', ended: '1' },
    });
  });

  it('builds no next for a page that is not one to return to', () => {
    expect(loginAddress('/login?next=/markets')).toEqual({ path: '/login', query: {} });
    expect(loginAddress('/dashboard', { ended: true })).toEqual({
      path: '/login',
      query: { next: '/dashboard', ended: '1' },
    });
  });
});
