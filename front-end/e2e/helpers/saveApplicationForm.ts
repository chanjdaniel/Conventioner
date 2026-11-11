import type { APIRequestContext } from '@playwright/test';

/** What the form write answers: the form as stored, and its revision now. */
export interface SavedApplicationForm {
  application_form: { fields: Array<Record<string, unknown>>; [key: string]: unknown };
  formRevision: number;
}

/**
 * Write a market's application form as the form tab does: read the form's revision, then save
 * the form from it (ADR 0024).
 *
 * A save carries the revision its copy of the form was read at, and the server refuses one with
 * none or an older one, so a seed never writes the form blind. `form` is the body the tab sends
 * besides the revision: `fields`, and `unaskedEssentials` when it sets them. `headers` are sent
 * with both requests, for a context whose requests need them. Throws with the server's words on a
 * refusal.
 */
export async function saveApplicationForm(
  request: APIRequestContext,
  baseURL: string,
  marketId: string,
  form: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<SavedApplicationForm> {
  const address = `${baseURL}/markets/${encodeURIComponent(marketId)}/application-form`;
  const read = await request.get(address, { headers });
  if (!read.ok()) {
    throw new Error(`Form read failed: ${read.status()} ${await read.text()}`);
  }
  const { formRevision } = (await read.json()) as { formRevision: number };
  const res = await request.put(address, {
    headers: { 'Content-Type': 'application/json', ...headers },
    data: { ...form, formRevision },
  });
  if (!res.ok()) {
    throw new Error(`Form write failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as SavedApplicationForm;
}
