/**
 * The door code on Attendance (ADR 0022): shown full screen, printed as a poster, replaced on
 * demand. Its QR code is decoded here from the path the screen draws, so what is on the screen is
 * what a phone's camera reads: the vendor page with the code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import jsQR from 'jsqr';
import DoorCodeScreen from '@/components/DoorCodeScreen.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { MarketAction } from '@/utils/marketActions';
import { doorCodeInWords, offersDoorCode } from '@/utils/doorCode';
import { QUIET_ZONE, qrDrawing } from '@/utils/qrDrawing';
import { answersRefusing, VIEWER_ANSWERS } from './support/servedAnswers';

const readDoorCode = vi.fn();
const makeDoorCode = vi.fn();

vi.mock('@/utils/doorCode', async (original) => ({
  ...(await original<typeof import('@/utils/doorCode')>()),
  readDoorCode: (id: string) => readDoorCode(id),
  makeDoorCode: (id: string) => makeDoorCode(id),
}));
vi.mock('@/utils/signedIn', () => ({ signedInEmail: () => 'door@example.com' }));

const URL_OF = (code: string) => `https://conventioner.io/harbour-night-market?door=${code}`;
const CODE = (code: string) => ({
  code,
  madeAt: '2026-11-21T15:20:00+00:00',
  madeBy: 'door@example.com',
  url: URL_OF(code),
});

/** The drawn path, back to pixels: each module a square of `scale`, dark where a run covers it. */
function decoded(text: string, scale = 6): string | null {
  const { side, path } = qrDrawing(text);
  const width = side * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const [, x, y, length] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let column = Number(x); column < Number(x) + Number(length); column += 1) {
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const at = ((Number(y) * scale + dy) * width + column * scale + dx) * 4;
          pixels.fill(0, at, at + 3);
        }
      }
    }
  }
  return jsQR(pixels, width, width)?.data ?? null;
}

describe('the code and its QR code', () => {
  it('shows the code in two groups of three', () => {
    expect(doorCodeInWords('K7M4QP')).toBe('K7M 4QP');
  });

  it.each([URL_OF('K7M4QP'), URL_OF('Z2Z2Z2'), `${URL_OF('ABCDEF')}&x=${'y'.repeat(60)}`])(
    'draws a QR code that scans to %s',
    (url) => {
      expect(decoded(url)).toBe(url);
    },
  );

  it('keeps the quiet zone a reader needs round the code', () => {
    const { side, path } = qrDrawing(URL_OF('K7M4QP'));
    const xs = [...path.matchAll(/M(\d+) (\d+)h(\d+)/g)];

    expect(Math.min(...xs.map(([, x]) => Number(x)))).toBe(QUIET_ZONE);
    expect(Math.min(...xs.map(([, , y]) => Number(y)))).toBe(QUIET_ZONE);
    expect(Math.max(...xs.map(([, x, , length]) => Number(x) + Number(length)))).toBe(
      side - QUIET_ZONE,
    );
  });
});

describe('who is offered the door code', () => {
  const market = (phase: MarketPhase, actionRefusals = answersRefusing()) =>
    ({ phase, actionRefusals }) as unknown as Market;

  it('is offered in Market Days to whoever may check vendors in', () => {
    expect(offersDoorCode(market(MarketPhase.MarketDays))).toBe(true);
  });

  it.each([MarketPhase.Assignment, MarketPhase.Archived, MarketPhase.Applications])(
    'is not offered in %s',
    (phase) => {
      expect(offersDoorCode(market(phase))).toBe(false);
    },
  );

  it('is not offered to a Viewer, or to anyone the row refuses', () => {
    expect(offersDoorCode(market(MarketPhase.MarketDays, VIEWER_ANSWERS))).toBe(false);
    expect(
      offersDoorCode(market(MarketPhase.MarketDays, answersRefusing(MarketAction.CheckIn))),
    ).toBe(false);
    expect(offersDoorCode(null)).toBe(false);
  });
});

