import type { BrowserContext } from '@playwright/test';

/**
 * The dev server ships vite-plugin-vue-devtools, whose floating panel overlays the app and
 * intercepts clicks aimed at it. It is a developer tool, not the app, so the tests hide it rather
 * than race its button for the place it hovers over. The `page` fixture does this for its context,
 * so a second tab has it too; a context a test opens itself is its own, and calls this, or a click
 * may wait on the panel until the test times out.
 */
export async function hideDevToolsPanel(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const inject = () => {
      const style = document.createElement('style');
      style.textContent = '#__vue-devtools-container__ { display: none !important; }';
      document.head.appendChild(style);
    };
    if (document.head) inject();
    else document.addEventListener('DOMContentLoaded', inject, { once: true });
  });
}
