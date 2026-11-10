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

import { useAutosave } from '@/utils/useAutosave';

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

function setUp(options: { may?: () => boolean } = {}) {
  const copy = { dates: [] as string[] };
  const writes = heldWrites(() => copy);
  const afterSave = vi.fn();
  const autosave = useAutosave({
    send: writes.send,
    afterSave,
    may: options.may ?? (() => true),
    failure: 'The plan was not saved.',
  });
  function edit(date: string) {
    copy.dates.push(date);
    autosave.edited();
  }
  return { copy, writes, afterSave, autosave, edit };
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
      Host({ send, afterSave: () => {}, may: () => true, failure: 'Not saved.' }, held),
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
        { send: writes.send, afterSave: () => {}, may: () => true, failure: 'Not saved.' },
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
      Host({ send, afterSave: () => {}, may: () => true, failure: 'Not saved.' }, {}),
    );

    wrapper.unmount();

    expect(send).not.toHaveBeenCalled();
  });
});
