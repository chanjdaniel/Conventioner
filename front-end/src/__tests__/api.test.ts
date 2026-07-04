import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';

describe('api client interceptor', () => {
  let api: typeof import('@/utils/api').api;

  beforeEach(() => {
    vi.resetModules();
  });

  it('sets X-Owner-Email header when user email is stored in localStorage', async () => {
    const getItemMock = vi.fn().mockReturnValue('"test@example.com"');
    vi.stubGlobal('localStorage', { getItem: getItemMock });

    const mod = await import('@/utils/api');
    api = mod.api;

    const testConfig = { headers: new axios.AxiosHeaders() };

    const interceptors = (
      api.interceptors.request as unknown as {
        handlers: { fulfilled: (config: unknown) => unknown }[];
      }
    ).handlers;
    if (interceptors.length > 0) {
      await interceptors[0].fulfilled(testConfig);
    }

    expect(testConfig.headers.get('X-Owner-Email')).toBe('test@example.com');
  });

  it('does not set X-Owner-Email when no user in localStorage', async () => {
    const getItemMock = vi.fn().mockReturnValue(null);
    vi.stubGlobal('localStorage', { getItem: getItemMock });

    const mod = await import('@/utils/api');
    api = mod.api;

    const testConfig = { headers: new axios.AxiosHeaders() };

    const interceptors = (
      api.interceptors.request as unknown as {
        handlers: { fulfilled: (config: unknown) => unknown }[];
      }
    ).handlers;
    if (interceptors.length > 0) {
      await interceptors[0].fulfilled(testConfig);
    }

    expect(testConfig.headers.get('X-Owner-Email')).toBeUndefined();
  });

  it('ignores malformed localStorage data gracefully', async () => {
    const getItemMock = vi.fn().mockReturnValue('not-valid-json');
    vi.stubGlobal('localStorage', { getItem: getItemMock });

    const mod = await import('@/utils/api');
    api = mod.api;

    const testConfig = { headers: new axios.AxiosHeaders() };

    const interceptors = (
      api.interceptors.request as unknown as {
        handlers: { fulfilled: (config: unknown) => unknown }[];
      }
    ).handlers;
    if (interceptors.length > 0) {
      await interceptors[0].fulfilled(testConfig);
    }

    expect(testConfig.headers.get('X-Owner-Email')).toBeUndefined();
  });
});
