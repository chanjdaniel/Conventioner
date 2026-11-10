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
  CHECK_IN_ENDED,
  CHECK_IN_NOT_YET,
  checkInSection,
  NO_TABLE_TODAY,
  scannedCodeRefusal,
  hasVendorPage,
  NO_APPLICATION_CLOSED,
  noVendorAtThisAddress,
  sharesVendorPage,
  statusHeadline,
  type VendorPageInfo,
  type VendorPageRead,
} from '@/utils/vendorPage';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';
import { calendarToday } from '@/utils/marketGuide';
import { normalizedDoorCode } from '@/utils/doorCode';
import { standsApart } from '@/utils/currentPlace';

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
const checkInWithDoorCode = vi.fn();
const undoOwnCheckIn = vi.fn();
vi.mock('@/utils/applicantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/applicantApi')>()),
  fetchApplicantApplication: (...args: unknown[]) => fetchApplicantApplication(...args),
  saveApplicantApplication: (...args: unknown[]) => saveApplicantApplication(...args),
  requestLoginCode: (...args: unknown[]) => requestLoginCode(...args),
  verifyLoginCode: (...args: unknown[]) => verifyLoginCode(...args),
  resumeSignIn: (...args: unknown[]) => resumeSignIn(...args),
  endRememberedSignIn: (...args: unknown[]) => endRememberedSignIn(...args),
  checkInWithDoorCode: (...args: unknown[]) => checkInWithDoorCode(...args),
  undoOwnCheckIn: (...args: unknown[]) => undoOwnCheckIn(...args),
}));

const fetchPublicApplicationForm = vi.fn();
vi.mock('@/utils/publicApplicationForm', () => ({
  fetchPublicApplicationForm: (slug: string) => fetchPublicApplicationForm(slug),
}));

/** The page's address: its slug, and a query a test may set, which `replace` changes. */
const routing = vi.hoisted(() => {
  const at = { query: {} as Record<string, string> };
  return {
    at,
    /** The route the page reads, reactive as the router's is; set by the mock below. */
    route: null as unknown as { params: Record<string, string> },
    replace: vi.fn((to: { query: Record<string, string> }) => {
      at.query = to.query;
    }),
  };
});
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  routing.route = reactive({
    params: { marketSlug: 'spring-market' } as Record<string, string>,
    get query() {
      return routing.at.query;
    },
    hash: '',
  });
  return {
    useRoute: () => routing.route,
    useRouter: () => ({ push: vi.fn(), replace: routing.replace }),
  };
});

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
  routing.at.query = {};
  routing.route.params = { marketSlug: 'spring-market' };
  routing.replace.mockClear();
  checkInWithDoorCode.mockReset();
  undoOwnCheckIn.mockReset();
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

/**
 * The page tells the app bar when its slug answered "Page not found" (T260), and takes that back
 * when it goes: by the slug it answered for, since by its unmount the route is already the next.
 */
