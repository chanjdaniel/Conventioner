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

/**
 * Each kind of failure reads one way, chosen here and nowhere else (E38/F11/S01): an organizer is
 * told whether the connection, the server or their session failed, and a refusal keeps its own
 * sentence.
 */
describe('what a failed request says', () => {
  const failure = async (status: number | null, data?: unknown) => {
    const { AxiosError } = await import('axios');
    const config = { headers: {} } as never;
    const response =
      status === null
        ? undefined
        : ({ status, data, statusText: '', headers: {}, config } as never);
    return new AxiosError('Request failed', undefined, config, {}, response);
  };

  it('says the organizer seems offline when no answer came back', async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    expect(getApiErrorMessage(await failure(null), 'The verdict was not saved.')).toBe(
      'You seem to be offline. Check the connection and try again.',
    );
  });

  it("says a 500 is the server's fault, whatever its body", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    for (const data of [{ error: 'Internal server error' }, { message: 'KeyError' }, '<html>']) {
      expect(getApiErrorMessage(await failure(500, data), 'The verdict was not saved.')).toBe(
        'Something went wrong on our side. Try again in a moment.',
      );
    }
  });

  it("says another 5xx with no sentence, a proxy's, is the server's fault", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    for (const status of [502, 503, 504]) {
      expect(getApiErrorMessage(await failure(status, '<html>'), 'Not saved.')).toBe(
        'Something went wrong on our side. Try again in a moment.',
      );
    }
  });

  it("keeps the sentence the back end wrote for a 502 or 503, as Discord's say", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    expect(
      getApiErrorMessage(
        await failure(503, { error: 'Discord is not set up on this Conventioner.' }),
        'Not saved.',
      ),
    ).toBe('Discord is not set up on this Conventioner.');
  });

  it('says a session has ended on a 401 with no sentence of its own', async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    expect(getApiErrorMessage(await failure(401, '<!doctype html>'), 'Not saved.')).toBe(
      'Your session has ended. Sign in again.',
    );
  });

  it("keeps a 401's own sentence, as the applicant's code check words it", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    const spent = 'That code no longer works. Send yourself a new code.';
    expect(getApiErrorMessage(await failure(401, { message: spent }), 'x')).toBe(spent);
  });

  it("keeps a refusal's own sentence", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    expect(
      getApiErrorMessage(
        await failure(409, { error: 'Someone changed this application.' }),
        'The verdict was not saved.',
      ),
    ).toBe('Someone changed this application.');
    expect(
      getApiErrorMessage(await failure(403, { message: 'Only an Editor may do this.' }), 'x'),
    ).toBe('Only an Editor may do this.');
  });

  it("names a 413 with no sentence, the host's or a proxy's, as too large to carry", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    for (const data of ['Request Entity Too Large', '<html>', undefined]) {
      expect(
        getApiErrorMessage(await failure(413, data), 'The import could not be completed.'),
      ).toBe('This was larger than the 4.5 MB one request can carry.');
    }
  });

  it("keeps a 413's own sentence, as the floorplan upload words it", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    const own = 'This file is larger than 4 MB.';
    expect(getApiErrorMessage(await failure(413, { error: own }), 'x')).toBe(own);
  });

  it("says the screen's fallback for a 4xx with no sentence", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    expect(getApiErrorMessage(await failure(404, '<html>'), 'The verdict was not saved.')).toBe(
      'The verdict was not saved.',
    );
  });

  it("says the screen's fallback for a failure that was not a request's", async () => {
    const { getApiErrorMessage } = await import('@/utils/api');

    expect(getApiErrorMessage(new Error('boom'), 'The verdict was not saved.')).toBe(
      'The verdict was not saved.',
    );
  });
});
