import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useFold } from '@/utils/useFold';

const rows = Array.from({ length: 31 }, (_, at) => at);

describe('useFold', () => {
  it('holds its own fold unless told otherwise, starting folded', async () => {
    const fold = useFold(
      () => rows,
      () => 20,
    );
    expect(fold.shown.value).toHaveLength(20);
    expect(fold.rest.value).toBe(11);
    await fold.toggle();
    expect(fold.unfolded.value).toBe(true);
    expect(fold.shown.value).toHaveLength(31);
  });

  it("reads and writes a fold it is given, so a page can hold its groups' folds", async () => {
    const held = ref(true);
    const fold = useFold(
      () => rows,
      () => 20,
      held,
    );
    expect(fold.unfolded).toBe(held);
    expect(fold.shown.value).toHaveLength(31);
    held.value = false;
    expect(fold.shown.value).toHaveLength(20);
    await fold.toggle();
    expect(held.value).toBe(true);
    expect(fold.shown.value).toHaveLength(31);
  });

  it('shows every row at or under the fold, whatever it is given', () => {
    const fold = useFold(
      () => rows.slice(0, 20),
      () => 20,
      ref(false),
    );
    expect(fold.rest.value).toBe(0);
    expect(fold.shown.value).toHaveLength(20);
  });
});
