/**
 * The import preview's headline (E38/F03/S02): what the import will write, and how many of those
 * rows the automatic rejections will reject - counted as the import's own judging counts them.
 */
import { describe, expect, it } from 'vitest';
import { previewHeadline, type ImportPreviewCounts } from '@/utils/importPreview';

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
