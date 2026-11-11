/**
 * The CSV import asks before it drops a mapping not yet imported (T271).
 *
 * The column mapping and every value settled live in the page until the final confirm, so on Map
 * columns and Preview a move off the page asks first, and a reload is asked by the browser. Upload
 * holds no file, the done step has written it, and an import already running is not stopped by
 * leaving, so none of those asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { RouteLocationNormalized } from 'vue-router';

import CsvImportView from '@/views/CsvImportView.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { answerLeaveQuestion, leaveQuestion } from '@/utils/useUnsavedWork';
import { answersRefusing } from './support/servedAnswers';

type Guard = (to: RouteLocationNormalized, from: RouteLocationNormalized) => unknown;

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
const open = vi.hoisted(() => ({ market: null as unknown, refresh: vi.fn() }));
const guards = vi.hoisted(() => ({ leave: [] as Guard[], update: [] as Guard[] }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: { marketId: 'market-1' } }),
  onBeforeRouteLeave: (guard: Guard) => guards.leave.push(guard),
  onBeforeRouteUpdate: (guard: Guard) => guards.update.push(guard),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: open.market, status: ref('ready'), refresh: open.refresh }),
}));

const SENTENCE =
  'Nothing from this file is imported yet. Leaving drops the column mapping and every value you settled.';

const MARKET = {
  id: 'market-1',
  name: 'Riverside',
  phase: MarketPhase.Draft,
  intakeMode: IntakeMode.Csv,
  actionRefusals: answersRefusing(),
  reviewTeam: { reviewers: [] },
  reviewerCandidates: [],
} as unknown as Market;

/** The import's own address, and the market's Applications page a move would go to. */
const HERE = { path: '/markets/market-1/import', name: 'import-applications' };
const AWAY = { path: '/markets/market-1/applications', name: 'market-applications' };

let importAnswer: PromiseWithResolvers<unknown>;

beforeEach(() => {
  setActivePinia(createPinia());
  guards.leave.length = 0;
  guards.update.length = 0;
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.put.mockReset();
  api.post.mockReset();
  importAnswer = Promise.withResolvers<unknown>();
  api.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/import/inspect')) {
      return {
        data: {
          headers: ['Email Address'],
          sampleValues: [['ana-vendor@example.com']],
          rowCount: 1,
          targets: [{ key: 'applicant_email', label: 'Email', required: true, kind: 'identity' }],
          groups: [],
          suggestedMapping: { applicant_email: 0 },
        },
      };
    }
    if (url.endsWith('/import/preview')) return { data: { validRows: 1, newRows: 1 } };
    return importAnswer.promise;
  });
  open.refresh.mockReset();
  open.refresh.mockResolvedValue(undefined);
  open.market = ref(MARKET);
});

let wrapper: VueWrapper | null = null;
afterEach(() => {
  answerLeaveQuestion(false);
  wrapper?.unmount();
  wrapper = null;
});

function mountTheImport(): VueWrapper {
  wrapper = mount(CsvImportView, {
    global: { stubs: { MarketFrame: { template: '<div><slot /></div>' }, AmendFormDialog: true } },
    attachTo: document.body,
  });
  return wrapper;
}

async function chooseTheFile(view: VueWrapper) {
  const input = view.get('[data-testid="import-file-input"]');
  const file = new File(['Email Address\nana-vendor@example.com'], 'responses.csv', {
    type: 'text/csv',
  });
  Object.defineProperty(input.element, 'files', { value: [file] });
  await input.trigger('change');
  await flushPromises();
  expect(view.find('[data-testid="import-map"]').exists()).toBe(true);
}

async function press(view: VueWrapper, testid: string) {
  await view.get(`[data-testid="${testid}"]`).trigger('click');
  await flushPromises();
}

/** What a move from `from` to `to` would be told by the page's guards: the question's sentence, or nothing. */
function askedOnMove(
  to: { path: string; name: string },
  from: { path: string; name: string } = HERE,
): string | null {
  answerLeaveQuestion(false);
  for (const guard of [...guards.leave, ...guards.update]) {
    void guard(to as RouteLocationNormalized, from as RouteLocationNormalized);
  }
  const sentence = leaveQuestion.value?.sentence ?? null;
  answerLeaveQuestion(false);
  return sentence;
}

/** Whether a reload now would be asked by the browser. */
function askedOnUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('which steps of the import ask before they are left', () => {
  it('Upload asks nothing, holding no file', async () => {
    mountTheImport();
    await flushPromises();
    expect(guards.leave).toHaveLength(1);
    expect(guards.update).toHaveLength(1);
    expect(askedOnMove(AWAY)).toBeNull();
    expect(askedOnUnload()).toBe(false);
  });

  it("Map columns asks on a move and on a reload, in the import's words", async () => {
    const view = mountTheImport();
    await chooseTheFile(view);
    expect(askedOnMove(AWAY)).toBe(SENTENCE);
    expect(askedOnUnload()).toBe(true);
    // Another market's import is another page: the router keeps this one, and its file goes.
    expect(askedOnMove({ path: '/markets/market-2/import', name: 'import-applications' })).toBe(
      SENTENCE,
    );
    // The sign-in page never asks: nothing could be saved from there.
    expect(askedOnMove({ path: '/login', name: 'login' })).toBeNull();
  });

  it('Preview asks, an import running does not, and the done step does not', async () => {
    const view = mountTheImport();
    await chooseTheFile(view);
    await press(view, 'import-preview-button');
    expect(view.find('[data-testid="import-preview"]').exists()).toBe(true);
    expect(askedOnMove(AWAY)).toBe(SENTENCE);
    expect(askedOnUnload()).toBe(true);

    await press(view, 'import-confirm-button');
    expect(api.post).toHaveBeenCalledWith(
      '/markets/market-1/applications/import',
      expect.anything(),
    );
    expect(askedOnMove(AWAY)).toBeNull();
    expect(askedOnUnload()).toBe(false);

    importAnswer.resolve({ data: { created: 1, phase: MarketPhase.Applications } });
    await flushPromises();
    expect(view.find('[data-testid="import-result-summary"]').exists()).toBe(true);
    expect(askedOnMove(AWAY)).toBeNull();
    expect(askedOnUnload()).toBe(false);
  });

  it('an import that failed asks again, its file still unwritten', async () => {
    const view = mountTheImport();
    await chooseTheFile(view);
    await press(view, 'import-preview-button');
    await press(view, 'import-confirm-button');
    importAnswer.reject(new Error('Network Error'));
    await flushPromises();
    expect(view.find('[data-testid="import-preview"]').exists()).toBe(true);
    expect(askedOnMove(AWAY)).toBe(SENTENCE);
  });

  it('Back on Map columns returns to Upload, which asks nothing again', async () => {
    const view = mountTheImport();
    await chooseTheFile(view);
    await press(view, 'import-back-button');
    expect(view.find('[data-testid="import-map"]').exists()).toBe(false);
    expect(askedOnMove(AWAY)).toBeNull();
    expect(askedOnUnload()).toBe(false);
  });

  it('the page gone, nothing asks', async () => {
    const view = mountTheImport();
    await chooseTheFile(view);
    view.unmount();
    wrapper = null;
    expect(askedOnUnload()).toBe(false);
  });
});
