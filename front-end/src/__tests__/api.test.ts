import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The client's side of authentication is the session cookie and nothing else.
 *
 * These tests used to assert the opposite: that the client attached an `X-Owner-Email` header read
 * from localStorage. The back end authorized against that header, so any signed-in user could act
 * as any other by changing a value their own browser owned (E07/F01/S02). The header is gone from
 * both sides, and what is pinned here is its absence.
 */
describe('api client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sends credentials, so the session cookie travels with every request', async () => {
    const { api } = await import('@/utils/api');

    expect(api.defaults.withCredentials).toBe(true);
  });

  it('attaches no request interceptor, so nothing can smuggle an identity onto a request', async () => {
    const { api } = await import('@/utils/api');

    const handlers = (
      api.interceptors.request as unknown as {
        handlers: { fulfilled: (config: unknown) => unknown }[];
      }
    ).handlers;

    expect(handlers).toHaveLength(0);
  });

  it('does not read the stored user, so a tampered localStorage changes no request', async () => {
    const getItemMock = vi.fn().mockReturnValue('"attacker@example.com"');
    vi.stubGlobal('localStorage', { getItem: getItemMock });

    await import('@/utils/api');

    expect(getItemMock).not.toHaveBeenCalled();
  });
});