describe('what the page tells the app bar', () => {
  const vendorPage = (marketSlug: string) =>
    standsApart({
      matched: [{ meta: { vendorFacing: true } }],
      params: { marketSlug },
    } as unknown as Parameters<typeof standsApart>[0]);

  it('says its slug answered "Page not found"', async () => {
    fetchVendorPage.mockResolvedValue(NOT_FOUND);
    const wrapper = await mountPage();

    expect(vendorPage('spring-market')).toBe(false);
    wrapper.unmount();
  });

  it('takes it back when it goes to another page, so that slug reads as a vendor page again', async () => {
    fetchVendorPage.mockResolvedValue(NOT_FOUND);
    const wrapper = await mountPage();

    // Its own Markets button: the route is /markets before the page unmounts.
    routing.route.params = {};
    wrapper.unmount();

    expect(vendorPage('spring-market')).toBe(true);
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
    expect(wrapper.get('[data-testid="vendor-page-submitted-at"]').text()).toBe(
      'Submitted Jun 1, 2099',
    );
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
    // They submitted nothing here: the date is when the organizer's import stored their row.
    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).not.toContain('Submitted');
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

/** "Your session has expired" as a save that met it says, the answers kept to be sent. */
const AFTER_SIGN_IN = 'Your session has expired. Sign in again, and your answers will be saved.';

/** Sign in on the page that is open, through its steps, with a code the mocks pass. */
async function signInWithACode(
  wrapper: Awaited<ReturnType<typeof mountPage>>,
  email = 'vendor@example.com',
) {
  await wrapper.get('[data-testid="vendor-sign-in-email-input"]').setValue(email);
  await wrapper.get('[data-testid="vendor-sign-in-email-step"]').trigger('submit');
  await flushPromises();
  await wrapper.get('[data-testid="vendor-sign-in-code-input"]').setValue('123456');
  await wrapper.get('[data-testid="vendor-sign-in-code-step"]').trigger('submit');
  await flushPromises();
}

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

  it('asks for sign-in again when the sign-in ended before the save, and sends it after', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockRejectedValueOnce(refusal(401, ''));
    saveApplicantApplication.mockImplementation(
      async (_slug: string, _token: string, formData: Record<string, unknown>) =>
        application({ formData, vendorName: 'Ada Newcomer' }),
    );
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    verifyLoginCode.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-new-token',
    });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toBe(AFTER_SIGN_IN);

    await signInWithACode(wrapper);

    // The answers come back and are sent once, with the new sign-in and no second press.
    expect(saveApplicantApplication).toHaveBeenCalledTimes(2);
    expect(saveApplicantApplication).toHaveBeenLastCalledWith(
      'spring-market',
      'a-new-token',
      expect.objectContaining({
        essential_full_name: 'Ada Newcomer',
        business_name: 'Newcomer Prints',
      }),
    );
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-answers"]').text()).toContain('Newcomer Prints');
    expect(keptDraft()).toBeNull();
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

const DRAFT_KEY = 'conventioner.applicationDraft';
const RESTORED = 'Your unsaved answers are back. They reach the market when you save.';

/** The answers kept in this tab, as the page would find them after a reload. */
function keptDraft(): Record<string, unknown> | null {
  return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Record<string, unknown> | null;
}

function keepDraftFor(
  formData: Record<string, unknown>,
  {
    marketSlug = 'spring-market',
    applicantEmail = 'vendor@example.com',
    saveAfterSignIn = false,
  } = {},
) {
  sessionStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({ marketSlug, applicantEmail, formData, saveAfterSignIn }),
  );
}

const valueOf = (wrapper: Awaited<ReturnType<typeof mountPage>>, testid: string) =>
  wrapper.get<HTMLInputElement>(`[data-testid="${testid}"]`).element.value;

describe('answers typed and not saved survive a reload (T271)', () => {
  beforeEach(signIn);

  it('keeps them in the tab as they are typed, and lets them go when they match again', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    expect(keptDraft()).toBeNull();

    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await flushPromises();
    expect(keptDraft()).toEqual({
      marketSlug: 'spring-market',
      applicantEmail: 'vendor@example.com',
      formData: expect.objectContaining({
        essential_full_name: 'Ada Newcomer',
        business_name: 'Newcomer Prints',
      }),
      saveAfterSignIn: false,
    });

    await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('');
    await wrapper.get('[data-testid="apply-input-business_name"]').setValue('');
    await flushPromises();
    expect(keptDraft()).toBeNull();
  });

  it('reopens Apply by itself on them after a reload, saying they are back', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const first = await mountPage();
    await first.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await first.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
    await first.get('[data-testid="apply-input-business_name"]').setValue('Newcomer Prints');
    await flushPromises();
    first.unmount();

    const wrapper = await mountPage();

    expect(has(wrapper, 'apply-form')).toBe(true);
    expect(has(wrapper, 'vendor-page-info')).toBe(false);
    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('Ada Newcomer');
    expect(valueOf(wrapper, 'apply-input-business_name')).toBe('Newcomer Prints');
    expect(wrapper.get('[data-testid="apply-draft-restored"]').text()).toBe(RESTORED);
  });

  it('reopens Edit on the change over the saved answers, the rest as saved', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(
      application({
        formData: { essential_full_name: 'Riley Fixture', business_name: 'Fixture Ceramics' },
      }),
    );
    keepDraftFor({ essential_full_name: 'Riley Fixture', business_name: 'Fixture Pottery' });

    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-page-form"] h2').text()).toBe('Edit your answers');
    expect(valueOf(wrapper, 'apply-input-business_name')).toBe('Fixture Pottery');
    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('Riley Fixture');
    expect(wrapper.get('[data-testid="apply-draft-restored"]').text()).toBe(RESTORED);
  });

  it('never shows the note on a form opened with nothing kept', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');

    expect(has(wrapper, 'apply-form')).toBe(true);
    expect(has(wrapper, 'apply-draft-restored')).toBe(false);
  });

  it('lets them go once the server takes the save', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockImplementation(
      async (_slug: string, _token: string, formData: Record<string, unknown>) =>
        application({ formData }),
    );
    keepDraftFor({ essential_full_name: 'Ada Newcomer', business_name: 'Newcomer Prints' });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(keptDraft()).toBeNull();
  });

  it('keeps them through a save the server refuses', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockRejectedValue(refusal(409, ''));
    keepDraftFor({ essential_full_name: 'Ada Newcomer', business_name: 'Newcomer Prints' });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(has(wrapper, 'apply-error')).toBe(true);
    expect(keptDraft()).not.toBeNull();
  });

  it('lets them go on Cancel, and Apply opens empty', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    keepDraftFor({ essential_full_name: 'Ada Newcomer' });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="apply-cancel-button"]').trigger('click');
    expect(keptDraft()).toBeNull();
    expect(has(wrapper, 'apply-form')).toBe(false);

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('');
    expect(has(wrapper, 'apply-draft-restored')).toBe(false);
  });

  it('lets them go on Sign out before its request, even one that never answers', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    keepDraftFor({ essential_full_name: 'Ada Newcomer' });
    let draftAtRequest: unknown = 'not asked';
    endRememberedSignIn.mockImplementation(async () => {
      draftAtRequest = keptDraft();
      throw new Error('Network Error');
    });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-sign-out-btn"]').trigger('click');
    await flushPromises();

    expect(draftAtRequest).toBeNull();
    expect(keptDraft()).toBeNull();
    expect(has(wrapper, 'vendor-page-sign-out-error')).toBe(true);
  });

  it('lets them go when the same tab signs in to their market as another address', async () => {
    sessionStorage.removeItem(SESSION_KEY);
    keepDraftFor({ essential_full_name: 'Someone Else' }, { applicantEmail: 'other@example.com' });
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    verifyLoginCode.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-token',
    });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-sign-in-email-input"]').setValue('vendor@example.com');
    await wrapper.get('[data-testid="vendor-sign-in-email-step"]').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-testid="vendor-sign-in-code-input"]').setValue('123456');
    await wrapper.get('[data-testid="vendor-sign-in-code-step"]').trigger('submit');
    await flushPromises();

    expect(keptDraft()).toBeNull();
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-info"]').text()).toContain(
      'You have not applied to this market yet.',
    );
  });

  it('opens them when the same address signs in again on the tab', async () => {
    sessionStorage.removeItem(SESSION_KEY);
    keepDraftFor({ essential_full_name: 'Ada Newcomer' });
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    resumeSignIn.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-token',
    });
    const wrapper = await mountPage();

    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('Ada Newcomer');
    expect(has(wrapper, 'apply-draft-restored')).toBe(true);
  });

  it("never opens another address's on this tab's sign-in", async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    keepDraftFor({ essential_full_name: 'Someone Else' }, { applicantEmail: 'other@example.com' });
    const wrapper = await mountPage();

    expect(has(wrapper, 'apply-form')).toBe(false);
    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('');
    expect(has(wrapper, 'apply-draft-restored')).toBe(false);
  });

  it("never opens another market's, and leaves it kept", async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    keepDraftFor({ essential_full_name: 'Ada Elsewhere' }, { marketSlug: 'autumn-market' });
    const wrapper = await mountPage();

    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(has(wrapper, 'vendor-page-apply-btn')).toBe(true);

    await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
    await wrapper.get('[data-testid="apply-cancel-button"]').trigger('click');
    expect(keptDraft()).toMatchObject({ marketSlug: 'autumn-market' });
  });

  it('lets them go once the market no longer takes applications, which the section says', async () => {
    fetchVendorPage.mockResolvedValue(pageOf({ takesApplications: false }));
    fetchApplicantApplication.mockResolvedValue(null);
    keepDraftFor({ essential_full_name: 'Ada Newcomer' });
    const wrapper = await mountPage();

    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-info"]').text()).toBe(NO_APPLICATION_CLOSED);
    expect(keptDraft()).toBeNull();
  });

  it('lets them go for a vendor whose answers now read only', async () => {
    fetchVendorPage.mockResolvedValue(pageOf({ takesApplications: false }));
    fetchApplicantApplication.mockResolvedValue(application());
    keepDraftFor({ essential_full_name: 'Riley Changed' });
    const wrapper = await mountPage();

    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(has(wrapper, 'vendor-page-answers')).toBe(true);
    expect(has(wrapper, 'vendor-page-edit-btn')).toBe(false);
    expect(keptDraft()).toBeNull();
  });

  it('keeps the form working, for the page, when the tab cannot store anything', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    const wrapper = await mountPage();
    const setItem = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      await wrapper.get('[data-testid="vendor-page-apply-btn"]').trigger('click');
      await wrapper.get('[data-testid="apply-essential-full-name-input"]').setValue('Ada Newcomer');
      await flushPromises();

      expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('Ada Newcomer');
      expect(keptDraft()).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('a save that met an ended sign-in is sent after the next sign-in (T271)', () => {
  beforeEach(signIn);

  const ANSWERS = { essential_full_name: 'Ada Newcomer', business_name: 'Newcomer Prints' };

  it('keeps the answers to send, and clears the sign-in, when the device cannot renew it', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockRejectedValue(refusal(401, ''));
    keepDraftFor(ANSWERS);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(resumeSignIn).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(keptDraft()).toEqual({
      marketSlug: 'spring-market',
      applicantEmail: 'vendor@example.com',
      formData: expect.objectContaining(ANSWERS),
      saveAfterSignIn: true,
    });
    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toBe(AFTER_SIGN_IN);
  });

  it('keeps the answers sent even when none were kept, as an Edit saved unchanged is', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(application({ formData: ANSWERS }));
    saveApplicantApplication.mockRejectedValue(refusal(401, ''));
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-page-edit-btn"]').trigger('click');
    expect(keptDraft()).toBeNull();
    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(keptDraft()).toMatchObject({ formData: ANSWERS, saveAfterSignIn: true });
  });

  it('sends nothing more after a save a remembered device renewed', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    resumeSignIn.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-renewed-token',
    });
    saveApplicantApplication.mockRejectedValueOnce(refusal(401, ''));
    saveApplicantApplication.mockImplementation(
      async (_slug: string, _token: string, formData: Record<string, unknown>) =>
        application({ formData }),
    );
    keepDraftFor(ANSWERS);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="apply-form"]').trigger('submit');
    await flushPromises();

    expect(saveApplicantApplication).toHaveBeenCalledTimes(2);
    expect(saveApplicantApplication).toHaveBeenLastCalledWith(
      'spring-market',
      'a-renewed-token',
      expect.objectContaining(ANSWERS),
    );
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(keptDraft()).toBeNull();
  });

  it('opens the form on them after the sign-in and sends the save once by itself', async () => {
    sessionStorage.removeItem(SESSION_KEY);
    keepDraftFor(ANSWERS, { saveAfterSignIn: true });
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    saveApplicantApplication.mockImplementation(
      async (_slug: string, _token: string, formData: Record<string, unknown>) =>
        application({ formData }),
    );
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    verifyLoginCode.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-token',
    });
    const wrapper = await mountPage();
    expect(saveApplicantApplication).not.toHaveBeenCalled();

    await signInWithACode(wrapper);

    expect(saveApplicantApplication).toHaveBeenCalledTimes(1);
    expect(saveApplicantApplication).toHaveBeenCalledWith(
      'spring-market',
      'a-token',
      expect.objectContaining(ANSWERS),
    );
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-answers"]').text()).toContain('Newcomer Prints');
    expect(keptDraft()).toBeNull();
  });

  it('shows a refusal in the form, every answer kept, and never sends it again', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    // The flag is cleared before the save is out, so a reload while it waits never sends twice.
    let keptAtRequest: Record<string, unknown> | null = null;
    saveApplicantApplication.mockImplementation(async () => {
      keptAtRequest = keptDraft();
      throw refusal(409, 'Applications are closed for this market.');
    });
    keepDraftFor(ANSWERS, { saveAfterSignIn: true });
    const wrapper = await mountPage();

    expect(saveApplicantApplication).toHaveBeenCalledTimes(1);
    expect(keptAtRequest).toMatchObject({ formData: ANSWERS, saveAfterSignIn: false });
    expect(wrapper.get('[data-testid="apply-error"]').text()).toBe(
      'Applications are closed for this market.',
    );
    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('Ada Newcomer');
    expect(valueOf(wrapper, 'apply-input-business_name')).toBe('Newcomer Prints');
    expect(keptDraft()).toMatchObject({ formData: ANSWERS, saveAfterSignIn: false });

    // A reload opens the form on them again, and sends nothing until they press Save.
    wrapper.unmount();
    const again = await mountPage();
    expect(has(again, 'apply-form')).toBe(true);
    expect(valueOf(again, 'apply-input-business_name')).toBe('Newcomer Prints');
    expect(saveApplicantApplication).toHaveBeenCalledTimes(1);
  });

  it('shows a question left unanswered under it, and sends nothing', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    keepDraftFor({ essential_full_name: 'Ada Newcomer' }, { saveAfterSignIn: true });
    const wrapper = await mountPage();

    expect(saveApplicantApplication).not.toHaveBeenCalled();
    expect(has(wrapper, 'apply-form')).toBe(true);
    expect(wrapper.get('[data-testid="apply-error-business_name"]').text()).not.toBe('');
    expect(valueOf(wrapper, 'apply-essential-full-name-input')).toBe('Ada Newcomer');
    expect(keptDraft()).toMatchObject({ saveAfterSignIn: false });
  });

  it('never sends them for another address signing in on the tab, and drops them', async () => {
    sessionStorage.removeItem(SESSION_KEY);
    keepDraftFor(ANSWERS, { saveAfterSignIn: true });
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockResolvedValue(null);
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    verifyLoginCode.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'other@example.com',
      token: 'a-token',
    });
    const wrapper = await mountPage();

    await signInWithACode(wrapper, 'other@example.com');

    expect(saveApplicantApplication).not.toHaveBeenCalled();
    expect(keptDraft()).toBeNull();
    expect(has(wrapper, 'apply-form')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-info"]').text()).toContain(
      'You have not applied to this market yet.',
    );
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

