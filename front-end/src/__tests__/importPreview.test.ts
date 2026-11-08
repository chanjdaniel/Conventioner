/**
 * The import preview's headline (E38/F03/S02): what the import will write, and how many of those
 * rows the automatic rejections will reject - counted as the import's own judging counts them.
 */
import { describe, expect, it } from 'vitest';
import {
  findsRefusedRow,
  findsRejectedRow,
  findsReplacedRow,
  previewHeadline,
  rejectedRowsWhy,
  type ImportPreviewCounts,
} from '@/utils/importPreview';

function counts(overrides: Partial<ImportPreviewCounts>): ImportPreviewCounts {
  return {
    rowCount: 0,
    validRows: 0,
    newRows: 0,
    updatedRows: 0,
    unchangedRows: 0,
    rejected: 0,
    ...overrides,
  };
}

describe('the import preview headline', () => {
  it('counts every new row and the one rejection among them', () => {
    expect(previewHeadline(counts({ rowCount: 3, validRows: 3, newRows: 3, rejected: 1 }))).toBe(
      '3 of 3 rows will be imported; 1 of them will be rejected by your automatic rejections',
    );
  });

  it('drops "of them" when some rows are unchanged and others are written', () => {
    expect(
      previewHeadline(
        counts({
          rowCount: 5,
          validRows: 5,
          newRows: 2,
          updatedRows: 1,
          unchangedRows: 2,
          rejected: 2,
        }),
      ),
    ).toBe('3 of 5 rows will be imported; 2 will be rejected by your automatic rejections');
  });

  it('says what a nothing-to-import file will reject, in the future tense', () => {
    const headline = previewHeadline(
      counts({ rowCount: 4, validRows: 4, unchangedRows: 4, rejected: 1 }),
    );

    expect(headline).toBe(
      'Nothing to import: 4 of 4 rows are already here, unchanged; 1 of them will be rejected by your automatic rejections',
    );
    expect(headline).not.toContain('are rejected');
  });

  it('adds no rejection clause when nothing is rejected', () => {
    expect(previewHeadline(counts({ rowCount: 3, validRows: 3, newRows: 3 }))).toBe(
      '3 of 3 rows will be imported',
    );
  });
});

describe('what the preview says of the rows a rule rejects (E38/F03/S02, E38/F06/S01)', () => {
  it('names who the market lets overturn one, from its table', () => {
    expect(rejectedRowsWhy('an Admin or the owner')).toBe(
      'A check that your rules reject who they should. These are imported as rejected, each with its reason; an Admin or the owner can overturn one.',
    );
    expect(rejectedRowsWhy('an Editor, an Admin or the owner')).toContain(
      'an Editor, an Admin or the owner can overturn one.',
    );
  });

  it('names nobody when the market read carries no such row', () => {
    expect(rejectedRowsWhy(null)).toBe(
      'A check that your rules reject who they should. These are imported as rejected, each with its reason.',
    );
  });
});

describe('finding a row of the preview, capitals aside', () => {
  const refused = {
    row: 31,
    email: 'lena@fixture.test',
    error: "'Full name' is required.",
  };

  it('finds a refused row by its address, its row number and its reason', () => {
    expect(findsRefusedRow(refused, 'LENA@')).toBe(true);
    expect(findsRefusedRow(refused, '31')).toBe(true);
    expect(findsRefusedRow(refused, 'row 31')).toBe(true);
    expect(findsRefusedRow(refused, 'FULL NAME')).toBe(true);
    expect(findsRefusedRow(refused, 'row 32')).toBe(false);
    expect(findsRefusedRow(refused, 'nobody')).toBe(false);
  });

  it('finds a refused row with no address, as a blank row is', () => {
    const blank = { row: 5, email: '', error: 'Every column this import reads is empty.' };
    expect(findsRefusedRow(blank, 'empty')).toBe(true);
    expect(findsRefusedRow(blank, 'row 5')).toBe(true);
    expect(findsRefusedRow(blank, 'undefined')).toBe(false);
  });

  it('finds a replaced row by its address and either row it names', () => {
    const replaced = { row: 7, email: 'omar@fixture.test', latestRow: 44 };
    expect(findsReplacedRow(replaced, 'OMAR')).toBe(true);
    expect(findsReplacedRow(replaced, 'row 7')).toBe(true);
    expect(findsReplacedRow(replaced, '44')).toBe(true);
    expect(findsReplacedRow(replaced, 'row 8')).toBe(false);
  });

  it('finds a rejected row by its name and address, not its number or reason', () => {
    const rejected = {
      row: 12,
      email: 'ines@fixture.test',
      name: 'Ines Marlow',
      reason: 'Answered "Half" to "Table choice"',
    };
    expect(findsRejectedRow(rejected, 'marlow')).toBe(true);
    expect(findsRejectedRow(rejected, 'INES@')).toBe(true);
    expect(findsRejectedRow(rejected, '12')).toBe(false);
    expect(findsRejectedRow(rejected, 'half')).toBe(false);
  });
});
