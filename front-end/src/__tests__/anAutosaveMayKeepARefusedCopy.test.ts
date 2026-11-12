/**
 * The autosave told to keep the working copy on a refusal (T257): a location's layout is not put
 * back as it was last saved when the server refuses a save, since "This layout changed elsewhere"
 * is answered by Reload, when the person chooses. The default, the plan's, takes the copy back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from '@/utils/useAutosave';

/** A request the server answered with `status`, as axios rejects it. */
function answered(status: number, error?: string) {
  return { isAxiosError: true, response: { status, data: error ? { error } : {} } };
}

function setUp(keepOnRefusal: boolean | undefined) {
  const answers: (unknown | null)[] = [];
  const send = vi.fn(() => {
    const next = answers.shift() ?? null;
    return next === null ? Promise.resolve() : Promise.reject(next);
  });
  const afterRefusal = vi.fn();
  const autosave = useAutosave({
    send,
    sendOnUnload: () => false,
    afterSave: () => {},
    afterRefusal,
    may: () => true,
    failure: 'The layout was not saved.',
    keepOnRefusal,
  });
  return { autosave, send, afterRefusal, answers };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const STALE = 'This layout changed elsewhere. Reload to see the latest.';

describe('an autosave that keeps a refused copy', () => {
  it("keeps the edits unsaved and says the refusal's own sentence, with nothing after it", async () => {
    const { autosave, afterRefusal, answers } = setUp(true);
    answers.push(answered(409, STALE));
    autosave.edited();
    await vi.advanceTimersByTimeAsync(600);
    expect(autosave.status.value).toBe('refused');
    expect(autosave.message.value).toBe(STALE);
    expect(autosave.unsaved.value).toBe(true);
    expect(afterRefusal).toHaveBeenCalledWith(STALE);
  });

  it('sends the copy again with the next edit, and with Retry', async () => {
    const { autosave, send, answers } = setUp(true);
    answers.push(answered(400, "Each section's tables are numbered 1 to N."), answered(400, 'No.'));
    autosave.edited();
    await vi.advanceTimersByTimeAsync(600);
    autosave.edited();
    // The line about the refused copy is not true of the new edit.
    expect(autosave.status.value).toBe('idle');
    await vi.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledTimes(2);
    expect(autosave.status.value).toBe('refused');

    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(3);
    expect(autosave.status.value).toBe('saved');
    expect(autosave.unsaved.value).toBe(false);
  });

  it('answers a flush with the sentence that stopped it', async () => {
    const { autosave, answers } = setUp(true);
    answers.push(answered(409, STALE));
    autosave.edited();
    expect(await autosave.flush()).toBe(STALE);
    expect(autosave.unsaved.value).toBe(true);
  });

  it("forgets what was unsaved once the screen takes the server's copy", async () => {
    const { autosave, send, answers } = setUp(true);
    answers.push(answered(409, STALE));
    autosave.edited();
    await vi.advanceTimersByTimeAsync(600);
    autosave.forget();
    expect(autosave.unsaved.value).toBe(false);
    expect(autosave.status.value).toBe('idle');
    expect(autosave.message.value).toBe('');
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('forgets an edit still in its pause, and a failed one with its line', async () => {
    const { autosave, send, answers } = setUp(true);
    autosave.edited();
    autosave.forget();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();

    answers.push({ isAxiosError: true, response: undefined });
    autosave.edited();
    await vi.advanceTimersByTimeAsync(600);
    expect(autosave.status.value).toBe('failed');
    autosave.forget();
    expect(autosave.status.value).toBe('idle');
    expect(autosave.unsaved.value).toBe(false);
  });
});

describe('an autosave not told to keep a refused copy', () => {
  it('takes the copy back as before: the edits dropped, the plan said to be as last saved', async () => {
    const { autosave, answers } = setUp(undefined);
    answers.push(answered(409, 'The setup has settled.'));
    autosave.edited();
    await vi.advanceTimersByTimeAsync(600);
    expect(autosave.status.value).toBe('refused');
    expect(autosave.message.value).toBe(
      'The setup has settled. The plan is back as it was last saved.',
    );
    expect(autosave.unsaved.value).toBe(false);
  });
});
