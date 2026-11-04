/**
 * A Viewer who may not give a verdict still reads who owns a follow-up (T15). The owner is a
 * recorded fact on the application, not a candidate option, so gating `peopleOnMarket` to
 * verdict-givers left a Viewer's "Followed up by" control empty. A Viewer reads the owner as plain
 * text; an Editor or above keeps the chooser to hand the follow-up on, found by typing (T204).
 *
 * An Editor from outside the organization is offered only the market's own roles, so when an
 * organization admin with no market role owns the follow-up, the owner is among no option and the
 * control read blank. The card still names them, while offering only `peopleOnMarket` to hand it to.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { isDecided } from '@/utils/verdicts';
import { reassignFollowUp } from '@/utils/applicantApi';
import { answersRefusing } from './support/servedAnswers';

const fetchMarketApplications = vi.fn();

// The review's own calls - a claim on the next card, the vendor's notes - answer nothing here,
// rather than reaching for a server a unit test does not have.
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  const answered = () => Promise.resolve({ data: {} });
  // A hand-out answers the first card still to decide, as the server would with nobody else here:
  // a follow-up only when follow-ups are asked for.
  const post = async (url: string, body: { includeFollowUps?: boolean }) => {
    if (!url.endsWith('/review/next')) return { data: {} };
    const apps: Application[] = await fetchMarketApplications('m1');
    const handed = apps.find(
      (app) =>
        !isDecided(app) &&
        (body.includeFollowUps || app.status !== ApplicationStatus.NeedsFollowUp),
    );
    return { data: { application: handed ?? null } };
  };
  return { ...actual, api: { get: answered, post, put: answered, delete: answered } };
});

vi.mock('@/utils/applicantApi', () => ({
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
  reviewApplication: vi.fn(),
  changedSinceSeen: vi.fn(() => null),
  reassignFollowUp: vi.fn(),
  publishResults: vi.fn(),
}));

const VIEWER = 'You can view this market but not change it.';

function followUpApplication(email: string): Application {
  return {
    id: email,
    marketId: 'm1',
    applicantEmail: email,
    status: ApplicationStatus.NeedsFollowUp,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
    followUpOwner: { email: 'robin@org.test' },
  } as unknown as Application;
}

/** The market as the read serves it: the verdicts row refused with `refused`, or allowed. */
function market(refused: string | null, peopleOnMarket: string[]): Market {
  return {
    id: 'm1',
    actionRefusals: { ...answersRefusing(), [MarketAction.GiveVerdicts]: refused },
    peopleOnMarket,
    applicationForm: { fields: [] },
  } as unknown as Market;
}

/** Mount the review on a card that needs a follow-up, asking for follow-ups to be walked. */
async function mountFollowUpCard(refused: string | null, peopleOnMarket: string[]) {
  const wrapper = mount(ApplicationMonitor, {
    props: { market: market(refused, peopleOnMarket), visible: true },
  });
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-include-follow-ups"]').exists()).toBe(true);
  });
  await wrapper.get('[data-testid="app-monitor-include-follow-ups"]').setValue(true);
  await vi.waitFor(() => {
    expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(true);
  });
  return wrapper;
}

