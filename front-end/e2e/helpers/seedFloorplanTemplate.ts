import type { APIRequestContext } from '@playwright/test';
import { uniqueMarketName } from './uniqueName';

/** A table type as a floorplan template stores it. */
export interface TemplateTableType {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  maxCapacity: number;
  color: string;
}

/**
 * A floorplan template saved by the signed-in user, so Load Template has one to list.
 *
 * A seeded template belongs to the user, not a market, and the suite shares one user: the list
 * grows with every run, so a spec finds its own by the unique name returned here, never by
 * position.
 * The request context must already be signed in (`seedDraftMarket` does that).
 */
export async function seedFloorplanTemplate(
  request: APIRequestContext,
  baseURL: string,
  tableTypes: TemplateTableType[],
): Promise<string> {
  const name = uniqueMarketName('E2E Template');
  const res = await request.post(`${baseURL}/floorplans/templates`, {
    headers: { 'Content-Type': 'application/json' },
    data: { name, tableTypes },
  });
  if (!res.ok()) {
    throw new Error(`Template creation failed: ${res.status()} ${await res.text()}`);
  }
  return name;
}
