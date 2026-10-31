/**
 * The first import's preview step offers the reviewers (E38/F07/S02).
 *
 * A Google Form market's first import is its way into the review, so choosing the reviewers there
 * divides the review from the first row: the preview step shows the picker above its confirm, for
 * someone who may choose them. Confirming writes the reviewers when the choice differs from the
 * stored team, then imports, so the server deals the imported rows as arrivals. A redo import shows
 * no picker: by then the reviewers are the Reviewers panel's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { isRef, ref, type Ref } from 'vue';

import CsvImportView from '@/views/CsvImportView.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { PICKER_HINT } from '@/utils/reviewTeam';
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

const ANA = 'ana@example.com';
const BEN = 'ben@example.com';
const CAT = 'cat@example.com';

const SECTION = '[data-testid="import-reviewers"]';
const CONFIRM = '[data-testid="import-confirm-button"]';

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: 'market-1',
    name: 'Riverside',
    phase: MarketPhase.Draft,
    intakeMode: IntakeMode.Csv,
    actionRefusals: answersRefusing(),
    reviewTeam: { reviewers: [] },
    reviewerCandidates: [ANA, BEN, CAT],
    ...overrides,
  } as Market;
}

/** The server's answers for a file of one column the market reads, and three rows to write. */
function serveTheImport() {
  api.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/import/inspect')) {
      return {
        data: {
          headers: ['Email Address'],
          sampleValues: [['ana-vendor@example.com']],
          rowCount: 3,
          targets: [{ key: 'applicant_email', label: 'Email', required: true, kind: 'identity' }],
          groups: [],
          suggestedMapping: { applicant_email: 0 },
        },
      };
    }
    if (url.endsWith('/import/preview')) return { data: { validRows: 3, newRows: 3 } };
    return { data: { created: 3, phase: MarketPhase.Applications } };
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ data: { dealt: 0 } });
  open.refresh.mockReset();
  open.refresh.mockResolvedValue(undefined);
  serveTheImport();
});

/** Mount the import on `shown`, choose a file, and go on to the preview step. */
async function atPreview(shown: Market | Ref<Market>): Promise<VueWrapper> {
  open.market = isRef(shown) ? shown : ref(shown);
  const wrapper = mount(CsvImportView, {
    global: { stubs: { MarketFrame: { template: '<div><slot /></div>' }, AmendFormDialog: true } },
  });
  const input = wrapper.get('[data-testid="import-file-input"]');
  const file = new File(['Email Address\nana-vendor@example.com'], 'responses.csv', {
    type: 'text/csv',
  });
  Object.defineProperty(input.element, 'files', { value: [file] });
  await input.trigger('change');
  await flushPromises();
  await wrapper.get('[data-testid="import-preview-button"]').trigger('click');
  await flushPromises();
  expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(true);
  return wrapper;
}

async function tick(wrapper: VueWrapper, ...emails: string[]) {
  for (const email of emails) {
    await wrapper.get(`${SECTION} [data-testid="reviewer-picker-${email}"]`).setValue(true);
  }
}

async function confirm(wrapper: VueWrapper) {
  await wrapper.get(CONFIRM).trigger('click');
  await flushPromises();
}

const imports = () => api.post.mock.calls.filter(([url]) => String(url).endsWith('/import'));

