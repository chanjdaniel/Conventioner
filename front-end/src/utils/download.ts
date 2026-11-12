/**
 * A file saved by the browser: one the server builds (the assignment's CSV and the vendors'
 * export), or one the browser made (a layout's PNG).
 *
 * The request asks for a blob, so an error comes back as one too, and is read out of it here.
 */
import axios from 'axios';
import { answerMessage } from '@/utils/api';

/** The filename a `Content-Disposition` header names, or the fallback when it names none. */
export function filenameFrom(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/**
 * What a failed download says: as any failed request does (`getApiErrorMessage`), with the
 * refusal's sentence read out of the blob the request asked for.
 */
export async function downloadErrorMessage(err: unknown, fallback: string): Promise<string> {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return fallback;
  const response = err.response;
  if (!response) return answerMessage(undefined, fallback);
  let data: unknown = response.data;
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      data = undefined; // Not JSON: no sentence of the server's.
    }
  }
  return answerMessage({ status: response.status, data }, fallback);
}

/** Save a CSV the server answered, under the name it gave. */
export function saveCsv(
  response: { data: BlobPart; headers: unknown },
  fallbackName: string,
): void {
  const filename = filenameFrom(
    (response.headers as Record<string, string | undefined>)['content-disposition'],
    fallbackName,
  );
  saveFile(new Blob([response.data], { type: 'text/csv;charset=utf-8' }), filename);
}

/** Save a file the browser made, such as a layout's PNG, under a name. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