// ── Check-in on the vendor page (ADR 0022) ───────────────────────────────────

const TODAY = calendarToday();
const ANOTHER_DAY = '2099-08-02';
const DOOR_CODE = 'K7M4QP';
const DOOR_KEY = 'conventioner.doorCode';

function seat(date: string, checkedInAt: string | null = null) {
  return {
    date,
    tableCode: 'A 1',
    tableChoice: 'Full Table',
    section: 'A',
    location: 'North Wing',
    checkedInAt,
  };
}

const onItsDays = (overrides: Partial<VendorPageInfo> = {}) =>
  pageOf({
    phase: MarketPhase.MarketDays,
    takesApplications: false,
    resultsPublished: true,
    marketDates: [TODAY, ANOTHER_DAY].sort(),
    ...overrides,
  });

const seated = (...seats: ReturnType<typeof seat>[]) =>
  application({ outcome: 'has_a_table', seats });

describe('what the check-in section shows', () => {
  const days = { phase: MarketPhase.MarketDays, ended: false };
  const app = { seats: [seat(ANOTHER_DAY), seat(TODAY)] };

  it("puts today's seat on top, and the other days below, on the market's days", () => {
    const section = checkInSection(days, app, TODAY);
    expect(section.mode).toBe('door');
    expect(section.today?.date).toBe(TODAY);
    expect(section.others.map((s) => s.date)).toEqual([ANOTHER_DAY]);
  });

  it('has no seat today for a vendor seated on other days only', () => {
    expect(checkInSection(days, { seats: [seat(ANOTHER_DAY)] }, TODAY).today).toBeNull();
  });

  it('is the record once the market has ended after running', () => {
    const section = checkInSection({ phase: MarketPhase.Archived, ended: true }, app, TODAY);
    expect(section.mode).toBe('record');
    expect(section.others).toHaveLength(2);
  });

  it.each([MarketPhase.Assignment, MarketPhase.Archived])('is nothing in %s', (phase) => {
    expect(checkInSection({ phase, ended: false }, app, TODAY).mode).toBe('none');
  });

  it('is nothing without a seat', () => {
    expect(checkInSection(days, { seats: [] }, TODAY).mode).toBe('none');
  });

  it.each([
    [MarketPhase.Assignment, [seat(TODAY)], CHECK_IN_NOT_YET],
    [MarketPhase.Archived, [seat(TODAY)], CHECK_IN_ENDED],
    [MarketPhase.MarketDays, [seat(ANOTHER_DAY)], NO_TABLE_TODAY],
    [MarketPhase.MarketDays, [seat(TODAY)], null],
  ])('answers a code scanned in %s with %s', (phase, seats, expected) => {
    expect(scannedCodeRefusal({ phase }, { seats }, TODAY)).toBe(expected);
  });

  it.each(['k7m4qp', 'K7M 4QP', 'k7m-4qp', ' K7M4QP '])(
    'reads %s as the poster prints it',
    (typed) => {
      expect(normalizedDoorCode(typed)).toBe(DOOR_CODE);
    },
  );
});

