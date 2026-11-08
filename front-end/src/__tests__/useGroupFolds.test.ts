import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useGroupFolds, type FoldedGroup } from '@/utils/useGroupFolds';

const NORTH = { key: 'north', rows: 31 };
const SOUTH = { key: 'south', rows: 28 };
const LANDING = { key: 'landing', rows: 5 };

function folds(groups: FoldedGroup[]) {
  const held = ref(groups);
  return { held, ...useGroupFolds(() => held.value, 20) };
}

describe('useGroupFolds', () => {
  it('offers the page a button only while a group passes the fold', () => {
    expect(folds([LANDING, { key: 'at', rows: 20 }]).offered.value).toBe(false);
    expect(folds([LANDING, { key: 'past', rows: 21 }]).offered.value).toBe(true);
    expect(folds([]).offered.value).toBe(false);
  });

  it("counts every group's rows for the page's button, those under the fold too", () => {
    expect(folds([NORTH, SOUTH, LANDING]).rows.value).toBe(64);
  });

  it('unfolds every group past the fold, and folds them all again', () => {
    const page = folds([NORTH, SOUTH, LANDING]);
    expect(page.allUnfolded.value).toBe(false);
    page.toggleAll();
    expect(page.isUnfolded('north')).toBe(true);
    expect(page.isUnfolded('south')).toBe(true);
    expect(page.allUnfolded.value).toBe(true);
    page.toggleAll();
    expect(page.isUnfolded('north')).toBe(false);
    expect(page.isUnfolded('south')).toBe(false);
    expect(page.allUnfolded.value).toBe(false);
  });

  it('reflects groups unfolded one at a time, and one folded again', () => {
    const page = folds([NORTH, SOUTH, LANDING]);
    page.setUnfolded('north', true);
    expect(page.allUnfolded.value).toBe(false);
    page.setUnfolded('south', true);
    expect(page.allUnfolded.value, 'a group with no fold has nothing to unfold').toBe(true);
    page.setUnfolded('north', false);
    expect(page.allUnfolded.value).toBe(false);
  });

  it('from some unfolded, the button unfolds the rest', () => {
    const page = folds([NORTH, SOUTH]);
    page.setUnfolded('north', true);
    page.toggleAll();
    expect(page.isUnfolded('north')).toBe(true);
    expect(page.isUnfolded('south')).toBe(true);
  });

  it('keeps a fold when a filter takes its group under the fold or off the page', () => {
    const page = folds([NORTH, SOUTH]);
    page.setUnfolded('north', true);
    page.held.value = [{ key: 'north', rows: 3 }, SOUTH];
    expect(page.isUnfolded('north')).toBe(true);
    page.held.value = [SOUTH];
    expect(page.offered.value).toBe(true);
    expect(page.allUnfolded.value).toBe(false);
    page.held.value = [NORTH, SOUTH];
    expect(page.isUnfolded('north')).toBe(true);
    expect(page.allUnfolded.value).toBe(false);
  });

  it('touches only the groups on the page, so a filter hides no change', () => {
    const page = folds([NORTH, SOUTH]);
    page.setUnfolded('north', true);
    page.held.value = [SOUTH];
    page.toggleAll();
    expect(page.isUnfolded('south')).toBe(true);
    page.toggleAll();
    expect(page.isUnfolded('south')).toBe(false);
    expect(page.isUnfolded('north'), 'the group the filter hid stays as it was').toBe(true);
  });

  it('forgets every fold on a reset, for another market', () => {
    const page = folds([NORTH, SOUTH]);
    page.toggleAll();
    page.reset();
    expect(page.isUnfolded('north')).toBe(false);
    expect(page.allUnfolded.value).toBe(false);
  });
});
