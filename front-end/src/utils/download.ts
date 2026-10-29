/**
 * A file the server builds, saved by the browser: the assignment's CSV and the vendors' export.
 *
 * The request asks for a blob, so an error comes back as one too, and is read out of it here.
 */

/** The filename a `Content-Disposition` header names, or the fallback when it names none. */
export function filenameFrom(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/** The error the server gave, whether it came back as JSON or inside the blob asked for. */
export async function downloadErrorMessage(err: unknown, fallback: string): Promise<string> {
  const data =
    err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: unknown } }).response?.data
      : undefined;
  try {
    const parsed = data instanceof Blob ? JSON.parse(await data.text()) : data;
    const message = (parsed as { error?: unknown } | undefined)?.error;
    if (typeof message === 'string' && message) return message;
  } catch {
    // Not JSON: fall through to the plain message.
  }
  return fallback;
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
  const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
