/**
 * Every read an applicant page waits on is bounded, and a read that gets no answer is never
 * reported as "no application".
 *
 * Loading the saved answers (bug 21) gave the apply page a second request beside the form's, with
 * no time limit: a stalled stack left the page loading for ever, the state E06/F01/S01 had
 * removed. And a failed read came back as `null`, which Your Application read as "You have not
 * applied to this market yet."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/utils/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  getApiErrorMessage: () => 'Something went wrong.',
}));

import { api } from '@/utils/api';
import { APPLICANT_READ_TIMEOUT_MS, fetchApplicantApplication } from '@/utils/applicantApi';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';
import { useApplicationStore } from '@/stores/application';

async function signedInStore() {
  setActivePinia(createPinia());
  const store = useApplicationStore();
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: true, marketId: 'm-1', applicantEmail: 'vendor@example.com', token: 't' },
  });
  await store.verifyCode('spring-market', 'vendor@example.com', '123456');
  return store;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.resetAllMocks());

describe('an applicant read', () => {
  it('waits a bounded time, for the form and for the saved application alike', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { application: null } });

    await fetchPublicApplicationForm('spring-market');
    await fetchApplicantApplication('spring-market', 't');

    const timeouts = vi.mocked(api.get).mock.calls.map(([, config]) => config?.timeout);
    expect(timeouts).toEqual([APPLICANT_READ_TIMEOUT_MS, APPLICANT_READ_TIMEOUT_MS]);
  });

  it('that gets no answer is a failure, not an absent application', async () => {
    const store = await signedInStore();
    vi.mocked(api.get).mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout' });

    expect(await store.fetchApplication()).toEqual({ application: null, failed: true });
    expect(store.isAuthenticatedFor('spring-market')).toBe(true);
  });

  it('refused for an ended sign-in signs the vendor out, and is not a failure to load', async () => {
    const store = await signedInStore();
    vi.mocked(api.get).mockRejectedValue({ response: { status: 401 } });

    expect(await store.fetchApplication()).toEqual({ application: null, failed: false });
    expect(store.isAuthenticatedFor('spring-market')).toBe(false);
  });

  it('that finds none says none', async () => {
    const store = await signedInStore();
    vi.mocked(api.get).mockResolvedValue({ data: { application: null } });

    expect(await store.fetchApplication()).toEqual({ application: null, failed: false });
  });
});
