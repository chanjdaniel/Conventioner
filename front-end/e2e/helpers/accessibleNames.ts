import type { Page } from '@playwright/test';

/**
 * The form controls on screen that nothing names (E26/F10/S03).
 *
 * A control's name is what a screen reader says for it: its `aria-labelledby` text, its
 * `aria-label`, its `<label>`, or its `title`. A placeholder is not counted - it goes the moment
 * someone types, which is how the plan's name fields and the sign-in code came to be announced as
 * nothing at all (bug 44). Controls under an `inert` subtree, and ones not drawn, are not on screen.
 */
export async function namelessControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const drawn = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    const nameOf = (el: HTMLElement): string => {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const labels = (el as HTMLInputElement).labels;
      if (labels?.length) {
        const text = Array.from(labels)
          .map((label) => label.textContent ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }
      return el.getAttribute('title')?.trim() ?? '';
    };
    return Array.from(
      document.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'),
    )
      .filter((el) => drawn(el) && !el.closest('[inert]'))
      .filter((el) => !nameOf(el))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}[type=${el.getAttribute('type') ?? ''}]` +
          `[data-testid=${el.getAttribute('data-testid') ?? '?'}]`,
      );
  });
}
