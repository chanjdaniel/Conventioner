import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * Screens say what they mean, rather than what they store (E15/F02).
 *
 * Three things a walk found, each small and each on a screen an organizer uses in earnest:
 *
 *   - the form-lock banner read `Current phase: market_days.` - the stored enum, on a screen whose
 *     phase rail names the same state `Market Days` two inches above it;
 *   - Tables and Attendance never named the market they were showing, so an organizer running two
 *     markets in a week could open the screen where a hand placement moves a real vendor to a real
 *     seat and have nothing on it say whose tables these were;
 *   - `Look up` stayed the only green button after it had been used.
 *
 * The raw-value sweep is the one worth keeping longest: it is generic, so the next enum to reach a
 * surface fails here rather than being noticed on a screenshot months later.
 */

/** Anything that looks like it was written for a database rather than a person. */
const STORED_SPELLING = /\b[a-z]+_[a-z_]+\b/;

test.describe('Screens say what they mean', () => {
  let marketId: string;
  let marketSlug: string;
  let marketName: string;
  let market: unknown;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
    marketSlug = seeded.marketSlug;
    marketName = seeded.marketName;

    const response = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    market = ((await response.json()) as { market: unknown }).market;
  });

  async function openTheSeededMarket(page: Page): Promise<void> {
    await page.goto('/login');
    await page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m));
        localStorage.setItem('user', JSON.stringify(user));
      },
      { m: market, user: TEST_USER.email },
    );
  }

  test('the form-lock banner names the phase in words', async ({ authenticatedPage: page }) => {
    await openTheSeededMarket(page);
    await page.goto('/market-setup?tab=form');

    const banner = page.getByTestId('form-builder-lock-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });

    // The seeded market is published, so the form is locked by phase - which is the branch that
    // printed the stored value.
    await expect(banner).toContainText('Market Days');
    await expect(banner).not.toContainText('market_days');
  });

  test('no market screen prints a value meant for the database', async ({
    authenticatedPage: page,
  }) => {
    await openTheSeededMarket(page);

    for (const [screen, url, ready] of [
      ['form builder', '/market-setup?tab=form', 'form-builder-lock-banner'],
      ['tables', `/markets/${marketId}/tables`, 'tables-count-assigned'],
      ['attendance', `/markets/${marketId}/attendance`, 'attendance-status-heading'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15000 });

      const stored = await page.evaluate((pattern) => {
        // Visible text only. `<style>` and `<script>` are leaf nodes full of identifiers, and a
        // sweep that reads them finds a thousand matches and proves nothing.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const found: string[] = [];
        const probe = new RegExp(pattern);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          // A URL carries its own spellings and is not prose - the check-in link is one.
          if (!text || /https?:\/\//.test(text)) continue;
          if (probe.test(text)) found.push(text.slice(0, 80));
        }
        return found.slice(0, 5);
      }, STORED_SPELLING.source);
      expect(stored, `${screen} prints a stored spelling`).toEqual([]);
    }
  });

  test('every market screen names its market', async ({ authenticatedPage: page }) => {
    await openTheSeededMarket(page);

    for (const [url, heading] of [
      [`/markets/${marketId}/tables`, 'tables-heading'],
      [`/markets/${marketId}/attendance`, 'attendance-status-heading'],
      ['/vendors', 'vendors-heading'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByTestId(heading)).toContainText(marketName, { timeout: 15000 });
    }
  });

  test('Look up stops being the primary action once it has been used', async ({ page }) => {
    await page.goto(`/${marketSlug}/check-in`);
    const lookup = page.getByTestId('attendance-checkin-lookup-button');
    await expect(lookup).toHaveClass(/primary-button/, { timeout: 10000 });

    await page.getByTestId('attendance-checkin-email-input').fill('alice@example.com');
    await lookup.click();
    await expect(page.getByTestId('attendance-checkin-vendor')).toBeVisible({ timeout: 10000 });

    // Spent, so it stops wearing the only green on a page held at a door.
    await expect(lookup).toHaveClass(/secondary-button/);
    await expect(lookup).not.toHaveClass(/primary-button/);
  });
});
