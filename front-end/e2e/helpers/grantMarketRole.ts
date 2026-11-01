import { expect, type APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../fixtures';

/**
 * Gives `user` a role on a market, as its owner does from Manage market, through the session
 * `request` holds (the seed's owner). The user must already exist: `ensureVerifiedUser` makes one.
 */
export async function grantMarketRole(
  request: APIRequestContext,
  marketId: string,
  user: { email: string },
  role: 'viewer' | 'editor',
): Promise<void> {
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: user.email, role },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}
