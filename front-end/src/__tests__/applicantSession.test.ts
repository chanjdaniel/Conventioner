/**
 * A vendor's sign-in lasts as long as the tab (bug 36, E26/F07/S03).
 *
 * It lived only in memory, so reloading a half-filled application form signed the vendor out and
 * cost them a new code. It is kept in sessionStorage now: a reload keeps it, closing the tab ends
 * it, and storage that is unavailable leaves it lasting as long as the page, as it always did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/utils/applicantApi', () => ({
  requestLoginCode: vi.fn(),
  verifyLoginCode: vi.fn(),
  verifyErrorFrom: () => 'Invalid or expired code.',
  requestErrorFrom: () => 'Something went wrong.',
  fetchApplicantApplication: vi.fn(),
  saveApplicantApplication: vi.fn(),
}));

import { verifyLoginCode } from '@/utils/applicantApi';
import { useApplicationStore } from '@/stores/application';

const KEY = 'conventioner.applicantSession';

function freshStore() {
  setActivePinia(createPinia());
  return useApplicationStore();
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(verifyLoginCode).mockResolvedValue({
    success: true,
    marketId: 'market-1',
    applicantEmail: 'vendor@example.com',
    token: 'a-token',
  });
});

afterEach(() => vi.restoreAllMocks());

describe("a vendor's sign-in", () => {
  it('survives a reload, which is a fresh store reading what the last one kept', async () => {
    await freshStore().verifyCode('spring-market', 'vendor@example.com', '123456');

    const afterReload = freshStore();

    expect(afterReload.isAuthenticatedFor('spring-market')).toBe(true);
    expect(afterReload.applicantEmail).toBe('vendor@example.com');
    expect(afterReload.token).toBe('a-token');
  });

  it('is for the market it was made at, and no other', async () => {
    await freshStore().verifyCode('spring-market', 'vendor@example.com', '123456');

    expect(freshStore().isAuthenticatedFor('autumn-market')).toBe(false);
  });

  it('is gone after signing out', async () => {
    const store = freshStore();
    await store.verifyCode('spring-market', 'vendor@example.com', '123456');

    store.logout();

    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(freshStore().isAuthenticatedFor('spring-market')).toBe(false);
  });

  it('is not made from a reply that carries no token (bug 6)', async () => {
    vi.mocked(verifyLoginCode).mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
    });
    const store = freshStore();

    expect(await store.verifyCode('spring-market', 'vendor@example.com', '123456')).toBe(false);
    expect(store.error).toBeTruthy();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('ignores whatever is stored if it is not a whole sign-in', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ marketSlug: 'spring-market', token: 't' }));

    expect(freshStore().isAuthenticatedFor('spring-market')).toBe(false);
  });

  it('still signs in, for the life of the page, when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const store = freshStore();

    expect(await store.verifyCode('spring-market', 'vendor@example.com', '123456')).toBe(true);
    expect(store.isAuthenticatedFor('spring-market')).toBe(true);
  });
});
