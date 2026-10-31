/**
 * One by one hands out my share first, then offers the rest (E38/F07/S04, ADR 0020).
 *
 * With the review dealt among chosen reviewers, One by one still walked the whole queue, everyone's
 * share mixed. A chosen reviewer is now handed their own share, "1 of N in your share", and once it
 * has nothing left the card area says so and offers the others' with "Help with the others". Anyone
 * else, or everyone with nobody chosen, walks the whole queue as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { answersRefusing } from './support/servedAnswers';

const ME = 'ana@example.com';
const SAM = 'sam@example.com';

const fetchMarketApplications = vi.fn();
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  api,
}));
vi.mock('@/utils/applicantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/applicantApi')>()),
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
}));
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => ME }));

function application(name: string, day: number, reviewer: string | null): Application {
  return {
    id: name,
    marketId: 'm1',
    applicantEmail: `${name}@vendor.test`,
    status: ApplicationStatus.Open,
    formData: {},
    submittedAt: `2026-09-${String(day).padStart(2, '0')}T09:00:00.000Z`,
    reviewer: reviewer ? { userId: reviewer, email: reviewer } : null,
  } as unknown as Application;
}

/** A market in the review, with the team chosen. */
function market(): Market {
  return {
    id: 'm1',
    phase: 'applications',
    roles: {},
    applicationForm: { fields: [{ key: 'shop', label: 'Shop', type: 'text' }] },
    reviewTeam: {
      reviewers: team.map((email) => ({ email, able: true })),
    },
    actionRefusals: {
      ...answersRefusing(),
      [MarketAction.GiveVerdicts]: null,
      [MarketAction.ChangeVerdicts]: null,
    },
  } as unknown as Market;
}

/**
 * The server as One by one meets it: the stored applications, the share first for a chosen
 * reviewer and with `mineOnly` nothing else, a verdict written over what is stored.
 */
let stored: Application[] = [];
let team: string[] = [];

function serve() {
  fetchMarketApplications.mockImplementation(async () => stored.map((app) => ({ ...app })));
  api.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (!url.endsWith('/review/next')) return { data: {} };
    const open = stored
      .filter((app) => app.status === ApplicationStatus.Open && !app.heldBy)
      .sort((a, b) => Date.parse(a.submittedAt as string) - Date.parse(b.submittedAt as string));
    const at = open.findIndex((app) => app.id === body.after) + 1;
    const order = [...open.slice(at), ...open.slice(0, at)];
    const mine = order.filter((app) => app.reviewer?.email === ME);
    const walk = team.includes(ME)
      ? body.mineOnly
        ? mine
        : [...mine, ...order.filter((app) => app.reviewer?.email !== ME)]
      : order;
    return { data: { application: walk[0] ? { ...walk[0] } : null } };
  });
  api.put.mockImplementation(async (url: string, body: { status?: string }) => {
    const id = url.match(/applications\/([^/]+)\/review$/)?.[1];
    if (!id) return { data: { held: true } };
    const app = stored.find((a) => a.id === id) as Application;
    app.status = body.status as ApplicationStatus;
    return { data: { application: { ...app } } };
  });
}

/** Two of five are Ana's: amy and cal. The rest are Sam's. */
function fiveDealt() {
  team = [ME, SAM];
  stored = [
    application('amy', 1, ME),
    application('ben', 2, SAM),
    application('cal', 3, ME),
    application('dot', 4, SAM),
    application('eve', 5, SAM),
  ];
}

const handOuts = () => api.post.mock.calls.filter(([url]) => String(url).endsWith('/review/next'));
const lastAsk = () => handOuts().at(-1)?.[1] as Record<string, unknown>;

async function monitor() {
  serve();
  const wrapper = mount(ApplicationMonitor, {
    props: reactive({ market: market(), visible: true }),
  });
  await flushPromises();
  return wrapper;
}

const text = (wrapper: Awaited<ReturnType<typeof monitor>>, id: string) =>
  wrapper.get(`[data-testid="${id}"]`).text();
const shown = (wrapper: Awaited<ReturnType<typeof monitor>>) => text(wrapper, 'app-monitor-email');

async function approve(wrapper: Awaited<ReturnType<typeof monitor>>) {
  await wrapper.get('[data-testid="app-monitor-approve-button"]').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const call of Object.values(api)) {
    call.mockReset();
    call.mockResolvedValue({ data: {} });
  }
  fetchMarketApplications.mockReset();
  fiveDealt();
});

