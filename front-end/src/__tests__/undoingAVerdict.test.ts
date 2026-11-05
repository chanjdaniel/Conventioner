/**
 * A verdict given by mistake is undone at once, and a past one is easy to find (E38/F10/S01).
 *
 * Right after a verdict, whoever gave it reads what they decided and an Undo, for as long as the
 * server says it may be undone or until their next verdict; Undo puts the application back as it
 * was, as the card up. The reviewed list is newest verdict first, each row naming the applicant,
 * and its toggle sits beside the counts, above the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { isDecided } from '@/utils/verdicts';
import { newestVerdictFirst, reviewed } from '@/utils/reviewQueue';
import { nameAndEmail, undoLine } from '@/utils/verdictUndo';

const fetchMarketApplications = vi.fn();
const reviewApplication = vi.fn();
const undoVerdict = vi.fn();
const handedOut = vi.fn();

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  // A hand-out answers the application asked for by name, else the first still to decide.
  const post = async (url: string, body: { want?: string | null }) => {
    if (!url.endsWith('/review/next')) return { data: {} };
    const named = await handedOut(body.want ?? null);
    if (named) return { data: { application: named } };
    const apps: Application[] = await fetchMarketApplications('m1');
    const wanted = body.want ? apps.find((app) => app.id === body.want) : undefined;
    const handed =
      wanted ??
      apps.find((app) => !isDecided(app) && app.status !== ApplicationStatus.NeedsFollowUp);
    return { data: { application: handed ?? null } };
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

function application(id: string, status: ApplicationStatus, extra = {}): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@example.com`,
    status,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    ...extra,
  } as unknown as Application;
}

const named = (name: string) => ({ formData: { essential_preferred_name: name } });

const MARKET = {
  id: 'm1',
  applicationForm: { fields: [{ key: 'shop', label: 'Shop', type: 'text' }] },
  actionRefusals: { 'give-verdicts': null, 'change-verdicts': 'Only an Admin may.' },
} as unknown as Market;

describe('the undo line', () => {
  it('names the applicant then their address, or the address alone', () => {
    const jane = application('jane', ApplicationStatus.Open, named('Jane Doe'));
    expect(nameAndEmail(jane)).toBe('Jane Doe (jane@example.com)');
    expect(nameAndEmail(application('kim', ApplicationStatus.Open))).toBe('kim@example.com');
  });

  it('says what was decided', () => {
    const jane = application('jane', ApplicationStatus.Open, named('Jane Doe'));
    expect(undoLine(ApplicationStatus.ReviewerRejected, jane)).toBe(
      'Rejected Jane Doe (jane@example.com).',
    );
    expect(undoLine(ApplicationStatus.ReviewerApproved, jane)).toBe(
      'Approved Jane Doe (jane@example.com).',
    );
    expect(undoLine(ApplicationStatus.NeedsFollowUp, jane)).toBe(
      'Marked Jane Doe (jane@example.com) for follow-up.',
    );
  });
});

describe('the reviewed list', () => {
  it('is newest verdict first, those with no verdict time last in arrival order', () => {
    const apps = [
      application('old', ApplicationStatus.ReviewerApproved, {
        verdictAt: '2026-10-01T10:00:00+00:00',
      }),
      application('none-late', ApplicationStatus.Assigned, {
        submittedAt: '2026-09-20T00:00:00Z',
      }),
      application('new', ApplicationStatus.ReviewerRejected, {
        verdictAt: '2026-10-02T10:00:00+00:00',
      }),
      application('none-early', ApplicationStatus.Assigned, {
        submittedAt: '2026-09-10T00:00:00Z',
      }),
      application('open', ApplicationStatus.Open),
    ];

    expect(reviewed(apps).map((a) => a.id)).toEqual(['new', 'old', 'none-early', 'none-late']);
    expect(newestVerdictFirst(apps.slice(0, 3)).map((a) => a.id)).toEqual([
      'new',
      'old',
      'none-late',
    ]);
  });
});

describe('one by one', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handedOut.mockReset();
    undoVerdict.mockReset();
    reviewApplication.mockReset();
    const list = [
      application('jane', ApplicationStatus.Open, named('Jane Doe')),
      application('kim', ApplicationStatus.Open),
      application('earlier', ApplicationStatus.ReviewerApproved, {
        ...named('Earl Ier'),
        verdictAt: '2026-10-01T00:00:00+00:00',
      }),
    ];
    fetchMarketApplications.mockImplementation(async () => list.map((app) => ({ ...app })));
    // The server keeps what was written, so the next hand-out passes a decided card.
    const store = (app: Application) => {
      list.splice(
        list.findIndex((a) => a.id === app.id),
        1,
        app,
      );
      return app;
    };
    reviewApplication.mockImplementation(async (_m: string, app: Application, status: string) => ({
      application: store({
        ...app,
        status,
        verdictAt: '2026-11-01T10:00:00+00:00',
      } as Application),
      undoSeconds: 120,
    }));
    undoVerdict.mockImplementation(async (_m: string, item: { application: Application }) =>
      store({ ...item.application, status: ApplicationStatus.Open, verdictAt: null }),
    );
  });
  afterEach(() => vi.useRealTimers());

  async function monitor() {
    const wrapper = mount(ApplicationMonitor, {
      props: { market: MARKET, visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  }

  const press = async (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    await flushPromises();
  };

  describe('a key pressed while the next card is still being handed out', () => {
    /** Hold the hand-outs from here on, until `release` answers them, with `answer` if given. */
    function holdHandOuts(answer?: Application) {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      handedOut.mockImplementation(async () => {
        await held;
        return answer;
      });
      return release;
    }
    let up: Awaited<ReturnType<typeof monitor>> | undefined;
    const opened = async () => (up = await monitor());
    // Unmounted here, so a failed test's window listener cannot press keys in the next.
    afterEach(() => up?.unmount());
    const verdictsOn = () =>
      reviewApplication.mock.calls.map(([, app, status]) => [(app as Application).id, status]);

    it('lands on the card it was pressed on, once that card is handed out', async () => {
      const wrapper = await opened();
      const release = holdHandOuts();

      await press('a');
      expect(wrapper.get('[data-testid="app-monitor-email"]').text()).toBe('kim@example.com');
      await press('r');
      expect(verdictsOn()).toEqual([['jane', ApplicationStatus.ReviewerApproved]]);

      release();
      await flushPromises();
      expect(verdictsOn()).toEqual([
        ['jane', ApplicationStatus.ReviewerApproved],
        ['kim', ApplicationStatus.ReviewerRejected],
      ]);
      expect(wrapper.get('[data-testid="app-monitor-undo"]').text()).toContain(
        'Rejected kim@example.com',
      );
      expect(wrapper.text()).not.toContain('did not count');
    });

    it('says the key did not count when another card is handed out, and decides neither', async () => {
      const wrapper = await opened();
      const release = holdHandOuts(application('lee', ApplicationStatus.Open));

      await press('a');
      await press('r');
      release();
      await flushPromises();

      expect(verdictsOn()).toEqual([['jane', ApplicationStatus.ReviewerApproved]]);
      expect(wrapper.get('[data-testid="app-monitor-email"]').text()).toBe('lee@example.com');
      expect(wrapper.text()).toContain('That key did not count');

      // Moving on leaves the words behind: they were about the card the key was pressed on.
      handedOut.mockImplementation(async () => undefined);
      await press('n');
      expect(wrapper.text()).not.toContain('That key did not count');
    });

    it('says the key did not count when the hand-out fails, keeping why', async () => {
      const wrapper = await opened();
      let refuse = (_: Error) => {};
      handedOut.mockImplementation(
        () =>
          new Promise((_, reject) => {
            refuse = reject;
          }),
      );

      await press('a');
      await press('r');
      refuse(new Error('down'));
      await flushPromises();

      expect(verdictsOn()).toEqual([['jane', ApplicationStatus.ReviewerApproved]]);
      expect(wrapper.text()).toContain('Could not open the next application.');
      expect(wrapper.text()).toContain('That key did not count');
    });

    it('asks for no second press when no card is handed out', async () => {
      const wrapper = await opened();
      const release = holdHandOuts();

      await press('a');
      await press('r');
      const decided = application('kim', ApplicationStatus.ReviewerApproved);
      fetchMarketApplications.mockImplementation(async () => [decided]);
      release();
      await flushPromises();

      expect(verdictsOn()).toEqual([['jane', ApplicationStatus.ReviewerApproved]]);
      expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('That key did not count.');
      expect(wrapper.text()).not.toContain('Press it again');
    });

    it('takes the last key pressed, if the reviewer changes their mind', async () => {
      const wrapper = await opened();
      const release = holdHandOuts();

      await press('a');
      await press('r');
      await press('a');
      release();
      await flushPromises();

      expect(verdictsOn()).toEqual([
        ['jane', ApplicationStatus.ReviewerApproved],
        ['kim', ApplicationStatus.ReviewerApproved],
      ]);
    });

    it('holds no key that repeats, so a long press decides one card', async () => {
      const wrapper = await opened();
      const release = holdHandOuts();

      await press('a');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true }));
      release();
      await flushPromises();

      expect(verdictsOn()).toEqual([['jane', ApplicationStatus.ReviewerApproved]]);
      expect(wrapper.text()).not.toContain('did not count');
    });

    it('undoes by Z once the hand-out answers', async () => {
      const wrapper = await opened();
      const release = holdHandOuts();

      await press('a');
      await press('z');
      expect(undoVerdict).not.toHaveBeenCalled();

      handedOut.mockImplementation(async () => undefined);
      release();
      await flushPromises();

      expect(undoVerdict).toHaveBeenCalledTimes(1);
      expect(wrapper.get('[data-testid="app-monitor-email"]').text()).toBe('jane@example.com');
    });

    it('carries no key pressed on the card whose verdict is being written', async () => {
      const wrapper = await opened();
      let answer = () => {};
      const written = new Promise<void>((resolve) => {
        answer = resolve;
      });
      const write = reviewApplication.getMockImplementation()!;
      reviewApplication.mockImplementation(async (...args: unknown[]) => {
        await written;
        return write(...args);
      });

      await press('a');
      await press('a');
      await press('r');
      answer();
      await flushPromises();

      expect(verdictsOn()).toEqual([['jane', ApplicationStatus.ReviewerApproved]]);
      expect(wrapper.text()).not.toContain('did not count');
    });
  });

  it('names the applicant on the card, then their address', async () => {
    const wrapper = await monitor();

    expect(wrapper.get('[data-testid="app-monitor-name"]').text()).toBe('Jane Doe');
    expect(wrapper.get('[data-testid="app-monitor-email"]').text()).toBe('jane@example.com');
    wrapper.unmount();
  });

  // The card's heading, so the notes' third-level labels sit one level under it (T95 note 6).
  it("heads the card with the applicant's name, else their address", async () => {
    const wrapper = await monitor();
    const heading = () => wrapper.get('[data-testid="app-monitor-card"] h2');

    expect(heading().text()).toBe('Jane Doe');
    await press('r');
    expect(heading().text()).toBe('kim@example.com');
    expect(wrapper.findAll('[data-testid="app-monitor-card"] h2')).toHaveLength(1);
    wrapper.unmount();
  });

  it('offers the undo of a verdict above the next card, a polite live region', async () => {
    const wrapper = await monitor();

    await press('r');

    const line = wrapper.get('[data-testid="app-monitor-undo"]');
    expect(line.text()).toContain('Rejected Jane Doe (jane@example.com).');
    expect(line.attributes('role')).toBe('status');
    expect(line.get('button').text()).toContain('Undo');
    expect(wrapper.get('[data-testid="app-monitor-email"]').text()).toBe('kim@example.com');
    wrapper.unmount();
  });

  it('keeps the line over the reviewed list, so opening the list never pushes it down', async () => {
    const wrapper = await monitor();
    await press('r');

    await wrapper.get('[data-testid="app-monitor-decided-toggle"]').trigger('click');

    const line = wrapper.get('[data-testid="app-monitor-undo"]').element;
    const list = wrapper.get('[data-testid="app-monitor-decided-list"]').element;
    const card = wrapper.get('[data-testid="app-monitor-card"]').element;
    expect(line.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    wrapper.unmount();
  });

  it('undoes by Z: the application is put back up as the card, at what it was', async () => {
    const wrapper = await monitor();
    await press('r');

    await press('z');

    // What it returns to is the server's, kept by the verdict: the client names only what it saw.
    expect(undoVerdict).toHaveBeenCalledWith('m1', {
      application: expect.objectContaining({ id: 'jane', status: 'reviewer_rejected' }),
    });
    expect(handedOut).toHaveBeenLastCalledWith('jane');
    expect(wrapper.get('[data-testid="app-monitor-email"]').text()).toBe('jane@example.com');
    expect(wrapper.get('[data-testid="app-monitor-status"]').text()).toBe('Open');
    expect(wrapper.find('[data-testid="app-monitor-undo"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('goes away at the next verdict, and offers that one instead', async () => {
    const wrapper = await monitor();
    await press('r');

    await press('a');

    const line = wrapper.get('[data-testid="app-monitor-undo"]');
    expect(line.text()).toContain('Approved kim@example.com.');
    expect(line.text()).not.toContain('Jane');
    wrapper.unmount();
  });

  it('goes away once the window the server gave has passed', async () => {
    const wrapper = await monitor();
    await press('r');

    vi.advanceTimersByTime(120_000);
    await flushPromises();

    expect(wrapper.find('[data-testid="app-monitor-undo"]').exists()).toBe(false);
    await press('z');
    expect(undoVerdict).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('says a refusal on the line, and offers the undo no more', async () => {
    const wrapper = await monitor();
    await press('r');
    undoVerdict.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          error: 'This verdict can no longer be undone here. An Admin or the owner can change it.',
        },
      },
    });

    await wrapper.get('[data-testid="app-monitor-undo"] button').trigger('click');
    await flushPromises();

    const line = wrapper.get('[data-testid="app-monitor-undo"]');
    expect(line.text()).toContain('This verdict can no longer be undone here.');
    expect(line.find('button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers no undo of a change from the reviewed list', async () => {
    const wrapper = await monitor();
    await wrapper.get('[data-testid="app-monitor-decided-toggle"]').trigger('click');

    expect(wrapper.find('[data-testid="app-monitor-undo"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('lists the reviewed newest first, each row naming the applicant then the address', async () => {
    const wrapper = await monitor();
    await press('r');
    await wrapper.get('[data-testid="app-monitor-decided-toggle"]').trigger('click');

    const rows = wrapper.findAll('[data-testid="app-monitor-decided-row"]');
    expect(rows.map((row) => row.get('[data-testid="app-monitor-decided-name"]').text())).toEqual([
      'Jane Doe',
      'Earl Ier',
    ]);
    expect(rows[0]!.get('[data-testid="app-monitor-decided-email"]').text()).toBe(
      'jane@example.com',
    );
    wrapper.unmount();
  });

  it('puts the toggle beside the counts, before the card', async () => {
    const wrapper = await monitor();

    const html = wrapper.html();
    const toggle = wrapper.get('[data-testid="app-monitor-decided-toggle"]');
    expect(toggle.text()).toBe('Show 1 reviewed');
    expect(html.indexOf('app-monitor-decided-toggle')).toBeLessThan(
      html.indexOf('data-testid="app-monitor-card"'),
    );
    wrapper.unmount();
  });
});
