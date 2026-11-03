// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import VendorPage from '@/views/VendorPage.vue';
import { useApplicationStore } from '@/stores/application';
import { IntakeMode, MarketPhase, type Application } from '@/assets/types/datatypes';
import {
  applicationSection,
  hasVendorPage,
  NO_APPLICATION_CLOSED,
  noVendorAtThisAddress,
  sharesVendorPage,
  statusHeadline,
  type VendorPageInfo,
  type VendorPageRead,
} from '@/utils/vendorPage';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';

const fetchVendorPage = vi.fn<(slug: string) => Promise<VendorPageRead>>();
vi.mock('@/utils/vendorPage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/vendorPage')>()),
  fetchVendorPage: (slug: string) => fetchVendorPage(slug),
}));

const fetchApplicantApplication = vi.fn();
const requestLoginCode = vi.fn();
const verifyLoginCode = vi.fn();
const saveApplicantApplication = vi.fn();
const resumeSignIn = vi.fn();
const endRememberedSignIn = vi.fn();
vi.mock('@/utils/applicantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/applicantApi')>()),
  fetchApplicantApplication: (...args: unknown[]) => fetchApplicantApplication(...args),
  saveApplicantApplication: (...args: unknown[]) => saveApplicantApplication(...args),
  requestLoginCode: (...args: unknown[]) => requestLoginCode(...args),
  verifyLoginCode: (...args: unknown[]) => verifyLoginCode(...args),
  resumeSignIn: (...args: unknown[]) => resumeSignIn(...args),
  endRememberedSignIn: (...args: unknown[]) => endRememberedSignIn(...args),
}));

const fetchPublicApplicationForm = vi.fn();
vi.mock('@/utils/publicApplicationForm', () => ({
  fetchPublicApplicationForm: (slug: string) => fetchPublicApplicationForm(slug),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { marketSlug: 'spring-market' } }),
  useRouter: () => ({ push: vi.fn() }),
}));

const SESSION_KEY = 'conventioner.applicantSession';

function pageOf(overrides: Partial<VendorPageInfo> = {}): VendorPageRead {
  return {
    page: {
      marketName: 'Spring Market',
      intakeMode: IntakeMode.Form,
      phase: MarketPhase.Applications,
      takesApplications: true,
      resultsPublished: false,
      marketDates: ['2099-08-01'],
      ended: false,
      rememberUntil: '2099-08-01',
      ...overrides,
    },
    notFound: false,
    failed: false,
  };
}

/** The organizer's own question, beside the full name every vendor is asked. */
const BUSINESS_NAME = {
  key: 'business_name',
  label: 'Business name',
  type: 'text',
  required: true,
  options: [],
  order: 0,
};

const NOT_FOUND: VendorPageRead = { page: null, notFound: true, failed: false };

/** The server's answer to a remembered sign-in that cannot pass, or to no cookie at all. */
function unauthorized(): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = {
    data: { message: 'Sign in with a code.' },
    status: 401,
    statusText: 'UNAUTHORIZED',
    headers: {},
    config,
  };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
}
const NEVER_ANSWERED: VendorPageRead = { page: null, notFound: false, failed: true };

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    marketId: 'market-1',
    applicantEmail: 'vendor@example.com',
    formData: { essential_full_name: 'Riley Fixture' },
    status: 'open',
    applicationType: 'main',
    submittedAt: '2099-06-01T00:00:00+00:00',
    updatedAt: '2099-06-01T00:00:00+00:00',
    outcome: null,
    seats: [],
    vendorName: 'Riley Fixture',
    ...overrides,
  } as Application;
}

function signIn() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      marketId: 'market-1',
      marketSlug: 'spring-market',
      applicantEmail: 'vendor@example.com',
      token: 'a-token',
    }),
  );
}

async function mountPage() {
  setActivePinia(createPinia());
  const wrapper = mount(VendorPage, { global: { stubs: { RouterLink: RouterLinkStub } } });
  await flushPromises();
  return wrapper;
}

const has = (wrapper: Awaited<ReturnType<typeof mountPage>>, testid: string) =>
  wrapper.find(`[data-testid="${testid}"]`).exists();

