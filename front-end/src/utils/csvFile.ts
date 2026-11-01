/**
 * Reading the responses file an organizer drops, for the import and the start from a CSV alike
 * (E38/F15/S02).
 *
 * A binary named `responses.csv` decoded "as text" anyway and went on to the mapping step as one
 * column headed by garbled characters, every question unmapped. It stops here instead, where the
 * file is first read, with what to do about it; `parse_csv` on the server refuses the same.
 */

export const NOT_A_CSV_EXPORT =
  'This file does not look like a CSV export. Download the responses again from Google Forms as .csv.';

/** What reading a file came to: its text, or why it is refused. */
export type CsvFileRead = { text: string } | { error: string };

/**
 * A character no form's heading holds: a control character other than tab, line feed and carriage
 * return, or the replacement character a lossy decode leaves.
 */
const UNPRINTABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\uFFFD]/;

/**
 * Read a dropped or picked file as CSV text, or say why it is not one.
 *
 * Refused by name when neither its name nor its type says CSV (the picker filters, a drop does
 * not); refused as not a CSV export when it is not UTF-8 text, holds a NUL byte (a binary, or a
 * UTF-16 export), or its header row holds an unprintable character. A byte-order mark is dropped.
 * An empty file is passed on: the server says "That file is empty.", as it does for any reader.
 */
export async function readCsvFile(file: File): Promise<CsvFileRead> {
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    return { error: `${file.name} is not a CSV. Export your form responses as CSV and try again.` };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return { error: NOT_A_CSV_EXPORT };
  }
  const headerRow = text.split('\n', 1)[0] ?? '';
  if (text.includes('\u0000') || UNPRINTABLE.test(headerRow)) return { error: NOT_A_CSV_EXPORT };
  return { text };
}
