// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';

import CsvImportView from '@/views/CsvImportView.vue';
import StartFromCsvView from '@/views/StartFromCsvView.vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { NOT_A_CSV_EXPORT, readCsvFile } from '@/utils/csvFile';
import type { Proposal, ProposedColumn } from '@/utils/csvProposal';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: { marketId: 'market-1' } }),
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
 * A file that is not a CSV export says so at the import (E38/F15/S02): a binary named
 * `responses.csv` went on to the mapping step as one column headed by garbled characters.
 */
function fileOf(content: BlobPart, name = 'responses.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

/** An invented binary: a few format magic bytes, then every byte value once. */
function generatedBinary(): Uint8Array {
  const bytes = new Uint8Array(4 + 256);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  for (let value = 0; value < 256; value += 1) bytes[4 + value] = value;
  return bytes;
}

describe('reading a CSV file', () => {
  it('refuses a binary file named .csv as not a CSV export', async () => {
    expect(await readCsvFile(fileOf(generatedBinary()))).toEqual({ error: NOT_A_CSV_EXPORT });
  });

  it('refuses text that holds a NUL byte, such as a UTF-16 export without its mark', async () => {
    const utf16 = new Uint8Array([0x41, 0x00, 0x2c, 0x00, 0x42, 0x00, 0x0a, 0x00]);
    expect(await readCsvFile(fileOf(utf16))).toEqual({ error: NOT_A_CSV_EXPORT });
  });

  it('refuses a header row that holds an unprintable character', async () => {
    const zipLike = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x06, 0x0a, 0x41, 0x0a]);
    expect(await readCsvFile(fileOf(zipLike))).toEqual({ error: NOT_A_CSV_EXPORT });
  });

  it('says what the message asks of the organizer', () => {
    expect(NOT_A_CSV_EXPORT).toBe(
      'This file does not look like a CSV export. Download the responses again from Google Forms as .csv.',
    );
  });

  it('passes an empty file on, for the server to say it is empty', async () => {
    expect(await readCsvFile(fileOf(''))).toEqual({ text: '' });
  });

  it('accepts a one-column CSV', async () => {
    expect(await readCsvFile(fileOf('Email Address\nada@example.test\n'))).toEqual({
      text: 'Email Address\nada@example.test\n',
    });
  });

  it('accepts a UTF-8 CSV with a BOM, and drops the BOM', async () => {
    const withBom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('Timestamp,Business name\n1/1/2026,Café Ada\n'),
    ]);
    expect(await readCsvFile(fileOf(withBom))).toEqual({
      text: 'Timestamp,Business name\n1/1/2026,Café Ada\n',
    });
  });

  it('keeps tabs, line breaks inside quotes and accented answers', async () => {
    const text = 'Name,"Long\r\nanswer"\r\nZoë,"one\ttwo"\r\n';
    expect(await readCsvFile(fileOf(text))).toEqual({ text });
  });

  // The edges of the unprintable set, on both sides of each bound. The same table runs through
  // `parse_csv` in back-end/tests/test_csv_import.py (TestAFileThatIsNotCsv); keep the two alike.
  describe('the edges of the unprintable set', () => {
    /** Each character with its code point, for a test's title. */
    const named = (chars: string[]) =>
      chars.map((ch) => [
        `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
        ch,
      ]);

    it.each(named(['\x08', '\x0b', '\x0c', '\x1f', '\x7f', '\x9f', '\uFFFD']))(
      'refuses %s in the header row',
      async (_name, ch) => {
        expect(await readCsvFile(fileOf(`Name${ch}x\nAda\n`))).toEqual({ error: NOT_A_CSV_EXPORT });
      },
    );

    it.each(named(['\t', '\x20', '\x7e', '\xa0']))(
      'accepts %s in the header row',
      async (_name, ch) => {
        const text = `Name${ch}x\nAda\n`;
        expect(await readCsvFile(fileOf(text))).toEqual({ text });
      },
    );
  });

  it('refuses a file that is not named or typed as a CSV, by its name', async () => {
    const pdf = new File(['%PDF-1.4'], 'responses.pdf', { type: 'application/pdf' });
    expect(await readCsvFile(pdf)).toEqual({
      error: 'responses.pdf is not a CSV. Export your form responses as CSV and try again.',
    });
  });
});

/** The server's inspect for a file of `headers`, one row of answers. */
function serveInspect(headers: string[]) {
  api.post.mockResolvedValue({
    data: {
      headers,
      sampleValues: headers.map(() => ['answer']),
      rowCount: 1,
      targets: [],
      groups: [],
      suggestedMapping: {},
    },
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ data: {} });
  api.post.mockReset();
  serveInspect(['Email Address']);
});

const STUBS = { global: { stubs: { MarketFrame: { template: '<div><slot /></div>' } } } };

async function choose(wrapper: VueWrapper, input: string, file: File) {
  const element = wrapper.get(`[data-testid="${input}"]`);
  Object.defineProperty(element.element, 'files', { value: [file], configurable: true });
  await element.trigger('change');
  await flushPromises();
}

describe('the import', () => {
  it('stops a binary named .csv on the upload step, with the message, and sends nothing', async () => {
    const wrapper = mount(CsvImportView, STUBS);
    await flushPromises();

    await choose(wrapper, 'import-file-input', fileOf(generatedBinary()));

    expect(wrapper.get('[data-testid="import-error"]').text()).toBe(NOT_A_CSV_EXPORT);
    expect(wrapper.find('[data-testid="import-upload"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="import-map"]').exists()).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('counts one column as one', async () => {
    const wrapper = mount(CsvImportView, STUBS);
    await flushPromises();

    await choose(wrapper, 'import-file-input', fileOf('Email Address\nada@example.test\n'));

    expect(wrapper.get('[data-testid="import-column-count"]').text()).toBe('1 column in this file');
  });

  it('counts two columns as two', async () => {
    serveInspect(['Timestamp', 'Email Address']);
    const wrapper = mount(CsvImportView, STUBS);
    await flushPromises();

    await choose(wrapper, 'import-file-input', fileOf('Timestamp,Email Address\n1,a\n'));

    expect(wrapper.get('[data-testid="import-column-count"]').text()).toBe(
      '2 columns in this file',
    );
  });
});

describe('the start from a CSV', () => {
  it('stops a binary named .csv on the upload step, with the message, and sends nothing', async () => {
    const wrapper = mount(StartFromCsvView, STUBS);
    await flushPromises();

    await choose(wrapper, 'start-from-csv-file-input', fileOf(generatedBinary()));

    expect(wrapper.get('[data-testid="start-from-csv-error"]').text()).toBe(NOT_A_CSV_EXPORT);
    expect(wrapper.find('[data-testid="start-from-csv-upload"]').exists()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});

/** The proposal for a file of `columns` columns and `responses` responses, every column left out. */
function proposalOf(columns: number, responses: number): Proposal {
  return {
    rowCount: responses,
    responses,
    columns: Array.from({ length: columns }, (_, index): ProposedColumn => ({
      index,
      header: `Column ${index}`,
      group: null,
      answered: responses,
      firstAnswers: [],
      fate: 'left_out',
      essential: null,
      leftOut: null,
      why: 'Left out',
      check: [],
      field: null,
    })),
    plan: { dates: [], year: null, tiers: [], ceiling: null, disagreements: [], check: [] },
    notAsked: [],
    typesafe: { asked: false },
  };
}

describe("the start's summary", () => {
  async function summaryFor(columns: number, responses: number): Promise<string> {
    api.post.mockResolvedValue({ data: proposalOf(columns, responses) });
    const wrapper = mount(StartFromCsvView, {
      global: {
        stubs: { MarketFrame: { template: '<div><slot /></div>' }, ProposalLedger: true },
      },
    });
    await flushPromises();
    await choose(wrapper, 'start-from-csv-file-input', fileOf('Email Address\nada@example.test\n'));
    return wrapper.get('[data-testid="start-from-csv-summary"]').text().replace(/\s+/g, ' ');
  }

  it('counts one column and one response as one', async () => {
    expect(await summaryFor(1, 1)).toBe('responses.csv · 1 response · 1 column');
  });

  it('counts two of each as two', async () => {
    expect(await summaryFor(2, 2)).toBe('responses.csv · 2 responses · 2 columns');
  });
});
