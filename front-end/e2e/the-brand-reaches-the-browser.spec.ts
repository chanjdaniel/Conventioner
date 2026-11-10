import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The Conventioner mark reaches the browser (T212): the tab's icons, the phone's home screen icons
 * and the app bar's logo all answer as the files they are.
 *
 * A file missing from `public/` falls through to `index.html`, which answers 200 with `text/html`,
 * so a status alone would pass it: each icon must also carry an image content type, and the manifest
 * must parse. The app bar renders on `/login`, so none of this needs a sign-in.
 */

/** The head's links of each kind, as a browser would resolve them. */
function linkedHrefs(page: Page, rels: string[]): Promise<string[]> {
  return page.evaluate(
    (wanted) =>
      [...document.head.querySelectorAll('link')]
        .filter((link) => wanted.includes(link.rel))
        .map((link) => link.getAttribute('href') ?? ''),
    rels,
  );
}

async function expectAnImage(page: Page, href: string) {
  const response = await page.request.get(href);
  expect(response.status(), `${href} answers`).toBe(200);
  expect(response.headers()['content-type'], `${href} is an image`).toMatch(/^image\//);
}

test('every icon, the manifest and the logo in the app bar reach a browser with no sign-in', async ({
  page,
}) => {
  await page.goto('/login');

  const icons = await linkedHrefs(page, ['icon', 'apple-touch-icon']);
  expect(icons).toEqual(['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']);
  for (const href of icons) await expectAnImage(page, href);

  const [manifestHref] = await linkedHrefs(page, ['manifest']);
  expect(manifestHref).toBe('/manifest.webmanifest');
  const manifestResponse = await page.request.get(manifestHref);
  expect(manifestResponse.status(), `${manifestHref} answers`).toBe(200);
  const manifest: { icons: { src: string }[] } = JSON.parse(await manifestResponse.text());
  expect(manifest.icons).toHaveLength(3);
  for (const { src } of manifest.icons) await expectAnImage(page, src);

  const logo = page.getByTestId('app-bar-logo');
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});
