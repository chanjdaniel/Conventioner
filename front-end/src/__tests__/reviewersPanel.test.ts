/**
 * The Reviewers panel reads in one line, and the whole list opens in a dialog (T204).
 *
 * The panel listed every chosen reviewer above the applications. It says them in a sentence now,
 * "12 reviewers: a, b, c and 9 more", and a reviewer who can no longer review here is never folded
 * out of sight: they are named first, and the line says how many more of them are folded. "and 9
 * more" opens the Change dialog for someone who may choose the reviewers, and for anyone else a
 * read-only list of them all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import ReviewersPanel from '@/components/market/ReviewersPanel.vue';
import { useMarketStore } from '@/stores/market';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { NONE_CHOSEN } from '@/utils/reviewTeam';
import { answersRefusing } from './support/servedAnswers';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const signedIn = vi.hoisted(() => ({ email: 'reader@example.com' as string | null }));

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return { ...actual, api };
});
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => signedIn.email }));

const address = (n: number) => `person-${String(n).padStart(2, '0')}@example.com`;

/** A team of `count`, in the order they are dealt to; `unable` are those who can no longer review. */
function team(count: number, unable: readonly number[] = []) {
  return Array.from({ length: count }, (_, i) => ({
    email: address(i + 1),
    able: !unable.includes(i + 1),
  }));
}

function market(reviewers: ReturnType<typeof team>, chooses: boolean): Market {
  return {
    id: 'market-1',
    phase: MarketPhase.Applications,
    reviewTeam: { reviewers },
    reviewerCandidates: reviewers.map((reviewer) => reviewer.email),
    actionRefusals: chooses ? answersRefusing() : answersRefusing(MarketAction.ChooseReviewers),
  } as Market;
}

let wrapper: VueWrapper | null = null;