beforeEach(() => {
  sessionStorage.clear();
  requestLoginCode.mockReset();
  verifyLoginCode.mockReset();
  fetchVendorPage.mockReset();
  fetchApplicantApplication.mockReset();
  saveApplicantApplication.mockReset();
  // No remembered sign-in on this device unless a test says so; Sign out reaches the server.
  resumeSignIn.mockReset();
  resumeSignIn.mockRejectedValue(unauthorized());
  endRememberedSignIn.mockReset();
  endRememberedSignIn.mockResolvedValue(undefined);
  fetchPublicApplicationForm.mockReset();
  fetchPublicApplicationForm.mockResolvedValue({
    marketName: 'Spring Market',
    fields: [BUSINESS_NAME],
    essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
    phaseLabel: 'Applications',
    isOpen: true,
    failed: false,
    notFound: false,
  });
});

describe('what the application section shows (ADR 0022)', () => {
  const form = { intakeMode: IntakeMode.Form };
  it.each([
    ['taking, none yet', { ...form, takesApplications: true }, null, 'apply'],
    ['taking, applied', { ...form, takesApplications: true }, application(), 'edit'],
    ['stopped, applied', { ...form, takesApplications: false }, application(), 'answers'],
    ['stopped, none', { ...form, takesApplications: false }, null, 'closed'],
    [
      'a market that imports its vendors',
      { intakeMode: IntakeMode.Csv, takesApplications: false },
      application(),
      'none',
    ],
  ])('%s: %s', (_name, page, app, expected) => {
    expect(applicationSection(page, app)).toBe(expected);
  });
});

describe('whether a market has a vendor page, as the server decides (ADR 0022)', () => {
  const D = MarketPhase.Draft;
  const AP = MarketPhase.Applications;
  const AS = MarketPhase.Assignment;
  const MD = MarketPhase.MarketDays;
  const AR = MarketPhase.Archived;
  const ran = [D, AP, AS, MD, AR];
  const never = [D, AP, AS, AR];
  it.each([
    ['form, draft', IntakeMode.Form, D, false, [D], false, false],
    ['form, applications', IntakeMode.Form, AP, false, [D, AP], true, true],
    ['form, archived after it ran', IntakeMode.Form, AR, false, ran, true, true],
    ['form, archived without running', IntakeMode.Form, AR, false, never, true, false],
    ['csv, applications', IntakeMode.Csv, AP, false, [D, AP], false, false],
    ['csv, assignment', IntakeMode.Csv, AS, false, [D, AP, AS], false, false],
    ['csv, assignment, published', IntakeMode.Csv, AS, true, [D, AP, AS], true, true],
    ['csv, market days, never published', IntakeMode.Csv, MD, false, [D, MD], true, true],
    ['csv, archived after it ran', IntakeMode.Csv, AR, false, ran, true, true],
    ['csv, archived without running, published', IntakeMode.Csv, AR, true, never, true, false],
    ['csv, archived without running', IntakeMode.Csv, AR, false, never, false, false],
    ['csv, draft, published', IntakeMode.Csv, D, true, [D], false, false],
  ] as const)('%s', (_name, intakeMode, phase, resultsPublished, reached, has, shares) => {
    const market = { intakeMode, phase, resultsPublished, phasesReached: [...reached] };
    expect(hasVendorPage(market)).toBe(has);
    expect(sharesVendorPage(market)).toBe(shares);
  });
});

describe('the status a vendor reads', () => {
  it('reads Submitted until results are published, whatever the review decided', () => {
    expect(statusHeadline(application({ outcome: null }))).toBe('Submitted');
  });

  it('reads the outcome once they are', () => {
    expect(statusHeadline(application({ outcome: 'has_a_table' }))).toBe('You have a table');
    expect(statusHeadline(application({ outcome: 'not_assigned' }))).toBe(
      'You did not get assigned',
    );
  });

  it('reads nothing without an application', () => {
    expect(statusHeadline(null)).toBeNull();
  });
});

