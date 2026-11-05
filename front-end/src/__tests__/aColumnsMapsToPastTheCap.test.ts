/**
 * "Maps to" on a market of many questions (T223): the ways out of a column come first, so the cap on
 * what the list draws never hides them, and an unmapped row's list opens at its head.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';

import CsvImportView from '@/views/CsvImportView.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
const open = vi.hoisted(() => ({ market: null as unknown, refresh: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: { marketId: 'market-1' } }),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({ market: open.market, status: ref('ready'), refresh: open.refresh }),
}));

const IGNORE = '';
const NOWHERE_TO_GO = '__needs_a_field__';
const FIELD = 'import-target-select-1';

/** A file of an address and one unmapped column, on a market of `count` targets. */
function serveTargets(count: number) {
  api.post.mockImplementation(async (url: string) => {
    if (!url.endsWith('/import/inspect')) return { data: {} };
    return {
      data: {
        headers: ['Email Address', 'A column of its own'],
        sampleValues: [['ana-vendor@example.com'], ['Anything']],
        rowCount: 1,
        targets: [
          { key: 'applicant_email', label: 'Email', required: true, kind: 'identity' },
          ...Array.from({ length: count - 1 }, (_, at) => ({
            key: `question_${at}`,
            label: `Question ${at}`,
            required: false,
            kind: 'custom',
          })),
        ],
        groups: [],
        suggestedMapping: { applicant_email: 0 },
      },
    };
  });
}

async function mapColumns(count: number): Promise<VueWrapper> {
  serveTargets(count);
  open.market = ref({
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Draft,
    intakeMode: IntakeMode.Csv,
    actionRefusals: answersRefusing(),
    reviewTeam: { reviewers: [] },
    reviewerCandidates: [],
  } as unknown as Market);
  const wrapper = mount(CsvImportView, {
    global: { stubs: { MarketFrame: { template: '<div><slot /></div>' }, AmendFormDialog: true } },
  });
  const input = wrapper.get('[data-testid="import-file-input"]');
  const file = new File(['Email Address,A column of its own\na@example.com,x'], 'responses.csv', {
    type: 'text/csv',
  });
  Object.defineProperty(input.element, 'files', { value: [file] });
  await input.trigger('change');
  await flushPromises();
  return wrapper;
}

const openList = async (wrapper: VueWrapper) => {
  const field = wrapper.get(`[data-testid="${FIELD}-input"]`);
  await field.trigger('focus');
  await field.trigger('click');
  await flushPromises();
};
const rows = (wrapper: VueWrapper) => wrapper.findAll(`[data-testid="${FIELD}-option"]`);
const rowOf = (wrapper: VueWrapper, value: string) =>
  wrapper.find(`[data-testid="${FIELD}-option"][data-value="${value}"]`);

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockReset();
  open.refresh.mockReset();
  open.refresh.mockResolvedValue(undefined);
});

describe.each([48, 49, 50, 80])('a market of %i targets', (count) => {
  it('draws both ways out of a column with no words, whatever the cap leaves', async () => {
    const wrapper = await mapColumns(count);
    await openList(wrapper);
    expect(rowOf(wrapper, IGNORE).exists()).toBe(true);
    expect(rowOf(wrapper, NOWHERE_TO_GO).exists()).toBe(true);
    wrapper.unmount();
  });

  it('opens at its head: the ways out first, then what the column may mean', async () => {
    const wrapper = await mapColumns(count);
    await openList(wrapper);
    const values = rows(wrapper).map((row) => row.attributes('data-value'));
    expect(values.slice(0, 3)).toEqual([IGNORE, NOWHERE_TO_GO, 'applicant_email']);
    wrapper.unmount();
  });
});

describe('words typed in the list', () => {
  const type = async (wrapper: VueWrapper, words: string) => {
    await wrapper.get(`[data-testid="${FIELD}-input"]`).setValue(words);
    await flushPromises();
  };
  const list = (wrapper: VueWrapper) => wrapper.get('[role="listbox"]');

  it('draw only the groups they found, with no "None match" above the row', async () => {
    const wrapper = await mapColumns(80);
    await openList(wrapper);
    await type(wrapper, 'Question 42');
    expect(rows(wrapper).map((row) => row.attributes('data-value'))).toEqual(['question_42']);
    expect(list(wrapper).text()).not.toContain('None match');
    expect(list(wrapper).text()).not.toContain('Ignore');
    expect(list(wrapper).text()).not.toContain('Essential');
    expect(list(wrapper).text()).toContain('Your questions');
    wrapper.unmount();
  });

  it('that find nothing say so once', async () => {
    const wrapper = await mapColumns(80);
    await openList(wrapper);
    await type(wrapper, 'nothing holds this');
    expect(rows(wrapper)).toHaveLength(0);
    expect(list(wrapper).text()).toBe('Nothing matches "nothing holds this".');
    wrapper.unmount();
  });
});
