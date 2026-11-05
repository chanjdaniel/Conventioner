/**
 * "Choose what leads the card" opens a dialog of the ticks over the card (T217, E19/F03/S02).
 *
 * It used to unfold between the card's answers and its verdict buttons. Each tick still saves as it
 * is made, so the dialog has a Done and no Cancel; the same application is up when it closes; and a
 * verdict key never reaches the card behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';

const fetchMarketApplications = vi.fn();
const reviewApplication = vi.fn();
const undoVerdict = vi.fn();
const handOut = vi.fn();
const putHighlights = vi.fn();

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  const post = async (url: string, body: { want?: string | null }) => {
    if (!url.endsWith('/review/next')) return { data: {} };
    return { data: { application: await handOut(body.want ?? null) } };
  };
  const put = (url: string, body: unknown) =>
    url.endsWith('/review-highlights') ? putHighlights(url, body) : answered();
  return { ...actual, api: { get: answered, post, put, delete: answered } };
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

function application(id: string, status = ApplicationStatus.Open): Application {
  return {
    id,
    marketId: 'm1',
    applicantEmail: `${id}@example.com`,
    status,
    formData: { shop: `${id}'s shop` },
    submittedAt: '2026-09-15T14:20:18.000Z',
  } as unknown as Application;
}

const MARKET = {
  id: 'm1',
  applicationForm: { fields: [{ key: 'shop', label: 'Shop', type: 'text' }] },
  reviewHighlights: [],
  actionRefusals: { 'give-verdicts': null, 'change-verdicts': null, 'change-form': null },
} as unknown as Market;

describe('Choose what leads the card', () => {
  let wrappers: VueWrapper[] = [];
  let list: Application[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    list = [application('jane'), application('kim')];
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
      return { application: written, undoSeconds: 120 };
    });
    undoVerdict.mockReset();
    undoVerdict.mockImplementation(async (_m: string, item: { application: Application }) => ({
      ...item.application,
      status: ApplicationStatus.Open,
      verdictAt: null,
    }));
    putHighlights.mockReset();
    putHighlights.mockImplementation(async (_url: string, body: { keys: string[] }) => ({
      data: { reviewHighlights: body.keys, nothingLeadsTheCard: false },
    }));
  });

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount();
    wrappers = [];
    vi.useRealTimers();
  });

  async function monitor(market: Market = MARKET) {
    const wrapper = mount(ApplicationMonitor, {
      props: { market, visible: true },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
  }

  /** The dialog is teleported out of the wrapper to `body`, as every modal is. */
  const page = () => new DOMWrapper(document.body);
  const byId = (id: string) => page().find(`[data-testid="${id}"]`);
  const button = () => byId('app-monitor-choose-highlights');
  const dialog = () => byId('choose-highlights-window');
  const email = () => byId('app-monitor-email').text();

  async function open() {
    const opener = button();
    (opener.element as HTMLElement).focus();
    await opener.trigger('click');
    await flushPromises();
  }

  const press = async (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    await flushPromises();
  };

  const tick = async () => {
    await page().find('[data-testid="review-highlight-shop"] input').setValue(true);
    await flushPromises();
  };

  describe('the button', () => {
    it('names the dialog and is no toggle, before and after opening', async () => {
      await monitor();
      expect(button().text()).toBe('Choose what leads the card');
      expect(button().attributes('aria-expanded')).toBeUndefined();
      expect(dialog().exists()).toBe(false);

      await open();

      expect(button().text()).toBe('Choose what leads the card');
      expect(page().text()).not.toContain('Done choosing');
    });

    it('is not offered to someone who may not change the form', async () => {
      await monitor({
        ...MARKET,
        actionRefusals: { 'give-verdicts': null, 'change-form': 'Only an Editor may.' },
      } as unknown as Market);
      expect(byId('app-monitor-card').exists()).toBe(true);
      expect(button().exists()).toBe(false);
    });
  });

  describe('the dialog', () => {
    it('is wide, scrolls its body, holds the ticks and has one Done with no Cancel', async () => {
      await monitor();
      await open();

      expect(dialog().attributes('aria-label')).toBe('Choose what leads the card');
      expect(dialog().classes()).toContain('dialog-window--wide');
      expect(dialog().classes()).toContain('dialog-window--body');
      expect(
        byId('choose-highlights-body').find('[data-testid="review-highlight-shop"]').exists(),
      ).toBe(true);

      const foot = dialog().findAll('.dialog-actions button');
      expect(foot.map((control) => control.text())).toEqual(['Done']);
      expect(foot[0].classes()).toContain('btn--primary');
      expect(foot[0].attributes('type')).toBe('button');
      expect(byId('choose-highlights-cancel-button').exists()).toBe(false);
    });

    it('is no form, so Enter on a tick submits nothing', async () => {
      await monitor();
      await open();
      expect(dialog().find('form').exists()).toBe(false);
    });

    it('takes focus on the first tick', async () => {
      await monitor();
      await open();
      expect(document.activeElement).toBe(
        page().find('[data-testid="review-highlight-shop"] input').element,
      );
    });
  });

  describe('a tick', () => {
    it('saves at once, and moves neither the cursor nor the card', async () => {
      await monitor();
      const before = email();
      const handOuts = handOut.mock.calls.length;
      await open();

      await tick();

      expect(putHighlights).toHaveBeenCalledTimes(1);
      expect(putHighlights).toHaveBeenCalledWith('/markets/m1/review-highlights', {
        keys: ['shop'],
        nothingLeadsTheCard: false,
      });
      expect(dialog().exists()).toBe(true);
      expect(email()).toBe(before);
      expect(handOut.mock.calls.length).toBe(handOuts);
      expect(reviewApplication).not.toHaveBeenCalled();
    });

    it('that fails is said by the dialog, and is gone once the dialog has closed', async () => {
      putHighlights.mockRejectedValueOnce(new Error('offline'));
      await monitor();
      await open();

      await tick();

      expect(byId('choose-highlights-error').text()).toBe(
        'Could not save what a reviewer reads first.',
      );
      expect(
        (
          page().find('[data-testid="review-highlight-shop"] input')
            .element as unknown as HTMLInputElement
        ).checked,
      ).toBe(false);

      await byId('choose-highlights-done').trigger('click');
      await flushPromises();
      await open();

      expect(byId('choose-highlights-error').exists()).toBe(false);
    });

    it('that fails after the dialog closed is said on the card', async () => {
      let refuse = () => {};
      putHighlights.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            refuse = () => reject(new Error('offline'));
          }),
      );
      await monitor();
      await open();
      await tick();
      await byId('choose-highlights-done').trigger('click');
      await flushPromises();

      refuse();
      await flushPromises();

      expect(byId('app-monitor-panel').text()).toContain(
        'Could not save what a reviewer reads first.',
      );
      await open();
      expect(byId('choose-highlights-error').exists()).toBe(false);
    });

    it("that fails after the dialog closed keeps a refused card's line, and is said beside it", async () => {
      const REFUSAL = 'kai@example.com approved this application since you opened it.';
      reviewApplication.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            error: REFUSAL,
            application: application('jane', ApplicationStatus.ReviewerApproved),
          },
        },
      });
      let refuse = () => {};
      putHighlights.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            refuse = () => reject(new Error('offline'));
          }),
      );
      await monitor();
      await press('a');
      expect(byId('app-monitor-changed').text()).toContain(REFUSAL);
      await open();
      await tick();
      await byId('choose-highlights-done').trigger('click');
      await flushPromises();

      refuse();
      await flushPromises();

      const line = byId('app-monitor-changed').text();
      expect(line).toContain(REFUSAL);
      expect(line).toContain('Could not save what a reviewer reads first.');
    });
  });

  describe('with the dialog open', () => {
    it.each(['a', 'r', 's', 'n'])('%s does nothing to the card', async (key) => {
      await monitor();
      const before = email();
      const handOuts = handOut.mock.calls.length;
      await open();

      await press(key);

      expect(reviewApplication).not.toHaveBeenCalled();
      expect(handOut.mock.calls.length).toBe(handOuts);
      expect(byId('follow-up-window').exists()).toBe(false);
      expect(email()).toBe(before);
    });

    it('z leaves the verdict on offer undone', async () => {
      await monitor();
      await press('a');
      const before = email();
      expect(byId('app-monitor-undo').exists()).toBe(true);
      await open();

      await press('z');

      expect(undoVerdict).not.toHaveBeenCalled();
      expect(byId('app-monitor-undo').exists()).toBe(true);
      expect(email()).toBe(before);
    });

    it('a key pressed on Done does nothing to the card either', async () => {
      await monitor();
      await open();
      const done = byId('choose-highlights-done').element as HTMLElement;
      done.focus();

      done.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      await flushPromises();

      expect(reviewApplication).not.toHaveBeenCalled();
    });

    it('the keys work again once it has closed', async () => {
      await monitor();
      await open();
      await byId('choose-highlights-done').trigger('click');
      await flushPromises();

      await press('a');

      expect(reviewApplication).toHaveBeenCalledTimes(1);
    });
  });

  describe('a key held as the next card arrives, with the dialog opened meanwhile', () => {
    /** Hold the hand-outs from here on, until the function returned answers them. */
    function holdHandOuts() {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hand = handOut.getMockImplementation()!;
      handOut.mockImplementation(async (want: string | null) => {
        await held;
        return hand(want);
      });
      return async () => {
        release();
        await flushPromises();
      };
    }

    it('gives no verdict on the card behind it, and says the key did not count', async () => {
      await monitor();
      const release = holdHandOuts();
      await press('a'); // jane's verdict; kim's card comes up while the hand-out is out.
      await press('r'); // held for kim.
      await open();

      await release();

      expect(reviewApplication).toHaveBeenCalledTimes(1);
      expect(byId('app-monitor-panel').text()).toContain('That key did not count.');
    });

    it('plays no undo behind it, which stays on offer', async () => {
      await monitor();
      const release = holdHandOuts();
      await press('a');
      await press('z');
      await open();

      await release();

      expect(undoVerdict).not.toHaveBeenCalled();
      expect(byId('app-monitor-undo').exists()).toBe(true);
    });
  });

  describe('closing', () => {
    const ways: [string, () => Promise<unknown>][] = [
      ['Done', () => byId('choose-highlights-done').trigger('click')],
      ['the close', () => byId('choose-highlights-close-button').trigger('click')],
      ['the backdrop', () => byId('choose-highlights-background').trigger('click')],
      [
        'Escape',
        async () =>
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      ],
    ];

    it.each(ways)('%s gives focus back to the button, the same card up', async (_name, close) => {
      await monitor();
      const before = email();
      const handOuts = handOut.mock.calls.length;
      await open();

      await close();
      await flushPromises();

      expect(dialog().exists()).toBe(false);
      expect(document.activeElement).toBe(button().element);
      expect(email()).toBe(before);
      expect(handOut.mock.calls.length).toBe(handOuts);
    });

    it('happens when the view stops being visible, and it stays closed on coming back', async () => {
      const wrapper = await monitor();
      await open();

      await wrapper.setProps({ visible: false });
      await flushPromises();
      expect(dialog().exists()).toBe(false);

      await wrapper.setProps({ visible: true });
      await flushPromises();
      expect(dialog().exists()).toBe(false);
      await press('a');
      expect(reviewApplication).toHaveBeenCalledTimes(1);
    });

    it('happens when the market changes', async () => {
      const wrapper = await monitor();
      await open();

      await wrapper.setProps({ market: { ...MARKET, id: 'm2' } as unknown as Market });
      await flushPromises();

      expect(dialog().exists()).toBe(false);
    });

    it('happens when the person may no longer change the form, and frees the keys', async () => {
      const wrapper = await monitor();
      await open();

      await wrapper.setProps({
        market: {
          ...MARKET,
          actionRefusals: { 'give-verdicts': null, 'change-form': 'Only an Editor may.' },
        } as unknown as Market,
      });
      await flushPromises();

      expect(dialog().exists()).toBe(false);
      await press('a');
      expect(reviewApplication).toHaveBeenCalledTimes(1);
    });

    it('does not go with the card, when the next hand-out finds nothing left', async () => {
      await monitor();
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      handOut.mockImplementation(async () => {
        await held;
        return null;
      });
      await press('a'); // jane's verdict; kim's card is up while the hand-out is out.
      await open();

      release();
      await flushPromises();

      expect(byId('app-monitor-card').exists()).toBe(false);
      expect(dialog().exists()).toBe(true);
      await byId('choose-highlights-done').trigger('click');
      await flushPromises();
      expect(dialog().exists()).toBe(false);
    });
  });
});
