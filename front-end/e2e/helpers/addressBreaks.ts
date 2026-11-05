import { expect, type Locator } from '@playwright/test';

/**
 * The line breaks an address draws, shared by the specs that hold an address to break only before
 * its "@" or a dot (T181): each one's words, drawn as a phone draws them, read back from the DOM.
 */

/**
 * Where the lines inside each `address` in an element's text break, as "before|after": every
 * character the element draws, with the top of the line it is drawn on. With `narrow`, the element
 * is first drawn narrower than the address and wider than the part before its "@", as a phone's
 * layout would draw it, so the address has to break and has room to break before its "@".
 */
function breaksIn(locator: Locator, address: string, narrow: boolean): Promise<string[]> {
  return locator.evaluate(
    (element, [address, narrow]) => {
      type Drawn = { char: string; top: number; left: number; right: number };
      const draw = (): Drawn[] => {
        const drawn: Drawn[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (let i = 0; i < text.length; i += 1) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getClientRects()[0];
            if (rect) drawn.push({ char: text[i], ...rect.toJSON() });
          }
        }
        return drawn;
      };
      const textOf = (drawn: Drawn[]) => drawn.map((d) => d.char).join('');
      if (narrow) {
        element.style.display = 'inline-block';
        element.style.whiteSpace = 'nowrap';
        const drawn = draw();
        const at = textOf(drawn).indexOf(address);
        const local = drawn[at + address.indexOf('@') - 1].right - drawn[at].left;
        const whole = drawn[at + address.length - 1].right - drawn[at].left;
        element.style.whiteSpace = '';
        element.style.width = `${(local + whole) / 2}px`;
      }
      const drawn = draw();
      const text = textOf(drawn);
      const breaks: string[] = [];
      for (let at = text.indexOf(address); at !== -1; at = text.indexOf(address, at + 1)) {
        for (let i = at; i < at + address.length - 1; i += 1) {
          if (drawn[i + 1].top > drawn[i].top + 1)
            breaks.push(`${text.slice(at, i + 1)}|${text.slice(i + 1, at + address.length)}`);
        }
      }
      return breaks;
    },
    [address, narrow] as const,
  );
}

/**
 * The address in `locator` breaks, if at all, only before its "@" or before a dot, and its
 * accessible name keeps it one word. `narrow` draws the words in a line narrower than the address, where
 * it must break.
 */
export async function expectWholeAddress(locator: Locator, address: string, narrow = false) {
  await expect(locator).toContainText(address);
  expect(await locator.ariaSnapshot()).toContain(address);
  const breaks = await breaksIn(locator, address, narrow);
  if (narrow) expect(breaks.length).toBeGreaterThan(0);
  for (const at of breaks) expect(at).toMatch(/\|[@.]/);
}