describe("checking in on the market's days", () => {
  beforeEach(signIn);

  it("offers today's seat with a field for the door code, and the other days below", async () => {
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY), seat(ANOTHER_DAY)));
    const wrapper = await mountPage();

    const today = wrapper.get('[data-testid="vendor-check-in-today"]');
    expect(today.text()).toContain('Today');
    expect(today.text()).toContain('North Wing');
    expect(has(wrapper, 'vendor-check-in-code-input')).toBe(true);
    expect(wrapper.get('[data-testid="vendor-check-in-other-days"]').text()).toContain(
      'August 2, 2099',
    );
    // Said once, in the section, not again under the outcome.
    expect(has(wrapper, 'vendor-page-seats')).toBe(false);
    expect(wrapper.get('[data-testid="vendor-page-status"]').text()).toContain('You have a table');
  });

  it('checks them in with a typed code, then offers Undo', async () => {
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY)));
    checkInWithDoorCode.mockResolvedValue({ checkedInAt: `${TODAY}T09:41:00+00:00` });
    const wrapper = await mountPage();

    const button = wrapper.get('[data-testid="vendor-check-in-btn"]');
    expect(button.attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="vendor-check-in-code-input"]').setValue('k7m 4qp');
    expect(button.attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="vendor-check-in-form"]').trigger('submit');
    await flushPromises();

    expect(checkInWithDoorCode).toHaveBeenCalledWith('spring-market', 'a-token', TODAY, 'k7m 4qp');
    expect(wrapper.get('[data-testid="vendor-check-in-done"]').text()).toContain('Checked in at');
    expect(has(wrapper, 'vendor-check-in-form')).toBe(false);

    undoOwnCheckIn.mockResolvedValue(undefined);
    await wrapper.get('[data-testid="vendor-check-in-undo-btn"]').trigger('click');
    await flushPromises();

    expect(undoOwnCheckIn).toHaveBeenCalledWith('spring-market', 'a-token', TODAY);
    expect(has(wrapper, 'vendor-check-in-form')).toBe(true);
  });

  it('says a wrong door code is wrong, and keeps the field', async () => {
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY)));
    const wrong = "That isn't this market's door code. Check it, or ask at the door.";
    checkInWithDoorCode.mockRejectedValue(refusal(403, wrong));
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-check-in-code-input"]').setValue('ZZZZZZ');
    await wrapper.get('[data-testid="vendor-check-in-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="vendor-check-in-error"]').text()).toBe(wrong);
    expect(has(wrapper, 'vendor-check-in-code-input')).toBe(true);
  });

  it('works on a Google Form market too', async () => {
    fetchVendorPage.mockResolvedValue(onItsDays({ intakeMode: IntakeMode.Csv }));
    fetchApplicantApplication.mockResolvedValue({ ...seated(seat(TODAY)), formData: undefined });
    checkInWithDoorCode.mockResolvedValue({ checkedInAt: `${TODAY}T09:41:00+00:00` });
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-check-in-code-input"]').setValue(DOOR_CODE);
    await wrapper.get('[data-testid="vendor-check-in-form"]').trigger('submit');
    await flushPromises();

    expect(has(wrapper, 'vendor-check-in-done')).toBe(true);
  });

  it("says they have no table today, and offers no check-in, when they don't", async () => {
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(ANOTHER_DAY)));
    const wrapper = await mountPage();

    expect(has(wrapper, 'vendor-check-in-today')).toBe(false);
    expect(has(wrapper, 'vendor-check-in-other-days')).toBe(true);
  });
});