describe('the page, signed out', () => {
  it('asks the server about the market rather than trusting the address', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    await mountPage();

    expect(fetchVendorPage).toHaveBeenCalledWith('spring-market');
  });

  it("shows the market's name and asks for an email address", async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-market-name"]').text()).toBe('Spring Market');
    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(has(wrapper, 'vendor-page-sign-out-btn')).toBe(false);
  });

  it('reads as any page that is not there for a market without one', async () => {
    fetchVendorPage.mockResolvedValue(NOT_FOUND);
    const wrapper = await mountPage();

    expect(has(wrapper, 'page-not-found')).toBe(true);
    const text = wrapper.text().toLowerCase();
    expect(text).not.toContain('spring-market');
    expect(text).not.toContain('sign-in code');
  });

  it('never prints the slug back before it knows the market is real', async () => {
    fetchVendorPage.mockReturnValue(new Promise(() => {}));
    setActivePinia(createPinia());
    const wrapper = mount(VendorPage, { global: { stubs: { RouterLink: RouterLinkStub } } });

    expect(wrapper.text()).not.toContain('spring-market');
  });

  it('says the page could not be loaded when the request never answered, and tries again', async () => {
    fetchVendorPage.mockResolvedValue(NEVER_ANSWERED);
    const wrapper = await mountPage();

    expect(has(wrapper, 'page-not-found')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-load-failed"]').text()).toContain(
      'could not be loaded',
    );

    fetchVendorPage.mockResolvedValue(pageOf());
    await wrapper.get('[data-testid="vendor-page-retry-button"]').trigger('click');
    await flushPromises();

    expect(fetchVendorPage).toHaveBeenCalledTimes(2);
    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
  });
});

describe('signing in', () => {
  it("reads the vendor's own page as soon as the code is right", async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    verifyLoginCode.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-token',
    });
    fetchApplicantApplication.mockResolvedValue(application());
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-sign-in-email-input"]').setValue('vendor@example.com');
    await wrapper.get('[data-testid="vendor-sign-in-email-step"]').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-testid="vendor-sign-in-code-input"]').setValue('123456');
    await wrapper.get('[data-testid="vendor-sign-in-code-step"]').trigger('submit');
    await flushPromises();

    expect(fetchApplicantApplication).toHaveBeenCalledWith('spring-market', 'a-token');
    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('Submitted');
    expect(has(wrapper, 'vendor-page-info')).toBe(false);
  });
});

/** A refused code as the server answers it: a 401 carrying its sentence and the code's state. */
function codeRefused(codeState: 'retry' | 'spent', message: string) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, {
    status: 401,
    statusText: 'UNAUTHORIZED',
    data: { message, codeState },
    headers: {},
    config,
  });
}

const RETRY = "That code isn't right. Check you typed the newest code and try again.";
const SPENT = 'That code no longer works. Send yourself a new code.';

