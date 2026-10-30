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

export function previewHeadline(counts: ImportPreviewCounts): string {
  const { rowCount, validRows, newRows, updatedRows, unchangedRows, rejected } = counts;
  const rows = `${rowCount} row${rowCount === 1 ? '' : 's'}`;
  const writingRows = unchangedRows === 0 ? validRows : newRows + updatedRows;

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