describe('the door code scanned at the entrance', () => {
  it('is kept through the sign-in, taken off the address, and checks them in for today', async () => {
    routing.at.query = { door: DOOR_CODE };
    fetchVendorPage.mockResolvedValue(onItsDays());
    requestLoginCode.mockResolvedValue({ message: "We've sent a code to this address." });
    verifyLoginCode.mockResolvedValue({
      success: true,
      marketId: 'market-1',
      applicantEmail: 'vendor@example.com',
      token: 'a-token',
    });
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY)));
    checkInWithDoorCode.mockResolvedValue({ checkedInAt: `${TODAY}T09:41:00+00:00` });
    const wrapper = await mountPage();

    expect(routing.replace).toHaveBeenCalledWith({ query: {}, hash: '' });
    expect(wrapper.get('[data-testid="vendor-page-door-held"]').text()).toContain(
      "you'll be checked in for today",
    );
    expect(checkInWithDoorCode).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="vendor-sign-in-email-input"]').setValue('vendor@example.com');
    await wrapper.get('[data-testid="vendor-sign-in-email-step"]').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-testid="vendor-sign-in-code-input"]').setValue('123456');
    await wrapper.get('[data-testid="vendor-sign-in-code-step"]').trigger('submit');
    await flushPromises();

    expect(checkInWithDoorCode).toHaveBeenCalledTimes(1);
    expect(checkInWithDoorCode).toHaveBeenCalledWith('spring-market', 'a-token', TODAY, DOOR_CODE);
    expect(has(wrapper, 'vendor-check-in-done')).toBe(true);
    // Used once: a reload checks nobody in again.
    expect(sessionStorage.getItem(DOOR_KEY)).toBeNull();
  });

  it('checks a signed-in vendor straight in', async () => {
    signIn();
    routing.at.query = { door: DOOR_CODE };
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY)));
    checkInWithDoorCode.mockResolvedValue({ checkedInAt: `${TODAY}T09:41:00+00:00` });
    const wrapper = await mountPage();

    expect(checkInWithDoorCode).toHaveBeenCalledWith('spring-market', 'a-token', TODAY, DOOR_CODE);
    expect(has(wrapper, 'vendor-check-in-done')).toBe(true);
  });

  it.each([
    ['with no table today', onItsDays(), [seat(ANOTHER_DAY)], NO_TABLE_TODAY],
    [
      "before the market's days",
      pageOf({ phase: MarketPhase.Assignment, takesApplications: false, resultsPublished: true }),
      [seat(TODAY)],
      CHECK_IN_NOT_YET,
    ],
  ])('says so, and checks nobody in, %s', async (_name, read, seats, sentence) => {
    signIn();
    routing.at.query = { door: DOOR_CODE };
    fetchVendorPage.mockResolvedValue(read);
    fetchApplicantApplication.mockResolvedValue(seated(...seats));
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="vendor-check-in-notice"]').text()).toBe(sentence);
    expect(checkInWithDoorCode).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(DOOR_KEY)).toBeNull();
  });

  it('sends nothing for a seat already checked in to', async () => {
    signIn();
    routing.at.query = { door: DOOR_CODE };
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY, `${TODAY}T09:41:00+00:00`)));
    const wrapper = await mountPage();

    expect(checkInWithDoorCode).not.toHaveBeenCalled();
    expect(has(wrapper, 'vendor-check-in-done')).toBe(true);
  });

  it('waits through a sign-in that ran out, and is kept for the next one', async () => {
    signIn();
    routing.at.query = { door: DOOR_CODE };
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY)));
    checkInWithDoorCode.mockRejectedValue(unauthorized());
    const wrapper = await mountPage();

    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    expect(has(wrapper, 'vendor-page-door-held')).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(DOOR_KEY) ?? 'null')).toEqual({
      marketSlug: 'spring-market',
      code: DOOR_CODE,
    });
  });
});

