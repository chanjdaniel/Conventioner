/**
 * The import preview's headline (E38/F03/S02): what the import will write, and how many of the
 * rows the automatic rejections will reject. A pure function, so the wording and its counting are
 * tested apart from the view that shows it.
 */

export interface ImportPreviewCounts {
  rowCount: number;
  validRows: number;
  newRows: number;
  updatedRows: number;
  unchangedRows: number;
  rejected: number;
}

/**
 * How many rows the import will write: every row it will not skip, less those already here
 * unchanged. The headline and the confirm button both say it, so "4 of 5 rows will be imported" is
 * never confirmed with "Import 5 rows".
 */
export function writingRowCount(
  counts: Pick<ImportPreviewCounts, 'validRows' | 'newRows' | 'updatedRows' | 'unchangedRows'>,
): number {
  return counts.unchangedRows === 0 ? counts.validRows : counts.newRows + counts.updatedRows;
}

export function previewHeadline(counts: ImportPreviewCounts): string {
  const { rowCount, unchangedRows, rejected } = counts;
  const rows = `${rowCount} row${rowCount === 1 ? '' : 's'}`;
  const writingRows = writingRowCount(counts);

  if (unchangedRows === 0)
    return `${writingRows} of ${rows} will be imported${rejectedClause(true)}`;
  if (writingRows > 0) return `${writingRows} of ${rows} will be imported${rejectedClause(false)}`;
  return (
    `Nothing to import: ${unchangedRows} of ${rows} ${unchangedRows === 1 ? 'is' : 'are'} already here, unchanged` +
    rejectedClause(true)
  );

  /**
   * The count of the rows the import's judging will reject. The rows listed are those the judging
   * will reject, which may include an unchanged row a rule newly meets, so "of them" is dropped
   * when some rows are unchanged and others are written - the rejected count then is not all among
   * the rows the headline just counted.
   */
  function rejectedClause(ofThem: boolean): string {
    if (!rejected) return '';
    return `; ${rejected}${ofThem ? ' of them' : ''} will be rejected by your automatic rejections`;
  }
}

/**
 * What the preview says over the rows the automatic rejections will reject: a check of the rules,
 * and who may overturn one - whoever the market's table lets change a verdict (`whoMayTake`), so
 * a row its owner moved is named as it stands (E38/F06/S01). Null names nobody.
 */
export function rejectedRowsWhy(overturnedBy: string | null): string {
  const lead =
    'A check that your rules reject who they should. These are imported as rejected, each with its reason';
  return overturnedBy ? `${lead}; ${overturnedBy} can overturn one.` : `${lead}.`;
}