describe('a code that does not pass (T191 F22)', () => {
  async function atTheCodeStep() {
    fetchVendorPage.mockResolvedValue(pageOf());
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="vendor-sign-in-email-input"]').setValue('vendor@example.com');
    await wrapper.get('[data-testid="vendor-sign-in-email-step"]').trigger('submit');
    await flushPromises();
    return wrapper;
  }

  async function enter(wrapper: Awaited<ReturnType<typeof mountPage>>, code: string) {
    await wrapper.get('[data-testid="vendor-sign-in-code-input"]').setValue(code);
    await wrapper.get('[data-testid="vendor-sign-in-code-step"]').trigger('submit');
    await flushPromises();
  }

  it('says only the newest code works, before any is typed', async () => {
    const wrapper = await atTheCodeStep();

    expect(wrapper.get('[data-testid="vendor-sign-in-code-step"]').text()).toContain(
      "We've sent a code to vendor@example.com. Only the newest one works.",
    );
  });

  it('clears the field and keeps it focused to try again, saying the code is not right', async () => {
    const wrapper = await atTheCodeStep();
    verifyLoginCode.mockRejectedValue(codeRefused('retry', RETRY));
    document.body.append(wrapper.element);

    await enter(wrapper, '000000');

    const field = wrapper.get('[data-testid="vendor-sign-in-code-input"]');
    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toBe(RETRY);
    expect((field.element as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(field.element);
    expect(has(wrapper, 'vendor-sign-in-verify-btn')).toBe(true);
    wrapper.unmount();
  });

  it('offers only "Send a new code" once the code no longer works, after its wait', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await atTheCodeStep();
      verifyLoginCode.mockRejectedValue(codeRefused('spent', SPENT));

      await enter(wrapper, '000005');

      expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toBe(SPENT);
      expect(has(wrapper, 'vendor-sign-in-code-input')).toBe(false);
      expect(has(wrapper, 'vendor-sign-in-verify-btn')).toBe(false);
      expect(has(wrapper, 'vendor-sign-in-resend-btn')).toBe(false);
      const send = wrapper.get('[data-testid="vendor-sign-in-send-new-code-btn"]');
      expect(send.classes()).toContain('btn--primary');
      expect(send.attributes('disabled')).toBeDefined();
      expect(send.text()).toMatch(/^Send a new code in \d+s$/);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(send.attributes('disabled')).toBeUndefined();
      expect(send.text()).toBe('Send a new code');

      await send.trigger('click');
      await flushPromises();

      expect(requestLoginCode).toHaveBeenCalledTimes(2);
      expect(has(wrapper, 'vendor-sign-in-error')).toBe(false);
      expect(has(wrapper, 'vendor-sign-in-code-input')).toBe(true);
      expect(has(wrapper, 'vendor-sign-in-verify-btn')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the field for a refusal that says nothing of the code, such as too many tries', async () => {
    const wrapper = await atTheCodeStep();
    const config = { headers: {} } as InternalAxiosRequestConfig;
    const tooMany = 'Too many sign-in attempts. Please try again in 15 minutes.';
    verifyLoginCode.mockRejectedValue(
      new AxiosError('429', 'ERR_BAD_REQUEST', config, null, {
        status: 429,
        statusText: 'TOO MANY REQUESTS',
        data: { message: tooMany },
        headers: {},
        config,
      }),
    );

    await enter(wrapper, '123456');

    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toBe(tooMany);
    expect(has(wrapper, 'vendor-sign-in-code-input')).toBe(true);
  });
});

describe('the page, signed in', () => {
  beforeEach(signIn);

  it('reads Submitted, their answers and Edit while the market takes applications', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(application());
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('Submitted');
    expect(has(wrapper, 'vendor-page-answers')).toBe(true);
    expect(has(wrapper, 'vendor-page-edit-btn')).toBe(true);
    expect(wrapper.get('[data-testid="vendor-page-signed-in-as"]').text()).toBe(
      'Signed in as Riley Fixture (vendor@example.com)',
    );
  });

  it('offers Apply to a vendor who has not applied while the market takes applications', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    expect(has(wrapper, 'vendor-page-apply-btn')).toBe(true);
    expect(has(wrapper, 'vendor-page-status')).toBe(false);
  });

  it('shows the answers read-only once the market stops taking applications', async () => {
    fetchVendorPage.mockResolvedValue(
      pageOf({ phase: MarketPhase.Assignment, takesApplications: false }),
    );
    fetchApplicantApplication.mockResolvedValue(application());
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('Submitted');
    expect(has(wrapper, 'vendor-page-answers')).toBe(true);
    expect(has(wrapper, 'vendor-page-edit-btn')).toBe(false);
    expect(has(wrapper, 'apply-form')).toBe(false);
  });

  it('says so to a vendor with no application at a market no longer taking any', async () => {
    fetchVendorPage.mockResolvedValue(pageOf({ takesApplications: false }));
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-info"]').text()).toBe(NO_APPLICATION_CLOSED);
  });

  it('reads the result and each seat once results are published', async () => {
    fetchVendorPage.mockResolvedValue(
      pageOf({ phase: MarketPhase.Assignment, takesApplications: false, resultsPublished: true }),
    );
    fetchApplicantApplication.mockResolvedValue(
      application({
        outcome: 'has_a_table',
        seats: [
          {
            date: '2099-08-01',
            tableCode: 'A 1',
            tableChoice: 'Full Table',
            section: 'A',
            location: 'North Wing',
            checkedInAt: null,
          },
        ],
      }),
    );
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('You have a table');
    expect(wrapper.get('[data-testid="vendor-page-seats"]').text()).toContain('North Wing');
  });

  it('is asked for an email address again after Sign out', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(application());
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-sign-out-btn"]').trigger('click');
    await flushPromises();

    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(useApplicationStore().application).toBeNull();
  });

  it('asks for sign-in again when the sign-in has ended', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockRejectedValue({ response: { status: 401 } });
    const wrapper = await mountPage();

    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toContain('expired');
  });

  it('says the page could not be loaded when their own read never answered', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockRejectedValue(new Error('Network Error'));
    const wrapper = await mountPage();

    expect(has(wrapper, 'vendor-page-load-failed')).toBe(true);
    expect(has(wrapper, 'vendor-page-info')).toBe(false);
  });
});

