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

/**
 * The most a responses file may carry, in bytes of the JSON string the import and the start send
 * it as: the host refuses a request body over 4.5 MB before the back end sees it
 * (`back-end/host_limits.py`, `MAX_REQUEST_BODY_BYTES`), so the file is held to the 4 MB the
 * floorplan upload holds (`floorplan_limits.MAX_UPLOAD_BYTES`), leaving the rest for the request's
 * other fields.
 */
export const MAX_RESPONSES_FILE_BYTES = 4_000_000;

/**
 * Each screen's words for a file too large to send. "Too large to send" rather than "larger than
 * 4 MB", since JSON's escapes make the request larger than the file. Splitting is safe: a later
 * import leaves the applications an earlier one brought in as they are (ADR 0011).
 */
export const IMPORT_FILE_TOO_LARGE =
  'This file is too large to send: one import carries at most 4 MB. Split its rows into smaller files, each with the header row, and import them one after another.';
export const START_FILE_TOO_LARGE =
  'This file is too large to send: one upload carries at most 4 MB. Start from a copy with fewer rows, keeping the header row.';

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
 *
 * Refused as `tooLarge`, the caller's sentence, when it passes `MAX_RESPONSES_FILE_BYTES`: by its
 * size before it is read, and by its text as JSON escapes it once read.
 */
export async function readCsvFile(file: File, tooLarge: string): Promise<CsvFileRead> {
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    return { error: `${file.name} is not a CSV. Export your form responses as CSV and try again.` };
  }
  if (file.size > MAX_RESPONSES_FILE_BYTES) return { error: tooLarge };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return { error: NOT_A_CSV_EXPORT };
  }
  const headerRow = text.split('\n', 1)[0] ?? '';
  if (text.includes('\u0000') || UNPRINTABLE.test(headerRow)) return { error: NOT_A_CSV_EXPORT };
  if (escapedBytes(text) > MAX_RESPONSES_FILE_BYTES) return { error: tooLarge };
  return { text };
}

/** The UTF-8 bytes of `text` as a JSON string carries it, without the string's two quotes. */
function escapedBytes(text: string): number {
  return new TextEncoder().encode(JSON.stringify(text)).length - 2;
}
