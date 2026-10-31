/**
 * One by one's Next never puts the previous card back (E38/F07/S04, the Next race).
 *
 * The next card is the server's to hand out, a round trip after the click. Two hand-outs can be in
 * flight at once - a Next pressed again, a verdict, a refresh, a second load - and their answers can
 * come back in either order. Only the newest may put a card up: an answer to one a later hand-out
 * overtook is dropped, so the card on screen is always the one the newest answer gave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';

const fetchMarketApplications = vi.fn();
const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/api')>()),
  api,
}));

vi.mock('@/utils/applicantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/applicantApi')>()),
  fetchMarketApplications: (id: string) => fetchMarketApplications(id),
}));

function application(name: string): Application {
  return {
    id: name,
    marketId: 'm1',
    applicantEmail: `${name}@example.com`,
    status: ApplicationStatus.Open,
    formData: {},
    submittedAt: '2026-09-15T14:20:18.000Z',
  } as unknown as Application;
}

const AMY = application('amy');
const BEN = application('ben');
const CAL = application('cal');

const market = {
  id: 'm1',
  applicationForm: { fields: [{ key: 'shop', label: 'Shop', type: 'text' }] },
  actionRefusals: { 'give-verdicts': null, 'change-verdicts': null },
} as unknown as Market;

/** A hand-out's answer, held back until the test lets it go. */
function handOut() {
  let answer: (app: Application | null) => void = () => undefined;
  const pending = new Promise<{ data: { application: Application | null } }>((resolve) => {
    answer = (app) => resolve({ data: { application: app } });
  });
  return { pending, answer };
}

/** The hand-outs asked for, in the order they were asked. */
function handOuts() {
  return api.post.mock.calls.filter(([url]) => String(url).endsWith('/review/next'));
}

const shown = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get('[data-testid="app-monitor-email"]').text();

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMarketApplications.mockResolvedValue([AMY, BEN, CAL]);
  api.get.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: { held: true } });
  api.delete.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: { application: AMY } });
});
afterEach(() => vi.clearAllMocks());

describe('entering One by one', () => {
  it('reads the list once and asks for one card once', async () => {
    const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
    await flushPromises();

    expect(fetchMarketApplications).toHaveBeenCalledTimes(1);
    expect(handOuts()).toHaveLength(1);
    expect(shown(wrapper)).toBe('amy@example.com');
    wrapper.unmount();
  });
});

describe('two hand-outs in flight', () => {
  it("keeps the newest's card up when the first one answers last", async () => {
    const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
    await flushPromises();
    expect(shown(wrapper)).toBe('amy@example.com');

    const first = handOut();
    const second = handOut();
    api.post.mockReturnValueOnce(first.pending).mockReturnValueOnce(second.pending);
    await wrapper.get('[data-testid="app-monitor-next-button"]').trigger('click');
    await wrapper.get('[data-testid="app-monitor-next-button"]').trigger('click');
    expect(handOuts()).toHaveLength(3);

    second.answer(CAL);
    await flushPromises();
    expect(shown(wrapper)).toBe('cal@example.com');

    // The overtaken one answers last: its card never goes up.
    first.answer(BEN);
    await flushPromises();
    expect(shown(wrapper)).toBe('cal@example.com');
    wrapper.unmount();
  });

  it('a refresh keeps the card a Next put up while the list was being read', async () => {
    const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
    await flushPromises();

    const moved = handOut();
    api.post.mockReturnValueOnce(moved.pending);
    let reread: (apps: Application[]) => void = () => undefined;
    fetchMarketApplications.mockReturnValueOnce(new Promise((resolve) => (reread = resolve)));
    await wrapper.get('[data-testid="app-monitor-next-button"]').trigger('click');
    await wrapper.get('[data-testid="applications-refresh"]').trigger('click');

    moved.answer(BEN);
    await flushPromises();
    expect(shown(wrapper)).toBe('ben@example.com');

    reread([AMY, BEN, CAL]);
    await flushPromises();
    expect(shown(wrapper)).toBe('ben@example.com');
    wrapper.unmount();
  });

  it('a load overtaken by a later one puts up only the later one’s card', async () => {
    const first = handOut();
    api.post.mockReturnValueOnce(first.pending);
    const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
    await flushPromises();

    // Left and come back to before the first load's card arrived.
    await wrapper.setProps({ visible: false });
    api.post.mockResolvedValueOnce({ data: { application: CAL } });
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(shown(wrapper)).toBe('cal@example.com');

    first.answer(BEN);
    await flushPromises();
    expect(shown(wrapper)).toBe('cal@example.com');
    wrapper.unmount();
  });
});

describe('a verdict on the card', () => {
  it('asks the server for the next card, after the one decided, and puts that one up', async () => {
    const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
    await flushPromises();
    api.put.mockResolvedValueOnce({
      data: { application: { ...AMY, status: ApplicationStatus.ReviewerApproved } },
    });
    // The server hands out Cal, not Ben, who is next in the list: someone else may hold Ben.
    api.post.mockResolvedValueOnce({ data: { application: CAL } });

    await wrapper.get('[data-testid="app-monitor-approve-button"]').trigger('click');
    await flushPromises();

    expect(handOuts()).toHaveLength(2);
    expect(handOuts()[1][1]).toMatchObject({ after: 'amy' });
    expect(shown(wrapper)).toBe('cal@example.com');
    wrapper.unmount();
  });

  it('reloads nothing when the market is read again after it', async () => {
    const wrapper = mount(ApplicationMonitor, { props: { market, visible: true } });
    await flushPromises();

    // The store re-reads the market after every write: the same market, a new object.
    await wrapper.setProps({ market: { ...market } });
    await flushPromises();

    expect(fetchMarketApplications).toHaveBeenCalledTimes(1);
    expect(handOuts()).toHaveLength(1);
    wrapper.unmount();
  });
});