describe('the full-screen door code', () => {
  let wrapper: VueWrapper | null = null;
  const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    document.body.innerHTML = '';
    readDoorCode.mockReset();
    makeDoorCode.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function opened() {
    const opener = document.createElement('button');
    opener.dataset.testid = 'opener';
    document.body.append(opener);
    opener.focus();
    wrapper = mount(DoorCodeScreen, {
      props: { marketId: 'm1', marketName: 'Harbour Night Market' },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  }

  it("shows the market's name, the QR code, the typed code and the line to read", async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));

    await opened();

    expect(readDoorCode).toHaveBeenCalledWith('m1');
    expect(byTestId('door-code-market')?.textContent).toBe('Harbour Night Market');
    expect(byTestId('door-code-value')?.textContent?.trim()).toBe('K7M 4QP');
    expect(byTestId('door-code')?.textContent).toContain(
      "Scan with your phone's camera to check in",
    );
    const qr = byTestId('door-code-qr')!;
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.dataset.url).toBe(URL_OF('K7M4QP'));
    expect(qr.querySelector('path')?.getAttribute('d')).toBe(qrDrawing(URL_OF('K7M4QP')).path);
    expect(byTestId('door-code-made')?.textContent).toContain('by you');
  });

  it('opens on Close, and closing gives focus back to what opened it', async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));
    const screen = await opened();

    expect(document.activeElement).toBe(byTestId('door-code-close'));
    byTestId('door-code-close')!.click();
    expect(screen.emitted('close')).toHaveLength(1);

    // Attendance unmounts it on close.
    screen.unmount();
    wrapper = null;
    await flushPromises();
    expect(document.activeElement).toBe(byTestId('opener'));
  });

  it('closes on Escape', async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));
    const screen = await opened();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(screen.emitted('close')).toHaveLength(1);
  });

  it('offers "Make a door code" with no code yet, and then shows the one made', async () => {
    readDoorCode.mockResolvedValue({ code: null });
    makeDoorCode.mockResolvedValue(CODE('K7M4QP'));
    await opened();

    expect(byTestId('door-code-qr')).toBeNull();
    expect(byTestId('door-code-print')).toBeNull();
    expect(byTestId('door-code-new')).toBeNull();
    byTestId('door-code-make')!.click();
    await flushPromises();

    expect(makeDoorCode).toHaveBeenCalledWith('m1');
    expect(byTestId('door-code-value')?.textContent?.trim()).toBe('K7M 4QP');
    expect(document.activeElement).toBe(byTestId('door-code-print'));
  });

  it('says so when no code could be made', async () => {
    readDoorCode.mockResolvedValue({ code: null });
    makeDoorCode.mockRejectedValue(new Error('down'));
    await opened();

    byTestId('door-code-make')!.click();
    await flushPromises();

    expect(byTestId('door-code')?.textContent).toContain('No new door code was made.');
    expect(byTestId('door-code-make')).not.toBeNull();
  });

  it('asks before a new code, on Cancel, and changes nothing when cancelled', async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));
    await opened();

    byTestId('door-code-new')!.click();
    await flushPromises();

    const window = byTestId('door-code-new-confirm-window')!;
    expect(window.textContent).toContain('Make a new door code?');
    expect(window.textContent).toContain(
      'The current code and every printed poster of it stop working.',
    );
    expect(document.activeElement).toBe(byTestId('door-code-new-confirm-cancel-button'));
    byTestId('door-code-new-confirm-cancel-button')!.click();
    await flushPromises();

    expect(makeDoorCode).not.toHaveBeenCalled();
    expect(byTestId('door-code-value')?.textContent?.trim()).toBe('K7M 4QP');
  });

  it('shows the new code and its QR code once confirmed', async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));
    makeDoorCode.mockResolvedValue(CODE('Z9X8W7'));
    await opened();

    byTestId('door-code-new')!.click();
    await flushPromises();
    byTestId('door-code-new-confirm-submit-button')!.click();
    await flushPromises();

    expect(makeDoorCode).toHaveBeenCalledWith('m1');
    expect(byTestId('door-code-value')?.textContent?.trim()).toBe('Z9X 8W7');
    expect(byTestId('door-code-qr')?.dataset.url).toBe(URL_OF('Z9X8W7'));
  });

  it('keeps the confirmation open with the reason when the new code fails', async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));
    makeDoorCode.mockRejectedValue(new Error('down'));
    await opened();

    byTestId('door-code-new')!.click();
    await flushPromises();
    byTestId('door-code-new-confirm-submit-button')!.click();
    await flushPromises();

    expect(byTestId('door-code-new-confirm-window')?.textContent).toContain(
      'No new door code was made.',
    );
    expect(byTestId('door-code-value')?.textContent?.trim()).toBe('K7M 4QP');
  });

  it('prints the poster', async () => {
    readDoorCode.mockResolvedValue(CODE('K7M4QP'));
    const print = vi.fn();
    vi.stubGlobal('print', print);
    await opened();

    byTestId('door-code-print')!.click();

    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('says when the code could not be read, with a Try again', async () => {
    readDoorCode.mockRejectedValueOnce(new Error('down')).mockResolvedValue(CODE('K7M4QP'));
    await opened();

    expect(byTestId('door-code-read-failed')).not.toBeNull();
    byTestId('door-code-retry')!.click();
    await flushPromises();

    expect(byTestId('door-code-value')?.textContent?.trim()).toBe('K7M 4QP');
  });
});
