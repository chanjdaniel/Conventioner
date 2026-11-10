/**
 * The autosave sends one save at a time, and the newest working copy when the save out answers
 * (T271).
 *
 * The plan used to send a save 600 ms after each edit whether or not one was still out, so a slow
 * first save reaching the server last stored the older plan over the newer one, beside "Plan
 * saved".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import { isRefusal, useAutosave } from '@/utils/useAutosave';

/** A write whose answers the test gives one at a time, recording what each one carried. */
function heldWrites(copy: () => unknown) {
  const sent: unknown[] = [];
  const answers: { resolve: () => void; reject: (err: unknown) => void }[] = [];
  let out = 0;
  let mostAtOnce = 0;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        sent.push(JSON.parse(JSON.stringify(copy())));
        out += 1;
        mostAtOnce = Math.max(mostAtOnce, out);
        answers.push({
          resolve: () => {
            out -= 1;
            resolve();
          },
          reject: (err) => {
            out -= 1;
            reject(err);
          },
        });
      }),
  );
  return {
    send,
    sent,
    mostAtOnce: () => mostAtOnce,
    /** Answer the oldest save still out. */
    async answer() {
      answers.shift()!.resolve();
      await vi.advanceTimersByTimeAsync(0);
    },
    async fail(err: unknown) {
      answers.shift()!.reject(err);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

/** A request the server answered with `status`, as axios rejects it. */
function answered(status: number, error?: string) {
  return { isAxiosError: true, response: { status, data: error ? { error } : {} } };
}

/** A request that never reached the server. */
const noAnswer = { isAxiosError: true, response: undefined };

function setUp(options: { may?: () => boolean } = {}) {
  const copy = { dates: [] as string[] };
  const writes = heldWrites(() => copy);
  const afterSave = vi.fn();
  const afterRefusal = vi.fn();
  const autosave = useAutosave({
    send: writes.send,
    sendOnUnload: () => false,
    afterSave,
    afterRefusal,
    may: options.may ?? (() => true),
    failure: 'The plan was not saved.',
  });
  function edit(date: string) {
    copy.dates.push(date);
    autosave.edited();
  }
  return { copy, writes, afterSave, afterRefusal, autosave, edit };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the autosave queue', () => {
  it('waits the pause after an edit, then sends once', async () => {
    const { writes, edit } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(599);
    expect(writes.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('sends an edit made while a save is out after it answers, never two at once, with the newest copy', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    edit('2026-08-03');
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).toHaveBeenCalledTimes(1);

    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(2);
    expect(writes.mostAtOnce()).toBe(1);
    expect(writes.sent[1]).toEqual({ dates: ['2026-08-01', '2026-08-02', '2026-08-03'] });
    expect(autosave.unsaved.value).toBe(true);

    await writes.answer();
    expect(autosave.unsaved.value).toBe(false);
    expect(writes.send).toHaveBeenCalledTimes(2);
  });

  it('sends the copy as it stands at the answer, not as it stood when the pause ended', async () => {
    const { writes, edit } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);
    // The pause has ended while the first save is out; another edit lands before it answers.
    edit('2026-08-03');
    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(2);
    expect(writes.sent[1]).toEqual({ dates: ['2026-08-01', '2026-08-02', '2026-08-03'] });
    // That save carried the last edit, so its pause sends nothing more.
    await writes.answer();
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).toHaveBeenCalledTimes(2);
  });

  it('lets a pause still running at the answer send its edit when it ends', async () => {
    const { writes, edit } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(300);
    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299);
    expect(writes.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes.send).toHaveBeenCalledTimes(2);
    expect(writes.sent[1]).toEqual({ dates: ['2026-08-01', '2026-08-02'] });
  });

  it('lets a pause that ends while a save is out send at the answer', async () => {
    const { writes, edit } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);
    expect(writes.send).toHaveBeenCalledTimes(1);

    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(2);
  });

  it('says saved only once the server holds the last edit', async () => {
    const { writes, edit, autosave, afterSave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    expect(autosave.status.value).toBe('saving');
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);

    await writes.answer();
    // The first save carried only the first edit.
    expect(autosave.status.value).toBe('saving');
    expect(afterSave).toHaveBeenCalledTimes(1);

    await writes.answer();
    expect(autosave.status.value).toBe('saved');
    expect(afterSave).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(autosave.status.value).toBe('idle');
  });

  it('stops saying saved at the next edit', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.answer();
    expect(autosave.status.value).toBe('saved');

    edit('2026-08-02');

    expect(autosave.status.value).toBe('idle');
  });

  it('keeps a failed save unsaved and says so, and the next edit sends the whole copy again', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(new Error('offline'));

    expect(autosave.status.value).toBe('failed');
    expect(autosave.message.value).toBe('The plan was not saved.');
    expect(autosave.unsaved.value).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes.send).toHaveBeenCalledTimes(1);

    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);
    expect(writes.sent[1]).toEqual({ dates: ['2026-08-01', '2026-08-02'] });
  });

  it('sends nothing for a person who may not write, and holds nothing unsaved for them', async () => {
    const { writes, edit, autosave } = setUp({ may: () => false });

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(5000);

    expect(writes.send).not.toHaveBeenCalled();
    expect(autosave.unsaved.value).toBe(false);
    expect(await autosave.flush()).toBeNull();
    expect(writes.send).not.toHaveBeenCalled();
  });

  it('sends nothing once the person may no longer write, and a flush does not wait on it', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    may = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).not.toHaveBeenCalled();

    expect(await autosave.flush()).toBeNull();
    expect(writes.send).not.toHaveBeenCalled();
  });

  // An edit that can never be sent was left unsaved for good: the screen skipped every later
  // re-read and the browser asked at every reload (T271 review).
  it('drops an edit whose pause ends after the person may no longer write', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(300);
    may = false;
    await vi.advanceTimersByTimeAsync(600);

    expect(writes.send).not.toHaveBeenCalled();
    expect(autosave.unsaved.value).toBe(false);
  });

  it('drops an edit waiting on a save out once the person may no longer write', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);
    may = false;
    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(1);
    expect(autosave.unsaved.value).toBe(false);
  });

  it('drops an edit a flush finds unsendable', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    may = false;

    expect(await autosave.flush()).toBeNull();
    expect(writes.send).not.toHaveBeenCalled();
    expect(autosave.unsaved.value).toBe(false);
  });

  // An edit with no pause and no wanted save behind it (left by a failed save, or held) was never
  // reached by a send, so it stayed unsaved for good, its failed line and Retry beside the plan the
  // screen took back (T271 re-review).
  it('drops an edit a failed save left, and its failed line, when the screen says the person may no longer write', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(noAnswer);
    expect(autosave.status.value).toBe('failed');
    may = false;
    autosave.forgetUnsendable();

    expect(autosave.unsaved.value).toBe(false);
    expect(autosave.status.value).toBe('idle');
    expect(autosave.message.value).toBe('');
    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('drops a held edit when the screen says the person may no longer write', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    autosave.hold(true);
    edit('2026-08-01');
    may = false;
    autosave.forgetUnsendable();
    expect(autosave.unsaved.value).toBe(false);

    autosave.hold(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).not.toHaveBeenCalled();
  });

  it('keeps what the person may still write when the screen asks', async () => {
    const { edit, autosave } = setUp();

    edit('2026-08-01');
    autosave.forgetUnsendable();

    expect(autosave.unsaved.value).toBe(true);
  });

  it('leaves a save out to answer, and drops what it did not carry when it fails', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    may = false;
    autosave.forgetUnsendable();
    expect(autosave.unsaved.value).toBe(true);

    await writes.fail(noAnswer);
    expect(autosave.unsaved.value).toBe(false);
    expect(autosave.status.value).toBe('idle');
  });

  it('drops what a save out did not carry when it lands after the person may no longer write', async () => {
    let may = true;
    const { writes, edit, autosave } = setUp({ may: () => may });

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    autosave.hold(true);
    edit('2026-08-02');
    may = false;
    await writes.answer();

    expect(autosave.unsaved.value).toBe(false);
    autosave.hold(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal and a failure', () => {
  it.each([
    [400, true],
    [403, true],
    [404, true],
    [409, true],
    [401, false],
    [408, false],
    [429, false],
    [500, false],
    [502, false],
  ])('reads a %i as a refusal: %s', (status, refusal) => {
    expect(isRefusal(answered(status))).toBe(refusal);
  });

  it('reads no answer, and anything that is not a request, as a failure', () => {
    expect(isRefusal(noAnswer)).toBe(false);
    expect(isRefusal(new Error('offline'))).toBe(false);
  });

  it.each([400, 403])(
    "drops every edit on a %i, says the server's sentence, and takes the server's copy back",
    async (status) => {
      const { writes, edit, autosave, afterRefusal, afterSave } = setUp();

      edit('2026-08-01');
      await vi.advanceTimersByTimeAsync(600);
      // An edit made while the refused save was out builds on it, so it goes too.
      edit('2026-08-02');
      await vi.advanceTimersByTimeAsync(600);
      await writes.fail(answered(status, 'The setup is settled.'));

      expect(autosave.status.value).toBe('refused');
      expect(autosave.message.value).toBe(
        'The setup is settled. The plan is back as it was last saved.',
      );
      expect(autosave.unsaved.value).toBe(false);
      expect(afterRefusal).toHaveBeenCalledWith('The setup is settled.');
      expect(afterSave).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writes.send).toHaveBeenCalledTimes(1);
    },
  );

  it('ends a refusal sentence the server left without a full stop before the line after it', async () => {
    const { writes, edit, autosave, afterRefusal } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    // The market was deleted in another tab: the server's sentence has no full stop of its own.
    await writes.fail(answered(404, 'Market not found'));

    expect(autosave.message.value).toBe('Market not found. The plan is back as it was last saved.');
    expect(afterRefusal).toHaveBeenCalledWith('Market not found');
  });

  it('words a refusal with no sentence of its own by the failure sentence', async () => {
    const { writes, edit, autosave, afterRefusal } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(answered(400));

    expect(autosave.message.value).toBe(
      'The plan was not saved. The plan is back as it was last saved.',
    );
    expect(afterRefusal).toHaveBeenCalledWith('The plan was not saved.');
  });

  it.each([
    ['a 401', answered(401), 'Your session has ended. Sign in again.'],
    ['a 408', answered(408), 'The plan was not saved.'],
    ['a 429', answered(429), 'The plan was not saved.'],
    ['a 500', answered(500), 'Something went wrong on our side. Try again in a moment.'],
    ['no answer', noAnswer, 'You seem to be offline. Check the connection and try again.'],
  ])('keeps the edits unsaved on %s, and says so', async (_kind, err, sentence) => {
    const { writes, edit, autosave, afterRefusal } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(err);

    expect(autosave.status.value).toBe('failed');
    expect(autosave.message.value).toBe(sentence);
    expect(autosave.unsaved.value).toBe(true);
    expect(afterRefusal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('lets the next edit after a refusal start from the copy the server holds', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(answered(400, 'No.'));
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);

    expect(writes.send).toHaveBeenCalledTimes(2);
    expect(autosave.status.value).toBe('saving');
    await writes.answer();
    expect(autosave.status.value).toBe('saved');
  });
});

describe('Retry', () => {
  it('sends the whole copy again after a failure, and says saved when it lands', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(noAnswer);
    // The edit wanted while the failed save was out went at its answer, and failed too.
    await writes.fail(noAnswer);
    expect(writes.send).toHaveBeenCalledTimes(2);

    autosave.retry();
    expect(writes.send).toHaveBeenCalledTimes(3);
    expect(writes.sent[2]).toEqual({ dates: ['2026-08-01', '2026-08-02'] });
    await writes.answer();

    expect(autosave.status.value).toBe('saved');
    expect(autosave.unsaved.value).toBe(false);
  });

  it('sends nothing when nothing is unsaved', async () => {
    const { writes, autosave } = setUp();

    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(writes.send).not.toHaveBeenCalled();
  });
});