/** A refusal as the server sends one: a status and its sentence. */
function refusal(status: number, error: string): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { data: { error }, status, statusText: '', headers: {}, config };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
}

describe("a Google Form market's page (ADR 0022)", () => {
  beforeEach(signIn);

  const imported = () =>
    pageOf({
      intakeMode: IntakeMode.Csv,
      phase: MarketPhase.Assignment,
      takesApplications: false,
      resultsPublished: true,
    });
  const SEAT = {
    date: '2099-08-01',
    tableCode: 'A 1',
    tableChoice: 'Full Table',
    section: 'A',
    location: 'North Wing',
    checkedInAt: null,
  };

  it('reads an imported vendor their table, and no application', async () => {
    fetchVendorPage.mockResolvedValue(imported());
    fetchApplicantApplication.mockResolvedValue(
      application({ formData: undefined, outcome: 'has_a_table', seats: [SEAT] }),
    );
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('You have a table');
    expect(wrapper.get('[data-testid="vendor-page-seats"]').text()).toContain('North Wing');
    expect(has(wrapper, 'vendor-page-answers')).toBe(false);
    expect(has(wrapper, 'vendor-page-apply-btn')).toBe(false);
    expect(has(wrapper, 'vendor-page-info')).toBe(false);
    // Nobody fills its form in, so the page never asks for one.
    expect(fetchPublicApplicationForm).not.toHaveBeenCalled();
  });

  it('reads one without a seat that they did not get assigned', async () => {
    fetchVendorPage.mockResolvedValue(imported());
    fetchApplicantApplication.mockResolvedValue(
      application({ formData: undefined, outcome: 'not_assigned' }),
    );
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain(
      'You did not get assigned',
    );
  });

  it('tells an address with no vendor there to use the one their form response gave', async () => {
    fetchVendorPage.mockResolvedValue(imported());
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-no-vendor"]').text()).toBe(
      "There's no application from this address at Spring Market. Use the address you gave on the market's form, or ask the organizer.",
    );
    expect(wrapper.get('[data-testid="vendor-page-no-vendor"]').text()).toBe(
      noVendorAtThisAddress('Spring Market'),
    );
    expect(has(wrapper, 'vendor-page-status')).toBe(false);
    expect(has(wrapper, 'vendor-page-sign-out-btn')).toBe(true);
  });

  it('never says it on a market whose vendors apply on its page', async () => {
    fetchVendorPage.mockResolvedValue(pageOf({ takesApplications: false }));
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    expect(has(wrapper, 'vendor-page-no-vendor')).toBe(false);
  });
});

