import { describe, it, expect } from 'vitest';

import type { ExampleColumn, FormField } from '@/assets/types/datatypes';
import {
  columnOf,
  columnsToAdd,
  fileOptions,
  optionsForType,
  questionFrom,
} from '@/utils/exampleColumns';

const SELLS: ExampleColumn = {
  headers: ['What do you sell?'],
  key: 'what_do_you_sell',
  label: 'What do you sell?',
  helpText: null,
  type: 'multi_select',
  question: true,
  options: {
    select: ['Prints', 'Prints, Stickers', 'Stickers'],
    multiSelect: ['Prints', 'Stickers'],
  },
};
const STATUS: ExampleColumn = {
  headers: ['Status'],
  key: 'status',
  label: 'Status',
  helpText: 'Our call',
  type: 'select',
  question: false,
  options: { select: ['Accepted', 'Waitlist'], multiSelect: ['Accepted', 'Waitlist'] },
};

function field(patch: Partial<FormField> = {}): FormField {
  return {
    key: 'what_do_you_sell',
    label: 'What do you sell?',
    type: 'checkbox',
    required: false,
    options: [],
    order: 0,
    ...patch,
  };
}

describe('the example file on the Questions tab (E38/F02/S02)', () => {
  it('finds a question’s column by its key, and none for a question of no column', () => {
    expect(columnOf(field(), [SELLS, STATUS])).toBe(SELLS);
    expect(columnOf(field({ key: 'shop' }), [SELLS, STATUS])).toBeNull();
    expect(columnOf(field(), undefined)).toBeNull();
  });

  it('reads whole answers for Select and the options inside them for Multi-Select', () => {
    expect(fileOptions(SELLS, 'select')).toEqual(['Prints', 'Prints, Stickers', 'Stickers']);
    expect(fileOptions(SELLS, 'multi_select')).toEqual(['Prints', 'Stickers']);
    expect(fileOptions(SELLS, 'text')).toEqual([]);
  });

  it('fills a choice’s options from the file when it has none yet', () => {
    expect(optionsForType(field(), 'select', SELLS)).toEqual([
      'Prints',
      'Prints, Stickers',
      'Stickers',
    ]);
    expect(optionsForType(field({ options: ['', ' '] }), 'multi_select', SELLS)).toEqual([
      'Prints',
      'Stickers',
    ]);
  });

  it('swaps one reading for the other while the organizer has not edited it', () => {
    const filled = field({ type: 'select', options: ['Prints', 'Prints, Stickers', 'Stickers'] });
    expect(optionsForType(filled, 'multi_select', SELLS)).toEqual(['Prints', 'Stickers']);
  });

  it('keeps options the organizer edited, whatever the type becomes', () => {
    const edited = field({ type: 'select', options: ['Prints', 'Art prints'] });
    expect(optionsForType(edited, 'multi_select', SELLS)).toEqual(['Prints', 'Art prints']);
    expect(optionsForType(edited, 'text', SELLS)).toEqual(['Prints', 'Art prints']);
  });

  it('changes nothing for a question of no column', () => {
    expect(optionsForType(field({ options: [] }), 'select', null)).toEqual([]);
  });

  it('offers the columns no question has the key of', () => {
    expect(columnsToAdd([SELLS, STATUS], [field()])).toEqual([STATUS]);
    expect(columnsToAdd([SELLS, STATUS], [])).toEqual([SELLS, STATUS]);
    expect(columnsToAdd(undefined, [])).toEqual([]);
  });

  it('makes a question from a column with its label, help text, key, type and options', () => {
    expect(questionFrom(STATUS, 3)).toEqual({
      key: 'status',
      label: 'Status',
      helpText: 'Our call',
      type: 'select',
      required: false,
      options: ['Accepted', 'Waitlist'],
      order: 3,
    });
  });

  it('makes a choice with nothing to choose from a question answered in words, as the start does', () => {
    const bare = { ...STATUS, options: { select: [], multiSelect: [] } };
    expect(questionFrom(bare, 0)).toMatchObject({ type: 'text', options: [] });
  });
});
