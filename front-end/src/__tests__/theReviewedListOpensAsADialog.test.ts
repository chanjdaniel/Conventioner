/**
 * "Show N reviewed" opens a dialog over the card (T217, E38/F10/S01).
 *
 * It used to unfold above the card, every verdict given on one page. In a dialog the card stays
 * where it is, a find field and pages hold a market's hundreds of rows, and a verdict changed there
 * leaves the reviewer in the dialog, on that row, with nothing behind it moved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';

const fetchMarketApplications = vi.fn();
const reviewApplication = vi.fn();
const undoVerdict = vi.fn();
const handOut = vi.fn();

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  const post = async (url: string, body: { want?: string | null }) => {
    if (!url.endsWith('/review/next')) return { data: {} };
    return { data: { application: await handOut(body.want ?? null) } };
  };
  return { ...actual, api: { get: answered, post, put: answered, delete: answered } };
});

vi.mock('@/utils/applicantApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/applicantApi')>();
  return {
    ...actual,
    fetchMarketApplications: (id: string) => fetchMarketApplications(id),
    reviewApplication: (...args: unknown[]) => reviewApplication(...args),
    undoVerdict: (...args: unknown[]) => undoVerdict(...args),
    publishResults: vi.fn(),
  };
});

const CHANGE_REFUSED = 'Only an Admin may change a verdict.';

const MARKET = {
  id: 'm1',
  applicationForm: { fields: [{ key: 'shop', label: 'Shop', type: 'text' }] },
  reviewHighlights: [],
  actionRefusals: { 'give-verdicts': null, 'change-verdicts': null },
} as unknown as Market;

const REFUSING_A_CHANGE = {
  ...MARKET,
  actionRefusals: { 'give-verdicts': null, 'change-verdicts': CHANGE_REFUSED },
} as unknown as Market;

function application(id: string, status = ApplicationStatus.Open, extra = {}): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@example.com`,
    status,
    formData: { shop: `${id}'s shop` },
    submittedAt: '2026-09-15T14:20:18.000Z',
    ...extra,
  } as unknown as Application;
}

const reviewedAt = (minute: number, status = ApplicationStatus.ReviewerRejected, extra = {}) =>
  application(`vendor-${String(minute).padStart(3, '0')}`, status, {
    verdictAt: new Date(Date.UTC(2026, 9, 1, 10, minute)).toISOString(),
    ...extra,
  });

/** `count` reviewed applications; the one at minute `count - 1` is the newest, and leads the list. */
const manyReviewed = (count: number) => Array.from({ length: count }, (_, at) => reviewedAt(at));