describe('applying and editing on the page', () => {
  beforeEach(signIn);

  it('opens the form in place on Apply, saves it, and reads Submitted with the answers', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const saved = application({
      formData: { essential_full_name: 'Ada Newcomer', business_name: 'Newcomer Prints' },
      vendorName: 'Ada Newcomer',
    });
    saveApplicantApplication.mockResolvedValue(saved);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    expect(has(wrapper, 'apply-form')).toBe(true);
    expect(has(wrapper, 'vendor-page-info')).toBe(false);

    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(saveApplicantApplication).toHaveBeenCalledWith(
      'spring-market',
      'a-token',
      expect.objectContaining({
        essential_full_name: 'Ada Newcomer',
        business_name: 'Newcomer Prints',
      }),
    );
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('Submitted');
    expect(wrapper.get('[data-testid="vendor-page-answer-business_name"]').text()).toContain(
      'Newcomer Prints',
    );
    expect(has(wrapper, 'vendor-page-edit-btn')).toBe(true);
  });

  it('saves nothing while a required answer is missing, and says which', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(saveApplicantApplication).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="apply-form"]').text()).toContain('Business name');
    expect(wrapper.text()).toContain('is required');
  });

  it('opens Edit on the answers the vendor saved (bug 21), and changes them', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(
      application({
        formData: { essential_full_name: 'Riley Fixture', business_name: 'Fixture Ceramics' },
      }),
    );
    saveApplicantApplication.mockImplementation(
      async (_slug: string, _token: string, formData: Record<string, unknown>) =>
        application({ formData }),
    );
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-edit-btn"]').trigger('click');
    const name = wrapper.get<HTMLInputElement>('[data-testid="apply-essential-full-name-input"]');
    const business = wrapper.get<HTMLInputElement>('[data-testid="apply-input-business_name"]');
    expect(name.element.value).toBe('Riley Fixture');
    expect(business.element.value).toBe('Fixture Ceramics');

    await business.setValue('Fixture Pottery');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(saveApplicantApplication).toHaveBeenCalledWith(
      'spring-market',
      'a-token',
      expect.objectContaining({ business_name: 'Fixture Pottery' }),
    );
    expect(wrapper.get('[data-testid="vendor-page-answer-business_name"]').text()).toContain(
      'Fixture Pottery',
    );
  });

  it('leaves the saved answers as they were on Cancel', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(
      application({
        formData: { essential_full_name: 'Riley Fixture', business_name: 'Fixture Ceramics' },
      }),
    );
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-edit-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Never saved');
    await wrapper.get('[data-testid="apply-cancel-button"]').trigger('click');

    expect(saveApplicantApplication).not.toHaveBeenCalled();
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-answer-business_name"]').text()).toContain(
      'Fixture Ceramics',
    );

    await wrapper.get('[data-testid="vendor-page-edit-btn"]').trigger('click');
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="apply-input-business_name"]').element.value,
    ).toBe('Fixture Ceramics');
  });

  it("shows a refused save's message in the section and keeps what was typed", async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockRejectedValue(
      refusal(403, 'Applications are no longer open for this market.'),
    );
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="apply-error"]').text()).toBe(
      'Applications are no longer open for this market.',
    );
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="apply-input-business_name"]').element.value,
    ).toBe('Newcomer Prints');
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="apply-essential-full-name-input"]').element
        .value,
    ).toBe('Ada Newcomer');
    expect(has(wrapper, 'vendor-page-status')).toBe(false);
  });

  it('says a save was refused when the server gave no reason', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockRejectedValue(refusal(409, ''));
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="apply-error"]').text()).toBe(
      'Your application could not be saved. Please try again.',
    );
  });

  it('asks for sign-in again when the sign-in ended before the save', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockRejectedValue(refusal(401, ''));
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toContain('expired');
  });

  it('says so when the market asks nothing yet', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    fetchPublicApplicationForm.mockResolvedValue({
      marketName: 'Spring Market',
      fields: [],
      essentialOptions: EMPTY_ESSENTIAL_OPTIONS,
      phaseLabel: 'Applications',
      isOpen: true,
      failed: false,
      notFound: false,
    });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');

    expect(wrapper.get('[data-testid="apply-no-form"]').text()).toContain(
      'does not have an application form yet',
    );
    expect(has(wrapper, 'apply-submit-button')).toBe(false);
  });
});