describe('the hold', () => {
  it('keeps the pause from sending, and sends the held edit after the pause once let go', async () => {
    const { writes, edit, autosave } = setUp();

    autosave.hold(true);
    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).not.toHaveBeenCalled();
    expect(autosave.unsaved.value).toBe(true);

    autosave.hold(false);
    await vi.advanceTimersByTimeAsync(599);
    expect(writes.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('stops a pause already running', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(300);
    autosave.hold(true);
    await vi.advanceTimersByTimeAsync(5000);

    expect(writes.send).not.toHaveBeenCalled();
  });

  it('keeps a save wanted while one is out from going when the answer finds the plan held', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    await vi.advanceTimersByTimeAsync(600);
    autosave.hold(true);
    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(1);
    expect(autosave.status.value).toBe('idle');
    autosave.hold(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(writes.send).toHaveBeenCalledTimes(2);
  });

  it('lets a flush send a held edit as kept', async () => {
    const { writes, edit, autosave } = setUp();

    autosave.hold(true);
    edit('2026-08-01');
    const flushed = autosave.flush();
    expect(writes.send).toHaveBeenCalledTimes(1);
    await writes.answer();

    expect(await flushed).toBeNull();
  });
});

describe('the flush', () => {
  it('sends nothing when nothing is unsaved', async () => {
    const { writes, autosave } = setUp();

    expect(await autosave.flush()).toBeNull();
    expect(writes.send).not.toHaveBeenCalled();
  });

  it('sends a waiting edit at once, and waits for its answer', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    let done = false;
    const flushed = autosave.flush().then((answer) => {
      done = true;
      return answer;
    });
    expect(writes.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);

    await writes.answer();

    expect(await flushed).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('waits for the save out, then sends what came after it', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    edit('2026-08-02');
    const flushed = autosave.flush();
    expect(writes.send).toHaveBeenCalledTimes(1);

    await writes.answer();
    expect(writes.send).toHaveBeenCalledTimes(2);
    expect(writes.mostAtOnce()).toBe(1);
    await writes.answer();

    expect(await flushed).toBeNull();
    expect(autosave.unsaved.value).toBe(false);
  });

  it('answers the failure that stopped it', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    const flushed = autosave.flush();
    await writes.fail(new Error('offline'));

    expect(await flushed).toBe('The plan was not saved.');
  });

  it('answers a refusal by its own sentence, without the line about the plan coming back', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    const flushed = autosave.flush();
    await writes.fail(answered(400, 'The setup is settled.'));

    expect(await flushed).toBe('The setup is settled.');
  });

  it('answers the refusal of the save it waited for, rather than null', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    const flushed = autosave.flush();
    await writes.fail(answered(403, 'Archived.'));

    expect(await flushed).toBe('Archived.');
    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('answers the failure of the save it waited for', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    const flushed = autosave.flush();
    await writes.fail(noAnswer);

    expect(await flushed).toBe('You seem to be offline. Check the connection and try again.');
    expect(writes.send).toHaveBeenCalledTimes(1);
  });

  it('sends the copy again after an earlier failure, and answers null once it lands', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(noAnswer);

    const flushed = autosave.flush();
    expect(writes.send).toHaveBeenCalledTimes(2);
    await writes.answer();

    expect(await flushed).toBeNull();
  });

  it('answers null after a refusal has put the copy back, sending nothing', async () => {
    const { writes, edit, autosave } = setUp();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.fail(answered(400, 'No.'));

    expect(await autosave.flush()).toBeNull();
    expect(writes.send).toHaveBeenCalledTimes(1);
  });
});