describe('a chosen reviewer', () => {
  it('is handed their share first, counted as their share', async () => {
    const wrapper = await monitor();

    expect(lastAsk()).toMatchObject({ mineOnly: true });
    expect(shown(wrapper)).toBe('amy@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 2 in your share');

    await wrapper.get('[data-testid="app-monitor-next-button"]').trigger('click');
    await flushPromises();
    expect(shown(wrapper)).toBe('cal@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('2 of 2 in your share');
  });

  it('reads that their share is done once it is decided, and how many are left to others', async () => {
    const wrapper = await monitor();
    await approve(wrapper);
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 1 in your share');
    await approve(wrapper);

    expect(lastAsk()).toMatchObject({ mineOnly: true });
    expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(false);
    expect(text(wrapper, 'app-monitor-share-done')).toContain('Your share is done.');
    expect(text(wrapper, 'app-monitor-share-done-others')).toBe(
      "3 open applications are dealt to other reviewers. You can help with them; each one's history will say you decided it.",
    );
    expect(text(wrapper, 'app-monitor-help-others')).toBe('Help with the others');
    expect(wrapper.find('[data-testid="app-monitor-all-held"]').exists()).toBe(false);
    expect(text(wrapper, 'app-monitor-tally')).toContain('2 reviewed');
  });

  it('goes on through the rest after "Help with the others", each card warning whose it is', async () => {
    stored.forEach((app) => {
      if (app.reviewer?.email === ME) app.status = ApplicationStatus.ReviewerApproved;
    });
    const wrapper = await monitor();
    expect(text(wrapper, 'app-monitor-share-done')).toContain('Your share is done.');

    await wrapper.get('[data-testid="app-monitor-help-others"]').trigger('click');
    await flushPromises();

    expect(lastAsk()).not.toHaveProperty('mineOnly');
    expect(shown(wrapper)).toBe('ben@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 3 to review');
    expect(text(wrapper, 'app-monitor-dealt-warning')).toContain(`dealt to ${SAM}`);

    await approve(wrapper);
    expect(shown(wrapper)).toBe('dot@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 2 to review');
  });

  it('is still handed a new arrival dealt to them first while helping', async () => {
    stored.forEach((app) => {
      if (app.reviewer?.email === ME) app.status = ApplicationStatus.ReviewerApproved;
    });
    const wrapper = await monitor();
    await wrapper.get('[data-testid="app-monitor-help-others"]').trigger('click');
    await flushPromises();

    stored.push(application('fay', 6, ME));
    await approve(wrapper);

    expect(shown(wrapper)).toBe('fay@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 1 in your share');
  });

  it('says it of one left to others in the singular', async () => {
    stored = stored.filter((app) => ['amy', 'ben'].includes(app.id));
    stored[0].status = ApplicationStatus.ReviewerApproved;
    const wrapper = await monitor();

    expect(text(wrapper, 'app-monitor-share-done-others')).toBe(
      '1 open application is dealt to another reviewer. You can help with it; its history will say you decided it.',
    );
  });

  it('reads that every one left is open with another reviewer when the rest of their share is', async () => {
    stored[0].status = ApplicationStatus.ReviewerApproved;
    stored[2].heldBy = { userId: SAM, email: SAM };
    const wrapper = await monitor();

    expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(false);
    expect(text(wrapper, 'app-monitor-all-held')).toContain(
      `Every application left in your share is open with another reviewer: ${SAM}.`,
    );
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 in your share');
    expect(wrapper.find('[data-testid="app-monitor-share-done"]').exists()).toBe(false);
  });

  it('moves from done to their share when a refresh finds a new one dealt to them', async () => {
    stored.forEach((app) => {
      if (app.reviewer?.email === ME) app.status = ApplicationStatus.ReviewerApproved;
    });
    const wrapper = await monitor();
    expect(text(wrapper, 'app-monitor-share-done')).toContain('Your share is done.');

    stored.push(application('fay', 6, ME));
    await wrapper.get('[data-testid="applications-refresh"]').trigger('click');
    await flushPromises();

    expect(shown(wrapper)).toBe('fay@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 1 in your share');
  });

  it('moves to done when a refresh finds the rest of their share decided elsewhere', async () => {
    stored[2].status = ApplicationStatus.ReviewerApproved;
    const wrapper = await monitor();
    expect(shown(wrapper)).toBe('amy@vendor.test');

    stored[0].status = ApplicationStatus.ReviewerRejected;
    await wrapper.get('[data-testid="applications-refresh"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(false);
    expect(text(wrapper, 'app-monitor-share-done')).toContain('Your share is done.');
  });

  it('puts up only the newest hand-out when a refresh overtakes a Next', async () => {
    const wrapper = await monitor();
    let answerNext: (app: Application | null) => void = () => undefined;
    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => (answerNext = (app) => resolve({ data: { application: app } }))),
    );
    await wrapper.get('[data-testid="app-monitor-next-button"]').trigger('click');
    stored.forEach((app) => {
      if (app.reviewer?.email === ME) app.status = ApplicationStatus.ReviewerApproved;
    });
    await wrapper.get('[data-testid="applications-refresh"]').trigger('click');
    await flushPromises();

    answerNext(application('cal', 3, ME));
    await flushPromises();
    expect(wrapper.find('[data-testid="app-monitor-card"]').exists()).toBe(false);
    expect(text(wrapper, 'app-monitor-share-done')).toContain('Your share is done.');
  });
});

describe('anyone else', () => {
  it('walks the whole queue when not chosen', async () => {
    team = [SAM];
    const wrapper = await monitor();

    expect(shown(wrapper)).toBe('amy@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 5 to review');
    await wrapper.get('[data-testid="app-monitor-next-button"]').trigger('click');
    await flushPromises();
    expect(shown(wrapper)).toBe('ben@vendor.test');
    expect(text(wrapper, 'app-monitor-progress')).toBe('2 of 5 to review');
  });

  it('walks the whole queue with nobody chosen', async () => {
    team = [];
    const wrapper = await monitor();

    expect(lastAsk()).not.toHaveProperty('mineOnly');
    expect(text(wrapper, 'app-monitor-progress')).toBe('1 of 5 to review');
    await approve(wrapper);
    await approve(wrapper);
    expect(shown(wrapper)).toBe('cal@vendor.test');
    expect(wrapper.find('[data-testid="app-monitor-share-done"]').exists()).toBe(false);
  });
});