describe('Remember me on this device (ADR 0022)', () => {
  const SIGNED_IN = {
    success: true,
    marketId: 'market-1',
    applicantEmail: 'vendor@example.com',
    token: 'a-token',
  };

  async function atTheCodeStep(page = pageOf()) {
    fetchVendorPage.mockResolvedValue(page);
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    const wrapper = await mountPage();
    await wrapper.get('[data-testid="vendor-sign-in-email-input"]').setValue('vendor@example.com');
    await wrapper.get('[data-testid="vendor-sign-in-email-step"]').trigger('submit');
    await flushPromises();
    return wrapper;
  }

  async function enterTheCode(wrapper: Awaited<ReturnType<typeof mountPage>>) {
    await wrapper.get('[data-testid="vendor-sign-in-code-input"]').setValue('123456');
    await wrapper.get('[data-testid="vendor-sign-in-code-step"]').trigger('submit');
    await flushPromises();
  }

  it('is offered unticked beside the code, saying until when', async () => {
    const wrapper = await atTheCodeStep(pageOf({ rememberUntil: '2099-08-01' }));

    const box = wrapper.get<HTMLInputElement>('[data-testid="vendor-sign-in-remember-me"]');
    expect(box.element.checked).toBe(false);
    expect(wrapper.get('[data-testid="vendor-sign-in-code-step"]').text()).toContain(
      'Remember me on this device until Aug 1, 2099',
    );
  });

  it('is not offered once the market has no date left', async () => {
    const wrapper = await atTheCodeStep(pageOf({ rememberUntil: null }));

    expect(has(wrapper, 'vendor-sign-in-remember-me')).toBe(false);
  });

  it.each([
    [true, 'ticked'],
    [false, 'left unticked'],
  ])('sends the choice with the code when %s (%s)', async (ticked) => {
    const wrapper = await atTheCodeStep();
    verifyLoginCode.mockResolvedValue(SIGNED_IN);
    fetchApplicantApplication.mockResolvedValue(application());
    if (ticked) await wrapper.get('[data-testid="vendor-sign-in-remember-me"]').setValue(true);

    await enterTheCode(wrapper);

    expect(verifyLoginCode).toHaveBeenCalledWith(
      'spring-market',
      'vendor@example.com',
      '123456',
      ticked,
    );
  });

  it('signs a remembered vendor straight in, with no code, and keeps it to this tab', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    resumeSignIn.mockResolvedValue({ ...SIGNED_IN, token: 'a-resumed-token' });
    fetchApplicantApplication.mockResolvedValue(application());

    const wrapper = await mountPage();

    expect(resumeSignIn).toHaveBeenCalledTimes(1);
    expect(resumeSignIn).toHaveBeenCalledWith('spring-market');
    expect(fetchApplicantApplication).toHaveBeenCalledWith('spring-market', 'a-resumed-token');
    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('Submitted');
    expect(has(wrapper, 'vendor-sign-in')).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}').token).toBe('a-resumed-token');
  });

  it.each([
    ['nothing to resume', () => unauthorized()],
    ['no answer at all', () => new AxiosError('Network Error', 'ERR_NETWORK')],
  ])('shows the sign-in on %s', async (_case, failure) => {
    fetchVendorPage.mockResolvedValue(pageOf());
    resumeSignIn.mockRejectedValue(failure());

    const wrapper = await mountPage();

    expect(resumeSignIn).toHaveBeenCalledTimes(1);
    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(has(wrapper, 'vendor-sign-in-error')).toBe(false);
    expect(has(wrapper, 'vendor-page-load-failed')).toBe(false);
  });

  it('is not asked in a tab already signed in', async () => {
    signIn();
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(application());

    await mountPage();

    expect(resumeSignIn).not.toHaveBeenCalled();
  });

  it('is not asked where there is no vendor page', async () => {
    fetchVendorPage.mockResolvedValue(NOT_FOUND);

    await mountPage();

    expect(resumeSignIn).not.toHaveBeenCalled();
  });

  it('is ended on the server by Sign out', async () => {
    signIn();
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(application());
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-sign-out-btn"]').trigger('click');
    await flushPromises();

    expect(endRememberedSignIn).toHaveBeenCalledWith('spring-market');
    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
  });

  it('keeps them signed in, and says so, when Sign out could not reach the server', async () => {
    signIn();
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(application());
    endRememberedSignIn.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-sign-out-btn"]').trigger('click');
    await flushPromises();

    expect(has(wrapper, 'vendor-page-status')).toBe(true);
    expect(wrapper.get('[data-testid="vendor-page-sign-out-error"]').text()).toBe(
      'You could not be signed out. Check your connection and try again.',
    );
  });
});