function mountPanel(reviewers: ReturnType<typeof team>, chooses = false): VueWrapper {
  wrapper = mount(ReviewersPanel, {
    props: { market: market(reviewers, chooses) },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  });
  return wrapper;
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allById = (id: string) => [
  ...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
/** What a reader hears: the element's text, its white space collapsed. */
const words = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim();
const line = () => words(byId('reviewers-line'));
const more = () => byId('reviewers-line-more');

async function pressMore() {
  more()!.focus();
  more()!.click();
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  useMarketStore().marketId = 'market-1';
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { market: {} } });
  api.put.mockReset();
  api.put.mockResolvedValue({ data: { dealt: 0 } });
  signedIn.email = 'reader@example.com';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('the line', () => {
  it('with no reviewers, says what that means, with no line', () => {
    mountPanel([]);
    expect(words(byId('reviewers-none'))).toBe(NONE_CHOSEN);
    expect(byId('reviewers-line')).toBeNull();
  });

  it('with three, names them all and draws no button', () => {
    mountPanel(team(3));
    expect(line()).toBe(`3 reviewers: ${address(1)}, ${address(2)} and ${address(3)}`);
    expect(more()).toBeNull();
  });

  it('with twelve, names three and folds nine, in the one sentence', () => {
    mountPanel(team(12));
    expect(line()).toBe(
      `12 reviewers: ${address(1)}, ${address(2)}, ${address(3)} and 9 more reviewers`,
    );
    expect(byId('reviewers-line')?.tagName).toBe('P');
    expect(document.querySelectorAll('[data-testid="reviewers"] li')).toHaveLength(0);
  });

  it("follows the reader's own address with (you), in any capitals", () => {
    signedIn.email = address(2).toUpperCase();
    mountPanel(team(12));
    expect(line()).toBe(
      `12 reviewers: ${address(1)}, ${address(2)} (you), ${address(3)} and 9 more reviewers`,
    );
  });

  it('draws each address as one that breaks only before its "@" or a dot', () => {
    mountPanel(team(3));
    expect(byId('reviewers-line')?.querySelectorAll('.email-address')).toHaveLength(6);
  });
});

describe('a reviewer who can no longer review here', () => {
  it('is named first, with the chip, the rest in the order they are dealt to', () => {
    mountPanel(team(12, [7]));
    expect(line()).toBe(
      `12 reviewers: ${address(7)} Can no longer review here, ${address(1)}, ${address(2)} and 9 more reviewers`,
    );
    expect(allById('reviewers-unable')).toHaveLength(1);
    expect(byId('reviewers-unable-more')).toBeNull();
  });

  it('is named first among three too, where nothing is folded', () => {
    mountPanel(team(3, [3]));
    expect(line()).toBe(
      `3 reviewers: ${address(3)} Can no longer review here, ${address(1)} and ${address(2)}`,
    );
    expect(more()).toBeNull();
  });

  it('when folded, the line ends with how many more', () => {
    mountPanel(team(12, [2, 4, 6, 8, 10]));
    expect(allById('reviewers-unable')).toHaveLength(3);
    expect(words(byId('reviewers-unable-more'))).toBe('2 more can no longer review here');
    expect(line()).toBe(
      `12 reviewers: ${address(2)} Can no longer review here, ${address(4)} Can no longer review here, ${address(6)} Can no longer review here and 9 more reviewers, 2 more can no longer review here`,
    );
  });

  it('says one folded as one', () => {
    mountPanel(team(12, [2, 4, 6, 8]));
    expect(words(byId('reviewers-unable-more'))).toBe('1 more can no longer review here');
  });

  it('says nothing of more when exactly three are named', () => {
    mountPanel(team(12, [2, 4, 6]));
    expect(allById('reviewers-unable')).toHaveLength(3);
    expect(byId('reviewers-unable-more')).toBeNull();
  });
});

describe('"and N more", for someone who may choose the reviewers', () => {
  it('opens the Change dialog, with every reviewer as a chip', async () => {
    mountPanel(team(12), true);
    await pressMore();
    expect(byId('reviewers-dialog-window')?.getAttribute('aria-label')).toBe('Change reviewers');
    expect(allById('reviewer-picker-chip')).toHaveLength(12);
    expect(byId('reviewers-all-window')).toBeNull();
  });

  it('says on its chip which reviewers can no longer review here, folded ones too', async () => {
    mountPanel(team(12, [2, 4, 6, 8, 10]), true);
    expect(line()).toContain('2 more can no longer review here');
    await pressMore();
    const marked = allById('reviewer-picker-chip')
      .map((chip) => words(chip))
      .filter((chip) => chip?.includes('can no longer review here'))
      .map((chip) => chip?.split(' ')[0]);
    expect(marked).toEqual([address(2), address(4), address(6), address(8), address(10)]);
  });

  it('gives focus back to itself when the dialog closes', async () => {
    mountPanel(team(12), true);
    await pressMore();
    byId('reviewers-dialog-close-button')!.click();
    await flushPromises();
    expect(document.activeElement).toBe(more());
  });

  it('when a save leaves three or fewer, focus goes to Change reviewers, as it is gone', async () => {
    const panel = mountPanel(team(4), true);
    await pressMore();
    api.get.mockImplementation(async () => {
      await panel.setProps({ market: market(team(3), true) });
      return { data: { market: {} } };
    });
    byId('reviewers-dialog-window')!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    await nextTick();
    expect(more()).toBeNull();
    expect(document.activeElement).toBe(byId('reviewers-change'));
  });
});

describe('saving', () => {
  const submit = () =>
    byId('reviewers-dialog-window')!
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const pressEscape = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  /** Every way a person closes the dialog, none of which may take it from under a save. */
  async function tryEveryClose() {
    pressEscape();
    byId('reviewers-dialog-close-button')!.click();
    byId('reviewers-dialog-cancel-button')!.click();
    byId('reviewers-dialog-background')!.click();
    await flushPromises();
  }

  it('holds the dialog through the write, by every close', async () => {
    mountPanel(team(12), true);
    await pressMore();
    let answer!: () => void;
    api.put.mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve({ data: { dealt: 0 } }))),
    );
    submit();
    await flushPromises();
    await tryEveryClose();
    expect(byId('reviewers-dialog-window')).not.toBeNull();

    answer();
    await flushPromises();
    expect(byId('reviewers-dialog-window')).toBeNull();
  });

  it('holds the dialog through the re-read, by every close, and goes when it lands', async () => {
    const panel = mountPanel(team(12), true);
    const saved = () => panel.emitted('saved');
    await pressMore();
    let answer!: () => void;
    api.get.mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve({ data: { market: {} } }))),
    );
    submit();
    await flushPromises();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);

    await tryEveryClose();
    expect(byId('reviewers-dialog-window')).not.toBeNull();
    expect(byId('reviewers-dialog-submit-button')?.hasAttribute('disabled')).toBe(true);
    expect(words(byId('reviewers-dialog-submit-button'))).toBe('Saving…');
    expect(saved()).toBeUndefined();

    answer();
    await flushPromises();
    expect(byId('reviewers-dialog-window')).toBeNull();
    expect(saved()).toHaveLength(1);
  });

  it('closes when the re-read fails in transit, as the save has landed', async () => {
    const panel = mountPanel(team(12), true);
    await pressMore();
    api.get.mockRejectedValue(new Error('Network Error'));
    submit();
    await flushPromises();
    expect(byId('reviewers-dialog-window')).toBeNull();
    expect(panel.emitted('saved')).toHaveLength(1);
  });

  it('keeps the dialog open with the error when the save is refused, and a close then works', async () => {
    mountPanel(team(12), true);
    await pressMore();
    api.put.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: 'That person cannot be chosen.' } },
    });
    submit();
    await flushPromises();
    expect(api.get).not.toHaveBeenCalled();
    expect(words(byId('reviewers-dialog-error'))).toBe('That person cannot be chosen.');

    byId('reviewers-dialog-close-button')!.click();
    await flushPromises();
    expect(byId('reviewers-dialog-window')).toBeNull();
  });
});

describe('"and N more", for anyone else', () => {
  it('opens a read-only "Reviewers" dialog of every reviewer, unable first, chip and (you)', async () => {
    signedIn.email = address(5);
    mountPanel(team(12, [9]));
    await pressMore();

    const dialog = byId('reviewers-all-window');
    expect(dialog?.getAttribute('aria-label')).toBe('Reviewers');
    expect(byId('reviewers-dialog-window')).toBeNull();
    const rows = allById('reviewers-person').map(words);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toBe(`${address(9)} Can no longer review here`);
    expect(rows[1]).toBe(address(1));
    expect(rows[5]).toBe(`${address(5)} (you)`);
  });

  it('offers nothing to save or to change', async () => {
    mountPanel(team(12));
    await pressMore();
    const dialog = byId('reviewers-all-window')!;
    expect(dialog.querySelector('form')).toBeNull();
    expect(dialog.querySelector('input')).toBeNull();
    expect([...dialog.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Close'],
    );
  });

  it('closes by Close, focus going back to the button', async () => {
    mountPanel(team(12));
    await pressMore();
    byId('reviewers-all-close-button')!.click();
    await flushPromises();
    expect(byId('reviewers-all-window')).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it('closes by Escape, focus going back to the button', async () => {
    mountPanel(team(12));
    await pressMore();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(byId('reviewers-all-window')).toBeNull();
    expect(document.activeElement).toBe(more());
  });
});