describe('Show N reviewed', () => {
  let wrappers: VueWrapper[] = [];
  let list: Application[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    list = [
      application('jane'),
      application('kim'),
      reviewedAt(1, ApplicationStatus.ReviewerApproved, {
        verdictBy: { kind: 'person', email: 'ana@example.com' },
        formData: { essential_preferred_name: 'Ola Fern' },
      }),
      reviewedAt(2, ApplicationStatus.ReviewerRejected, {
        formData: { essential_preferred_name: 'Pat Reed' },
      }),
    ];
    fetchMarketApplications.mockReset();
    fetchMarketApplications.mockImplementation(async () => list.map((app) => ({ ...app })));
    handOut.mockReset();
    handOut.mockImplementation(async (want: string | null) =>
      want
        ? list.find((app) => app.id === want)
        : list.find((app) => app.status === ApplicationStatus.Open),
    );
    reviewApplication.mockReset();
    reviewApplication.mockImplementation(async (_m: string, app: Application, status: string) => {
      const written = { ...app, status, verdictAt: '2026-11-01T10:00:00+00:00' } as Application;
      list = list.map((held) => (held.id === app.id ? written : held));
      return { application: written, undoSeconds: 0 };
    });
    undoVerdict.mockReset();
  });

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount();
    wrappers = [];
    vi.useRealTimers();
  });

  async function monitor(market: Market = MARKET, named?: string) {
    const wrapper = mount(ApplicationMonitor, {
      props: { market, visible: true, named },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
  }

  /** The dialog is teleported out of the wrapper to `body`, as every modal is. */
  const page = () => new DOMWrapper(document.body);
  const byId = (id: string) => page().find(`[data-testid="${id}"]`);
  const allById = (id: string) => page().findAll(`[data-testid="${id}"]`);
  const button = () => byId('app-monitor-decided-open');
  const dialog = () => byId('app-monitor-decided-window');
  const email = () => byId('app-monitor-email').text();
  const rowEmails = () => allById('app-monitor-decided-email').map((address) => address.text());
  const findField = () => byId('app-monitor-decided-list-find');
  const rowOf = (id: string) =>
    allById('app-monitor-decided-row').find(
      (row) => row.get('[data-testid="app-monitor-decided-email"]').text() === `${id}@example.com`,
    )!;
  const focused = () => document.activeElement as HTMLElement;

  async function open() {
    const opener = button();
    (opener.element as HTMLElement).focus();
    await opener.trigger('click');
    await flushPromises();
  }

  async function find(words: string) {
    await findField().setValue(words);
    await flushPromises();
  }

  const press = async (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    await flushPromises();
  };

  describe('the button', () => {
    it('counts the reviewed and is no toggle, before and after opening', async () => {
      await monitor();
      expect(button().text()).toBe('Show 2 reviewed');
      expect(button().attributes('aria-expanded')).toBeUndefined();
      expect(button().attributes('aria-controls')).toBeUndefined();
      expect(dialog().exists()).toBe(false);

      await open();

      expect(button().text()).toBe('Show 2 reviewed');
      expect(page().text()).not.toContain('Hide');
    });

    it('stands before the card, and is not there with nothing reviewed', async () => {
      list = [application('jane')];
      await monitor();
      expect(button().exists()).toBe(false);
    });
  });

  describe('the dialog', () => {
    it('is wide, scrolls its body and is titled "Reviewed applications"', async () => {
      await monitor();
      await open();

      expect(dialog().attributes('aria-label')).toBe('Reviewed applications');
      expect(dialog().classes()).toContain('dialog-window--wide');
      expect(dialog().classes()).toContain('dialog-window--body');
      expect(byId('app-monitor-decided-body').find('[data-testid$="-row"]').exists()).toBe(true);
    });

    it('reads each row as ever: name, address, verdict, giver and the action', async () => {
      await monitor();
      await open();

      const row = rowOf('vendor-001');
      expect(row.get('[data-testid="app-monitor-decided-name"]').text()).toBe('Ola Fern');
      expect(row.get('[data-testid="app-monitor-decided-email"]').text()).toBe(
        'vendor-001@example.com',
      );
      expect(row.get('[data-testid="app-monitor-decided-status"]').text()).toBe('Approved');
      expect(row.get('[data-testid="app-monitor-decided-giver"]').text()).toContain(
        'ana@example.com',
      );
      expect(row.get('[data-testid="app-monitor-decided-reject-button"]').text()).toBe(
        'Reject instead',
      );
      expect(
        rowOf('vendor-002').get('[data-testid="app-monitor-decided-approve-button"]').text(),
      ).toBe('Approve instead');
    });

    it('lists the newest verdict first', async () => {
      await monitor();
      await open();
      expect(rowEmails()).toEqual(['vendor-002@example.com', 'vendor-001@example.com']);
    });

    it('never opens on a change of verdict, which one stray Enter would make', async () => {
      await monitor();
      await open();

      expect(focused()).toBe(dialog().element);
    });

    it('opens on its find field once the list has one', async () => {
      list = manyReviewed(13);
      await monitor();
      await open();
      expect(focused()).toBe(findField().element);
    });

    it('says why above the list, with no action on a row, to someone refused a change', async () => {
      await monitor(REFUSING_A_CHANGE);
      await open();

      const reason = byId('app-monitor-decided-reason');
      expect(reason.text()).toBe(CHANGE_REFUSED);
      const frame = byId('app-monitor-decided-list').element;
      expect(
        reason.element.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(allById('app-monitor-decided-approve-button')).toHaveLength(0);
      expect(allById('app-monitor-decided-reject-button')).toHaveLength(0);
    });

    it('offers no action on a row of a market whose review has closed', async () => {
      await monitor({ ...MARKET, verdictsSettledReason: 'The review has closed.' } as Market);
      await open();
      expect(allById('app-monitor-decided-reject-button')).toHaveLength(0);
      expect(byId('app-monitor-decided-reason').exists()).toBe(false);
    });
  });

  describe('the list', () => {
    it('shows 50 rows at a time, and counts them', async () => {
      list = manyReviewed(120);
      await monitor();
      await open();

      expect(allById('app-monitor-decided-row')).toHaveLength(50);
      expect(byId('app-monitor-decided-list-count').text()).toBe('Showing 50 of 120');
      await byId('app-monitor-decided-list-more').trigger('click');
      await flushPromises();
      expect(allById('app-monitor-decided-row')).toHaveLength(100);
    });

    it('finds by name and by address, past the first page', async () => {
      list = [
        ...manyReviewed(60),
        reviewedAt(0, ApplicationStatus.ReviewerRejected, {
          id: 'oldest',
          applicantEmail: 'oldest@EXAMPLE.com',
          verdictAt: '2020-01-01T00:00:00+00:00',
          formData: { essential_preferred_name: 'Quill Moss' },
        }),
      ];
      await monitor();
      await open();
      expect(rowEmails()).not.toContain('oldest@EXAMPLE.com');

      await find('quill');
      expect(rowEmails()).toEqual(['oldest@EXAMPLE.com']);

      await find('oldest@example');
      expect(rowEmails()).toEqual(['oldest@EXAMPLE.com']);

      await find('nobody at all');
      expect(rowEmails()).toEqual([]);
      expect(byId('app-monitor-decided-list-count').text()).toBe('Nothing matches "nobody at all"');
    });

    it('forgets the words on closing', async () => {
      list = manyReviewed(13);
      await monitor();
      await open();
      await find('vendor-003');
      await byId('app-monitor-decided-close-button').trigger('click');
      await flushPromises();

      await open();

      expect((findField().element as HTMLInputElement).value).toBe('');
      expect(allById('app-monitor-decided-row')).toHaveLength(13);
    });
  });

  describe('changing a verdict in it', () => {
    /** The first rows' page and the next: 100 of 120 shown, the row asked for among them. */
    async function aLongListOpen() {
      list = [application('jane'), application('kim'), ...manyReviewed(120)];
      await monitor();
      await open();
      await byId('app-monitor-decided-list-more').trigger('click');
      await flushPromises();
      expect(allById('app-monitor-decided-row')).toHaveLength(100);
    }

    const changeOn = async (id: string) => {
      (rowOf(id).get('button').element as HTMLElement).focus();
      await rowOf(id).get('button').trigger('click');
    };

    it('leaves it open, holds the rows shown, and moves nothing behind it', async () => {
      await aLongListOpen();
      const up = email();
      const handOuts = handOut.mock.calls.length;

      await changeOn('vendor-080');
      await flushPromises();

      expect(reviewApplication).toHaveBeenCalledTimes(1);
      expect(dialog().exists()).toBe(true);
      expect(allById('app-monitor-decided-row')).toHaveLength(100);
      expect(email()).toBe(up);
      expect(handOut.mock.calls.length).toBe(handOuts);
    });

    it('puts focus on the new button of that row, which leads the list now', async () => {
      await aLongListOpen();

      await changeOn('vendor-080');
      await flushPromises();

      expect(rowEmails()[0]).toBe('vendor-080@example.com');
      expect(focused().textContent).toContain('Reject instead');
      expect(rowOf('vendor-080').element.contains(focused())).toBe(true);
    });

    it('holds focus off the page while the verdict is written', async () => {
      await aLongListOpen();
      let answer!: () => void;
      reviewApplication.mockImplementationOnce(
        (_m: string, app: Application, status: string) =>
          new Promise((resolve) => {
            answer = () =>
              resolve({
                application: { ...app, status, verdictAt: '2026-11-01T10:00:00+00:00' },
                undoSeconds: 0,
              });
          }),
      );

      await changeOn('vendor-080');
      await flushPromises();

      // A disabled button cannot keep focus, so the row has it until the answer.
      expect(focused().tagName).not.toBe('BODY');
      expect(dialog().element.contains(focused())).toBe(true);

      answer();
      await flushPromises();
      expect(focused().tagName).toBe('BUTTON');
    });

    it('says a failed change in the dialog, with focus back on the same button', async () => {
      await aLongListOpen();
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403, data: { error: 'The server said no.' } },
      });

      await changeOn('vendor-080');
      await flushPromises();

      expect(byId('app-monitor-decided-error').text()).toContain('The server said no.');
      expect(rowOf('vendor-080').element.contains(focused())).toBe(true);
      expect(focused().textContent).toContain('Approve instead');
      expect(byId('app-monitor-card').text()).not.toContain('The server said no.');
    });

    it('says a verdict changed since it was read in the dialog, the card staying up', async () => {
      await aLongListOpen();
      const up = email();
      const seen = list.find((app) => app.id === 'vendor-080')!;
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: 'kai@example.com approved this application since you opened it.',
            application: { ...seen, status: ApplicationStatus.ReviewerApproved },
          },
        },
      });

      await changeOn('vendor-080');
      await flushPromises();

      expect(byId('app-monitor-decided-error').text()).toContain('kai@example.com approved');
      expect(rowOf('vendor-080').get('[data-testid="app-monitor-decided-status"]').text()).toBe(
        'Approved',
      );
      expect(rowOf('vendor-080').element.contains(focused())).toBe(true);
      expect(email()).toBe(up);
      expect(byId('app-monitor-changed').exists()).toBe(false);
    });

    it('starts each try clean, and closes clean', async () => {
      await aLongListOpen();
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403, data: { error: 'The server said no.' } },
      });
      await changeOn('vendor-080');
      await flushPromises();
      expect(byId('app-monitor-decided-error').exists()).toBe(true);

      await changeOn('vendor-080');
      await flushPromises();
      expect(byId('app-monitor-decided-error').exists()).toBe(false);

      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 403, data: { error: 'The server said no.' } },
      });
      await changeOn('vendor-080');
      await flushPromises();
      expect(byId('app-monitor-decided-error').exists()).toBe(true);
      await byId('app-monitor-decided-close-button').trigger('click');
      await flushPromises();
      await open();
      expect(byId('app-monitor-decided-error').exists()).toBe(false);
    });

    describe('a change that fails after the dialog was closed', () => {
      /** A press whose answer is held, then the dialog closed with that answer still out. */
      async function changeThenClose(id: string) {
        let refuse!: (reason: unknown) => void;
        reviewApplication.mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              refuse = reject;
            }),
        );
        await changeOn(id);
        await flushPromises();
        await byId('app-monitor-decided-close-button').trigger('click');
        await flushPromises();
        expect(dialog().exists()).toBe(false);
        return refuse;
      }

      const NO_MAY_NOT = {
        isAxiosError: true,
        response: { status: 403, data: { error: 'The server said no.' } },
      };

      it('is said on the card, naming the application, and not in the next opening', async () => {
        await aLongListOpen();
        const up = email();
        const refuse = await changeThenClose('vendor-080');

        refuse(NO_MAY_NOT);
        await flushPromises();

        expect(byId('app-monitor-error').text()).toBe(
          'vendor-080@example.com was not changed: The server said no.',
        );
        expect(email()).toBe(up);
        expect(focused()).toBe(button().element);

        await open();
        expect(byId('app-monitor-decided-error').exists()).toBe(false);
      });

      it('says who changed it since, on the row and on the card', async () => {
        await aLongListOpen();
        const seen = list.find((app) => app.id === 'vendor-080')!;
        const refuse = await changeThenClose('vendor-080');

        refuse({
          isAxiosError: true,
          response: {
            status: 409,
            data: {
              error: 'kai@example.com approved this application since you opened it.',
              application: { ...seen, status: ApplicationStatus.ReviewerApproved },
            },
          },
        });
        await flushPromises();

        expect(byId('app-monitor-error').text()).toBe(
          'vendor-080@example.com was not changed: ' +
            'kai@example.com approved this application since you opened it.',
        );

        await open();
        expect(byId('app-monitor-decided-error').exists()).toBe(false);
        expect(rowOf('vendor-080').get('[data-testid="app-monitor-decided-status"]').text()).toBe(
          'Approved',
        );
      });

      it('keeps a refused card its own words, and adds the failure beside them', async () => {
        list = [application('jane'), application('kim'), reviewedAt(1)];
        await monitor();
        reviewApplication.mockRejectedValueOnce({
          isAxiosError: true,
          response: {
            status: 409,
            data: {
              error: 'kai@example.com approved this application since you opened it.',
              application: {
                ...application('jane', ApplicationStatus.ReviewerApproved),
                verdictAt: '2026-10-31T10:00:00+00:00',
              },
            },
          },
        });
        await press('r');
        await open();
        const refuse = await changeThenClose('vendor-001');

        refuse(NO_MAY_NOT);
        await flushPromises();

        const said = byId('app-monitor-changed').text();
        expect(said).toContain('kai@example.com approved this application');
        expect(said).toContain('vendor-001@example.com was not changed: The server said no.');
        expect(email()).toBe('jane@example.com');
      });

      it('is said in the dialog when it was opened again before the answer', async () => {
        await aLongListOpen();
        const refuse = await changeThenClose('vendor-080');
        await open();
        const closeButton = byId('app-monitor-decided-close-button').element as HTMLElement;
        closeButton.focus();

        refuse(NO_MAY_NOT);
        await flushPromises();

        expect(byId('app-monitor-decided-error').text()).toContain('The server said no.');
        expect(byId('app-monitor-error').exists()).toBe(false);
        expect(focused()).toBe(closeButton);
      });
    });

    it('takes a row that left the list by a refusal, focus staying in the dialog', async () => {
      await aLongListOpen();
      const seen = list.find((app) => app.id === 'vendor-080')!;
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: 'kai@example.com undid this verdict since you opened it.',
            application: { ...seen, status: ApplicationStatus.Open, verdictAt: null },
          },
        },
      });

      await changeOn('vendor-080');
      await flushPromises();

      expect(rowEmails()).not.toContain('vendor-080@example.com');
      expect(dialog().element.contains(focused())).toBe(true);
    });

    it('moves on from a refused card once its own row is changed here', async () => {
      list = [application('jane'), application('kim')];
      await monitor();
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: 'kai@example.com approved this application since you opened it.',
            application: {
              ...application('jane', ApplicationStatus.ReviewerApproved),
              verdictAt: '2026-10-31T10:00:00+00:00',
            },
          },
        },
      });
      await press('r');
      expect(byId('app-monitor-changed').exists()).toBe(true);
      expect(email()).toBe('jane@example.com');

      await open();
      await changeOn('jane');
      await flushPromises();

      expect(dialog().exists()).toBe(true);
      expect(email()).toBe('kim@example.com');
      expect(byId('app-monitor-changed').exists()).toBe(false);
      expect(rowOf('jane').element.contains(focused())).toBe(true);
    });

    it('leaves a refused card as it stands when another row is changed', async () => {
      list = [application('jane'), application('kim'), reviewedAt(1)];
      await monitor();
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: 'kai@example.com approved this application since you opened it.',
            application: {
              ...application('jane', ApplicationStatus.ReviewerApproved),
              verdictAt: '2026-10-31T10:00:00+00:00',
            },
          },
        },
      });
      await press('r');

      await open();
      await changeOn('vendor-001');
      await flushPromises();
      await byId('app-monitor-decided-close-button').trigger('click');
      await flushPromises();

      expect(email()).toBe('jane@example.com');
      expect(byId('app-monitor-changed').text()).toContain('kai@example.com approved');
    });

    it('takes the undo on offer away, with no card moved, as a change always has', async () => {
      list = [application('jane'), application('kim'), reviewedAt(1)];
      await monitor();
      reviewApplication.mockImplementationOnce(async (_m: string, app: Application, s: string) => ({
        application: { ...app, status: s, verdictAt: '2026-11-01T09:00:00+00:00' },
        undoSeconds: 120,
      }));
      await press('r');
      expect(byId('app-monitor-undo').exists()).toBe(true);
      const up = email();

      await open();
      await changeOn('vendor-001');
      await flushPromises();

      expect(byId('app-monitor-undo').exists()).toBe(false);
      expect(email()).toBe(up);
    });
  });

  describe('a link naming a reviewed application', () => {
    it('opens the dialog with the words set to its address and its row marked', async () => {
      await monitor(MARKET, 'vendor-001');

      expect(dialog().exists()).toBe(true);
      expect((findField().element as HTMLInputElement).value).toBe('vendor-001@example.com');
      expect(rowEmails()).toEqual(['vendor-001@example.com']);
      expect(rowOf('vendor-001').classes()).toContain('named');
    });

    it('reaches it past row 50', async () => {
      list = manyReviewed(120);
      await monitor(MARKET, 'vendor-003');

      expect(rowEmails()).toEqual(['vendor-003@example.com']);
      expect(rowOf('vendor-003').classes()).toContain('named');
    });

    it('marks only the application named among those the words find', async () => {
      list = [
        reviewedAt(1, ApplicationStatus.ReviewerRejected, {
          id: 'ann',
          applicantEmail: 'ann@example.com',
        }),
        reviewedAt(2, ApplicationStatus.ReviewerRejected, {
          id: 'joann',
          applicantEmail: 'joann@example.com',
        }),
      ];
      await monitor(MARKET, 'ann');

      expect(rowOf('ann').classes()).toContain('named');
      expect(rowOf('joann').classes()).not.toContain('named');
    });

    it('clears the words on closing, and gives focus to the button it never came from', async () => {
      list = [application('jane'), ...manyReviewed(13)];
      await monitor(MARKET, 'vendor-003');
      expect(focused()).toBe(findField().element);

      await byId('app-monitor-decided-close-button').trigger('click');
      await flushPromises();

      expect(dialog().exists()).toBe(false);
      expect(focused()).toBe(button().element);
      await open();
      expect((findField().element as HTMLInputElement).value).toBe('');
      expect(allById('app-monitor-decided-row')).toHaveLength(13);
      expect(rowOf('vendor-003').classes()).toContain('named');
    });

    it('brings a card up behind it, as any opening of the review does', async () => {
      await monitor(MARKET, 'vendor-001');
      expect(email()).toBe('jane@example.com');
    });

    it('opens nothing for an application still to decide, its card coming up', async () => {
      await monitor(MARKET, 'kim');
      expect(dialog().exists()).toBe(false);
      expect(email()).toBe('kim@example.com');
    });
  });

  describe('the card behind it', () => {
    it('takes none of A, R, S, N and Z', async () => {
      reviewApplication.mockImplementationOnce(async (_m: string, app: Application, s: string) => ({
        application: { ...app, status: s, verdictAt: '2026-11-01T09:00:00+00:00' },
        undoSeconds: 120,
      }));
      await monitor();
      await press('r');
      expect(byId('app-monitor-undo').exists()).toBe(true);
      const up = email();
      await open();
      const given = reviewApplication.mock.calls.length;
      const handOuts = handOut.mock.calls.length;

      for (const key of ['a', 'r', 's', 'n', 'z']) await press(key);

      expect(reviewApplication.mock.calls.length).toBe(given);
      expect(handOut.mock.calls.length).toBe(handOuts);
      expect(undoVerdict).not.toHaveBeenCalled();
      expect(byId('follow-up-window').exists()).toBe(false);
      expect(dialog().exists()).toBe(true);
      expect(email()).toBe(up);
    });

    it('does not play a verdict key held while the dialog opened over it', async () => {
      await monitor();
      let answer!: () => void;
      reviewApplication.mockImplementationOnce(
        (_m: string, app: Application, status: string) =>
          new Promise((resolve) => {
            answer = () =>
              resolve({
                application: { ...app, status, verdictAt: '2026-11-01T09:00:00+00:00' },
                undoSeconds: 120,
              });
          }),
      );
      let handedOver!: (app: Application | undefined) => void;
      handOut.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            handedOver = resolve;
          }),
      );

      await press('r');
      answer();
      await flushPromises();
      await press('a');
      await open();
      handedOver(list.find((app) => app.id === 'kim'));
      await flushPromises();

      expect(reviewApplication).toHaveBeenCalledTimes(1);
      await byId('app-monitor-decided-close-button').trigger('click');
      await flushPromises();
      expect(page().text()).toContain('That key did not count.');
    });

    it('closes the dialog when the view stops being visible, and it stays closed', async () => {
      const wrapper = await monitor();
      await open();

      await wrapper.setProps({ visible: false });
      await flushPromises();
      expect(dialog().exists()).toBe(false);

      await wrapper.setProps({ visible: true });
      await flushPromises();
      expect(dialog().exists()).toBe(false);
      expect(byId('app-monitor-card').exists()).toBe(true);
    });

    it('closes the dialog when another market opens', async () => {
      const wrapper = await monitor();
      await open();

      await wrapper.setProps({ market: { ...MARKET, id: 'm2' } as Market });
      await flushPromises();

      expect(dialog().exists()).toBe(false);
    });

    it.each([
      ['the close', () => byId('app-monitor-decided-close-button').trigger('click')],
      ['the backdrop', () => byId('app-monitor-decided-background').trigger('click')],
      [
        'Escape',
        () => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        },
      ],
    ])('gives focus back to the button by %s, the same application up', async (_how, close) => {
      await monitor();
      const up = email();
      await open();

      await close();
      await flushPromises();

      expect(dialog().exists()).toBe(false);
      expect(focused()).toBe(button().element);
      expect(email()).toBe(up);
    });
  });
});