describe('who owns a follow-up on the card', () => {
  beforeEach(() => {
    fetchMarketApplications.mockResolvedValue([followUpApplication('nadia@ember.test')]);
  });

  const ownerField = (wrapper: Awaited<ReturnType<typeof mountFollowUpCard>>) =>
    wrapper.get('[data-testid="app-monitor-follow-up-owner-input"]');
  const fieldValue = (wrapper: Awaited<ReturnType<typeof mountFollowUpCard>>) =>
    (ownerField(wrapper).element as HTMLInputElement).value;
  const offered = (wrapper: Awaited<ReturnType<typeof mountFollowUpCard>>) =>
    wrapper
      .findAll('[data-testid="app-monitor-follow-up-owner-option"]')
      .map((row) => row.attributes('data-value'));

  it('a Viewer reads the recorded owner as plain text, not an empty control', async () => {
    const wrapper = await mountFollowUpCard(VIEWER, []);

    expect(wrapper.find('[data-testid="app-monitor-follow-up-owner-input"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="app-monitor-follow-up-owner"]').text()).toBe(
      'robin@org.test',
    );
  });

  it('an Editor or above still gets the chooser to hand the follow-up on', async () => {
    const wrapper = await mountFollowUpCard(null, ['robin@org.test']);
    const input = ownerField(wrapper);

    expect(fieldValue(wrapper)).toBe('robin@org.test');
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toBe('Followed up by');
  });

  it('an Editor whose people lack the recorded owner still reads that owner', async () => {
    // robin@org.test is an organization admin with no role on the market; the Editor is outside it.
    const wrapper = await mountFollowUpCard(null, ['owner@market.test', 'editor@market.test']);

    expect(fieldValue(wrapper)).toBe('robin@org.test');
    await ownerField(wrapper).trigger('click');
    // The recorded owner is only the current choice; the follow-up goes to the market's people.
    expect(offered(wrapper)).toEqual(['robin@org.test', 'owner@market.test', 'editor@market.test']);
    expect(
      wrapper
        .get('[data-testid="app-monitor-follow-up-owner-option"][aria-selected="true"]')
        .text(),
    ).toBe('robin@org.test');
  });

  describe('handing it on', () => {
    const EVERYONE = Array.from(
      { length: 150 },
      (_, n) => `person-${String(n + 1).padStart(3, '0')}@market.test`,
    );

    beforeEach(() => {
      vi.mocked(reassignFollowUp).mockReset();
    });

    it('finds one of 150 people by typing, and hands it to them', async () => {
      const handed = {
        ...followUpApplication('nadia@ember.test'),
        followUpOwner: { email: 'person-142@market.test' },
      } as Application;
      vi.mocked(reassignFollowUp).mockResolvedValue(handed);
      const wrapper = await mountFollowUpCard(null, EVERYONE);

      await ownerField(wrapper).setValue('person-142');
      expect(offered(wrapper)).toEqual(['person-142@market.test']);
      await ownerField(wrapper).trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(reassignFollowUp).toHaveBeenCalledTimes(1);
      expect(reassignFollowUp).toHaveBeenCalledWith(
        'm1',
        'nadia@ember.test',
        'person-142@market.test',
      );
      expect(fieldValue(wrapper)).toBe('person-142@market.test');
    });

    it('taking the owner again changes nothing', async () => {
      const wrapper = await mountFollowUpCard(null, ['robin@org.test', 'sam@market.test']);

      await ownerField(wrapper).trigger('click');
      await wrapper
        .get('[data-testid="app-monitor-follow-up-owner-option"][data-value="robin@org.test"]')
        .trigger('click');
      await flushPromises();

      expect(reassignFollowUp).not.toHaveBeenCalled();
      expect(fieldValue(wrapper)).toBe('robin@org.test');
    });

    it('words that take no one hand it to no one, and leave the owner named', async () => {
      const wrapper = await mountFollowUpCard(null, ['robin@org.test', 'sam@market.test']);

      await ownerField(wrapper).setValue('sam');
      await ownerField(wrapper).trigger('keydown', { key: 'Escape' });
      await flushPromises();

      expect(reassignFollowUp).not.toHaveBeenCalled();
      expect(fieldValue(wrapper)).toBe('robin@org.test');
    });

    it('a refused hand-on says so, and the field names the owner it still has', async () => {
      vi.mocked(reassignFollowUp).mockRejectedValue(new Error('refused'));
      const wrapper = await mountFollowUpCard(null, ['robin@org.test', 'sam@market.test']);

      await ownerField(wrapper).setValue('sam');
      await ownerField(wrapper).trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(reassignFollowUp).toHaveBeenCalledTimes(1);
      expect(fieldValue(wrapper)).toBe('robin@org.test');
      expect(wrapper.text()).toContain('Could not hand the follow-up over.');
    });
  });
});
