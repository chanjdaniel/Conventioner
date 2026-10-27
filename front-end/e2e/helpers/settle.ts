import type { Page } from '@playwright/test';

/**
 * Let CSS transitions finish before measuring a screen.
 *
 * A control reports its transitioning paint, not its destination: the Download CSV button renders
 * disabled until statistics arrive, and for 150ms after they do it is an ENABLED button still
 * painted `--mm-border` under white text - 1.71:1, and gone by the time anyone could look. The
 * screens sweep only passed because it happened to navigate twice first.
 *
 * Bounded, and proceeds on timeout: a spinner is a legitimately perpetual animation, and a sweep
 * that hung on one would be worse than one that measured beside it.
 */
export async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, {
      timeout: 2000,
    })
    .catch(() => undefined);
}