describe('the record, once the market has ended', () => {
  beforeEach(signIn);

  it('shows each seat and when they checked in, and no check-in', async () => {
    fetchVendorPage.mockResolvedValue(
      pageOf({ phase: MarketPhase.Archived, ended: true, takesApplications: false }),
    );
    fetchApplicantApplication.mockResolvedValue(
      seated(seat('2099-08-01', '2099-08-01T09:41:00+00:00'), seat('2099-08-02')),
    );
    const wrapper = await mountPage();

    const rows = wrapper.findAll('[data-testid="vendor-check-in-record-seat"]');
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining('Checked in at'),
      expect.stringContaining('Not checked in'),
    ]);
    expect(has(wrapper, 'vendor-check-in-form')).toBe(false);
    expect(has(wrapper, 'vendor-check-in-btn')).toBe(false);
  });
});

describe('a remembered device whose sign-in in this tab has ended (ADR 0022)', () => {
  beforeEach(signIn);

  const RENEWED = {
    success: true,
    marketId: 'market-1',
    applicantEmail: 'vendor@example.com',
    token: 'a-new-token',
  };

  it('is signed straight back in when its own read finds the sign-in ended', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValue(application());
    resumeSignIn.mockResolvedValue(RENEWED);
    const wrapper = await mountPage();

    expect(resumeSignIn).toHaveBeenCalledTimes(1);
    expect(fetchApplicantApplication).toHaveBeenLastCalledWith('spring-market', 'a-new-token');
    expect(has(wrapper, 'vendor-page-answers')).toBe(true);
    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(false);
  });

  it('checks in with the new sign-in when the check-in finds the old one ended', async () => {
    fetchVendorPage.mockResolvedValue(onItsDays());
    fetchApplicantApplication.mockResolvedValue(seated(seat(TODAY)));
    checkInWithDoorCode
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue({ checkedInAt: `${TODAY}T09:41:00+00:00` });
    resumeSignIn.mockResolvedValue(RENEWED);
    const wrapper = await mountPage();

    await wrapper.get('[data-testid="vendor-check-in-code-input"]').setValue(DOOR_CODE);
    await wrapper.get('[data-testid="vendor-check-in-form"]').trigger('submit');
    await flushPromises();

    expect(resumeSignIn).toHaveBeenCalledTimes(1);
    expect(checkInWithDoorCode).toHaveBeenLastCalledWith(
      'spring-market',
      'a-new-token',
      TODAY,
      DOOR_CODE,
    );
    expect(has(wrapper, 'vendor-check-in-done')).toBe(true);
  });

  it('asks for a code, as before, when the device is not remembered', async () => {
    fetchVendorPage.mockResolvedValue(pageOf());
    fetchApplicantApplication.mockRejectedValue({ response: { status: 401 } });
    const wrapper = await mountPage();

    expect(resumeSignIn).toHaveBeenCalledTimes(1);
    expect(has(wrapper, 'vendor-sign-in-email-input')).toBe(true);
    // Not a save: nothing was kept to send, so the sentence promises nothing.
    expect(wrapper.get('[data-testid="vendor-sign-in-error"]').text()).toBe(
      'Your session has expired. Please sign in again.',
    );
  });
});
