import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Each element inside the one whose `data-testid` is `testid`, itself included, whose ARIA role its
 * own element may not take, as axe's `aria-allowed-role` finds them: a `dialog` on an `<aside>`,
 * say, which a screen reader may announce as the landmark rather than the dialog. The rule is a
 * best practice rather than WCAG, so the suite-wide check leaves it out, and a spec asks it of the
 * window it opens, and of nothing else on the page.
 */
export async function rolesNotAllowed(page: Page, testid: string): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .include(`[data-testid="${testid}"]`)
    .options({ runOnly: { type: 'rule', values: ['aria-allowed-role'] } })
    .analyze();
  return violations.flatMap((v) => v.nodes.map((node) => node.target.join(' ')));
}
