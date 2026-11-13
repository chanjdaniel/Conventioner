// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';

import CsvImportView from '@/views/CsvImportView.vue';
import StartFromCsvView from '@/views/StartFromCsvView.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import {
  IMPORT_FILE_TOO_LARGE,
  MAX_RESPONSES_FILE_BYTES,
  START_FILE_TOO_LARGE,
  readCsvFile,
} from '@/utils/csvFile';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: { marketId: 'market-1' } }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));
vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/openMarket', () => ({
  useOpenMarket: () => ({
    market: ref({
      id: 'market-1',
      name: 'Riverside',
      phase: MarketPhase.Draft,
      intakeMode: IntakeMode.Csv,
      actionRefusals: answersRefusing(),
      reviewTeam: { reviewers: [] },
    } as unknown as Market),
    status: ref('ready'),
    refresh: vi.fn(),
  }),
}));

/**
 * A responses file too large for one request is refused before it is sent (T315 08): the host
 * refuses a body over 4.5 MB before the back end sees it, and an organizer was told the import
 * could not be completed, or that they seemed to be offline, and tried again.
 */
const SENTENCE = 'This file is too large.';
const HEADER = 'Email Address\n';
/** A file's start that JSON carries as it is: one row, and no line break to escape. */
const PLAIN_START = 'Email Address,';

function fileOf(content: BlobPart): File {
  return new File([content], 'responses.csv', { type: 'text/csv' });
}

/** A file of `bytes` bytes that JSON carries as they are: one row of plain letters. */
function plainFileOf(bytes: number): File {
  return fileOf(PLAIN_START + 'a'.repeat(bytes - PLAIN_START.length));
}

/** The bytes JSON gives the text, without the string's quotes: what the request carries of it. */
function escapedBytes(text: string): number {
  return new TextEncoder().encode(JSON.stringify(text)).length - 2;
}

/** A file under the bound by its bytes that passes it once JSON escapes each line break and quote. */
function fileOverOnlyOnceEscaped(): File {
  const row = 'a,"b"\n';
  const rows = Math.ceil((MAX_RESPONSES_FILE_BYTES * 2) / 3 / row.length);
  return fileOf(HEADER + row.repeat(rows));
}

describe('reading a responses file against the bound', () => {
  it('holds the host-limited bound the floorplan upload holds', () => {
    expect(MAX_RESPONSES_FILE_BYTES).toBe(4_000_000);
  });

  it('takes a file at the bound', async () => {
    const file = plainFileOf(MAX_RESPONSES_FILE_BYTES);
    expect(file.size).toBe(MAX_RESPONSES_FILE_BYTES);

    const read = await readCsvFile(file, SENTENCE);

    expect('text' in read && read.text.length).toBe(MAX_RESPONSES_FILE_BYTES);
  });

  it('refuses a file one byte over the bound by its size, without reading it', async () => {
    const file = plainFileOf(MAX_RESPONSES_FILE_BYTES + 1);
    const reads = vi.spyOn(file, 'arrayBuffer');

    expect(await readCsvFile(file, SENTENCE)).toEqual({ error: SENTENCE });
    expect(reads).not.toHaveBeenCalled();
  });

  it('takes a file at the bound once escaped', async () => {
    // A line break is two bytes in the request, so a row of one letter is two bytes in the file
    // and three in the request: 1,333,333 of them and one letter more is the bound exactly.
    const file = fileOf('a\n'.repeat(Math.floor(MAX_RESPONSES_FILE_BYTES / 3)) + 'a');
    expect(file.size).toBeLessThan(MAX_RESPONSES_FILE_BYTES);
    const text = await file.text();
    expect(escapedBytes(text)).toBe(MAX_RESPONSES_FILE_BYTES);

    expect(await readCsvFile(file, SENTENCE)).toEqual({ text });
  });

  it('refuses a file under the bound whose text passes it once escaped', async () => {
    const file = fileOverOnlyOnceEscaped();
    expect(file.size).toBeLessThan(MAX_RESPONSES_FILE_BYTES);
    expect(escapedBytes(await file.text())).toBeGreaterThan(MAX_RESPONSES_FILE_BYTES);

    expect(await readCsvFile(file, SENTENCE)).toEqual({ error: SENTENCE });
  });

  it('counts an accented answer by its UTF-8 bytes, as the request does', async () => {
    // "é" is two bytes in the file and in the request: at the bound it is taken, past it refused.
    const at = fileOf(
      PLAIN_START + 'é'.repeat((MAX_RESPONSES_FILE_BYTES - PLAIN_START.length) / 2),
    );
    expect(at.size).toBe(MAX_RESPONSES_FILE_BYTES);
    expect('text' in (await readCsvFile(at, SENTENCE))).toBe(true);

    const past = fileOf(
      PLAIN_START + 'é'.repeat((MAX_RESPONSES_FILE_BYTES - PLAIN_START.length) / 2) + 'a',
    );
    expect(await readCsvFile(past, SENTENCE)).toEqual({ error: SENTENCE });
  });
});

describe("each screen's sentence", () => {
  it('tells the import to split the file', () => {
    expect(IMPORT_FILE_TOO_LARGE).toBe(
      'This file is too large to send: one import carries at most 4 MB. Split its rows into smaller files, each with the header row, and import them one after another.',
    );
  });

  it('tells the start to begin from fewer rows', () => {
    expect(START_FILE_TOO_LARGE).toBe(
      'This file is too large to send: one upload carries at most 4 MB. Start from a copy with fewer rows, keeping the header row.',
    );
  });
});

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockReset();
});

const STUBS = { global: { stubs: { MarketFrame: { template: '<div><slot /></div>' } } } };

async function choose(wrapper: VueWrapper, input: string, file: File) {
  const element = wrapper.get(`[data-testid="${input}"]`);
  Object.defineProperty(element.element, 'files', { value: [file], configurable: true });
  await element.trigger('change');
  await flushPromises();
}

describe('the screens', () => {
  it.each([
    ['over the bound', () => plainFileOf(MAX_RESPONSES_FILE_BYTES + 1)],
    ['over only once escaped', fileOverOnlyOnceEscaped],
  ])('the import stops a file %s on the upload step, and sends nothing', async (_, file) => {
    const wrapper = mount(CsvImportView, STUBS);
    await flushPromises();

    await choose(wrapper, 'import-file-input', file());

    expect(wrapper.get('[data-testid="import-error"]').text()).toBe(IMPORT_FILE_TOO_LARGE);
    expect(wrapper.find('[data-testid="import-upload"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    ['over the bound', () => plainFileOf(MAX_RESPONSES_FILE_BYTES + 1)],
    ['over only once escaped', fileOverOnlyOnceEscaped],
  ])('the start stops a file %s on the upload step, and sends nothing', async (_, file) => {
    const wrapper = mount(StartFromCsvView, STUBS);
    await flushPromises();

    await choose(wrapper, 'start-from-csv-file-input', file());

    expect(wrapper.get('[data-testid="start-from-csv-error"]').text()).toBe(START_FILE_TOO_LARGE);
    expect(wrapper.find('[data-testid="start-from-csv-upload"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});
