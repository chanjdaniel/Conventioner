import { test } from './fixtures';
import { walkTheScreens, type Check } from './helpers/screens';

/**
 * Nothing axe can see fails WCAG A or AA, on any screen or state the sweeps walk.
 *
 * The check is the `expectAccessible` fixture's, configured once in `fixtures.ts`; this spec only
 * walks it over the states. Playwright's guide is plain that an automated check finds some WCAG
 * failures, not all of them: a pass here is a floor, not a verdict.
 */
const accessibilityTest = test.extend<{ check: Check }>({
  check: async ({ expectAccessible }, use) => {
    await use(expectAccessible);
  },
});

test.describe('Nothing axe can see fails WCAG A or AA', () => {
  walkTheScreens(accessibilityTest, { everySize: false });
});