describe('leaving the view', () => {
  const Host = (options: Parameters<typeof useAutosave>[0], held: { edit?: () => void }) =>
    defineComponent({
      setup() {
        const autosave = useAutosave(options);
        held.edit = autosave.edited;
        return () => h('div');
      },
    });

  it('sends a waiting edit without waiting for the pause', async () => {
    const send = vi.fn(() => Promise.resolve());
    const held: { edit?: () => void } = {};
    const wrapper = mount(
      Host(
        {
          send,
          sendOnUnload: () => false,
          afterSave: () => {},
          afterRefusal: () => {},
          may: () => true,
          failure: 'Not saved.',
        },
        held,
      ),
    );

    held.edit!();
    await vi.advanceTimersByTimeAsync(100);
    wrapper.unmount();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('still sends an edit made while a save was out, once it answers', async () => {
    const copy = { dates: [] as string[] };
    const writes = heldWrites(() => copy);
    const held: { edit?: () => void } = {};
    const wrapper = mount(
      Host(
        {
          send: writes.send,
          sendOnUnload: () => false,
          afterSave: () => {},
          afterRefusal: () => {},
          may: () => true,
          failure: 'Not saved.',
        },
        held,
      ),
    );

    copy.dates.push('2026-08-01');
    held.edit!();
    await vi.advanceTimersByTimeAsync(600);
    copy.dates.push('2026-08-02');
    held.edit!();
    wrapper.unmount();
    expect(writes.send).toHaveBeenCalledTimes(1);

    await writes.answer();

    expect(writes.send).toHaveBeenCalledTimes(2);
    expect(writes.sent[1]).toEqual({ dates: ['2026-08-01', '2026-08-02'] });
  });

  it('sends nothing when nothing is unsaved', () => {
    const send = vi.fn(() => Promise.resolve());
    const wrapper = mount(
      Host(
        {
          send,
          sendOnUnload: () => false,
          afterSave: () => {},
          afterRefusal: () => {},
          may: () => true,
          failure: 'Not saved.',
        },
        {},
      ),
    );

    wrapper.unmount();

    expect(send).not.toHaveBeenCalled();
  });
});

describe('the unload try', () => {
  /** A view on the autosave, with the page's `pagehide` to fire and the keepalive try recorded. */
  function mountHost(options: { held?: boolean } = {}) {
    const copy = { dates: [] as string[] };
    const writes = heldWrites(() => copy);
    const sendOnUnload = vi.fn(() => true);
    const held: { autosave?: ReturnType<typeof useAutosave> } = {};
    const wrapper = mount(
      defineComponent({
        setup() {
          held.autosave = useAutosave({
            send: writes.send,
            sendOnUnload,
            afterSave: () => {},
            afterRefusal: () => {},
            may: () => true,
            failure: 'Not saved.',
          });
          if (options.held) held.autosave.hold(true);
          return () => h('div');
        },
      }),
    );
    function edit(date: string) {
      copy.dates.push(date);
      held.autosave!.edited();
    }
    const leave = () => window.dispatchEvent(new Event('pagehide'));
    return { writes, sendOnUnload, autosave: held.autosave!, wrapper, edit, leave };
  }

  it('tries when an edit is waiting for its pause and no save is out', async () => {
    const { writes, sendOnUnload, wrapper, edit, leave } = mountHost();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(100);
    leave();

    expect(sendOnUnload).toHaveBeenCalledTimes(1);
    expect(writes.send).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('tries when a save is out and a later edit is not in it', async () => {
    const { writes, sendOnUnload, wrapper, edit, leave } = mountHost();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    expect(writes.send).toHaveBeenCalledTimes(1);
    edit('2026-08-02');
    leave();

    expect(sendOnUnload).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('does not try when a save is out and nothing later is unsaved', async () => {
    const { writes, sendOnUnload, wrapper, edit, leave } = mountHost();

    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    expect(writes.send).toHaveBeenCalledTimes(1);
    leave();

    expect(sendOnUnload).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('tries after a save that failed, and after an edit the hold keeps', async () => {
    const failed = mountHost();
    failed.edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await failed.writes.fail(noAnswer);
    failed.leave();
    expect(failed.sendOnUnload).toHaveBeenCalledTimes(1);
    failed.wrapper.unmount();

    const kept = mountHost({ held: true });
    kept.edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    expect(kept.writes.send).not.toHaveBeenCalled();
    kept.leave();
    expect(kept.sendOnUnload).toHaveBeenCalledTimes(1);
    kept.wrapper.unmount();
  });

  it('does not try with nothing unsaved, or once the view is gone', async () => {
    const { writes, sendOnUnload, wrapper, edit, leave } = mountHost();

    leave();
    edit('2026-08-01');
    await vi.advanceTimersByTimeAsync(600);
    await writes.answer();
    leave();
    expect(sendOnUnload).not.toHaveBeenCalled();

    wrapper.unmount();
    edit('2026-08-02');
    leave();
    expect(sendOnUnload).not.toHaveBeenCalled();
  });
});