describe('who meets the reviewers on the preview step', () => {
  it('an Admin on a first import: a Reviewers section with the picker and its hint, above the confirm', async () => {
    const wrapper = await atPreview(market());

    const section = wrapper.get(SECTION);
    expect(section.attributes('aria-label')).toBe('Reviewers');
    expect(section.find('[data-testid="reviewer-picker"]').exists()).toBe(true);
    expect(section.text()).toContain(PICKER_HINT);
    for (const email of [ANA, BEN, CAT]) {
      expect(
        (section.get(`[data-testid="reviewer-picker-${email}"]`).element as HTMLInputElement)
          .checked,
      ).toBe(false);
    }
    const html = wrapper.html();
    expect(html.indexOf('data-testid="import-reviewers"')).toBeLessThan(
      html.indexOf('data-testid="import-confirm-button"'),
    );
  });

  it('ticks the reviewers chosen before, in draft', async () => {
    const wrapper = await atPreview(
      market({ reviewTeam: { reviewers: [{ email: BEN, able: true }] } }),
    );

    const box = (email: string) =>
      (
        wrapper.get(`${SECTION} [data-testid="reviewer-picker-${email}"]`)
          .element as HTMLInputElement
      ).checked;
    expect([box(ANA), box(BEN), box(CAT)]).toEqual([false, true, false]);
  });

  it('a redo import shows no picker: the reviewers are the panel s', async () => {
    const wrapper = await atPreview(market({ phase: MarketPhase.Applications }));

    expect(wrapper.find(SECTION).exists()).toBe(false);
  });

  it('nor does it show for someone the table does not let choose them', async () => {
    const wrapper = await atPreview(
      market({ actionRefusals: answersRefusing(MarketAction.ChooseReviewers) }),
    );

    expect(wrapper.find(SECTION).exists()).toBe(false);
    await confirm(wrapper);
    expect(api.put).not.toHaveBeenCalled();
    expect(imports()).toHaveLength(1);
  });
});

describe('confirming', () => {
  it('writes the ticked reviewers, then imports', async () => {
    const wrapper = await atPreview(market());
    await tick(wrapper, ANA, BEN);
    await confirm(wrapper);

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0]).toEqual([
      '/markets/market-1/reviewers',
      { reviewers: [ANA, BEN] },
    ]);
    expect(imports()).toHaveLength(1);
    expect(api.put.mock.invocationCallOrder[0]).toBeLessThan(
      api.post.mock.invocationCallOrder[api.post.mock.calls.length - 1],
    );
    expect(wrapper.find('[data-testid="import-done"]').exists()).toBe(true);
  });

  it('with no one ticked imports exactly as before, writing no reviewers', async () => {
    const wrapper = await atPreview(market());
    await confirm(wrapper);

    expect(api.put).not.toHaveBeenCalled();
    expect(imports()).toHaveLength(1);
    expect(wrapper.find('[data-testid="import-done"]').exists()).toBe(true);
  });

  it('leaves an unchanged team unwritten', async () => {
    const wrapper = await atPreview(
      market({ reviewTeam: { reviewers: [{ email: ANA, able: true }] } }),
    );
    await confirm(wrapper);

    expect(api.put).not.toHaveBeenCalled();
    expect(imports()).toHaveLength(1);
  });

  it('a reviewers write that fails shows its error on the step and imports nothing', async () => {
    api.put.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { error: 'cat@example.com cannot be chosen here.' } },
    });
    const wrapper = await atPreview(market());
    await tick(wrapper, CAT);
    await confirm(wrapper);

    expect(imports()).toHaveLength(0);
    expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(true);
    expect(wrapper.get(`${SECTION} [data-testid="import-reviewers-error"]`).text()).toBe(
      'cat@example.com cannot be chosen here.',
    );
    expect(wrapper.get(CONFIRM).attributes('disabled')).toBeUndefined();
  });

  it('an import that fails after the write shows its error as today, and the reviewers stay chosen', async () => {
    const shown = ref(market());
    open.refresh.mockImplementation(async () => {
      shown.value = market({
        reviewTeam: { reviewers: [{ email: ANA, able: true }] },
      });
    });
    const wrapper = await atPreview(shown);
    api.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/import')) {
        throw {
          isAxiosError: true,
          response: { status: 500, data: { error: 'The import broke.' } },
        };
      }
      return { data: {} };
    });
    await tick(wrapper, ANA);
    await confirm(wrapper);

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(open.refresh).toHaveBeenCalled();
    expect(wrapper.get('[data-testid="import-error"]').text()).toBe('The import broke.');
    expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(true);
    expect(
      (wrapper.get(`${SECTION} [data-testid="reviewer-picker-${ANA}"]`).element as HTMLInputElement)
        .checked,
    ).toBe(true);

    // Trying again imports with the reviewers already stored: nothing to write before it.
    await confirm(wrapper);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(imports()).toHaveLength(2);
  });
});
