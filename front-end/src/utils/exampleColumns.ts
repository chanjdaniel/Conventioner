/**
 * What the example file a market was started from says on the Questions tab (E38/F02/S02).
 *
 * The start keeps, for each question it made and each column it left out, the column's answers
 * read both ways as choices (`exampleColumns`, `back-end/csv_start.py`). A question finds its
 * column by key, the same link the saved import mapping keeps; a question of no column behaves as
 * it always did.
 */
import type { ExampleColumn, FormField } from '@/assets/types/datatypes';

const CHOICE_TYPES = new Set(['select', 'multi_select']);

/** The column a question was made from, or null. */
export function columnOf(
  field: FormField,
  columns: ExampleColumn[] | undefined,
): ExampleColumn | null {
  return columns?.find((column) => column.key === field.key) ?? null;
}

/** The file's options for a type: whole answers for Select, the options inside them for
 *  Multi-Select, and none for any other type. */
export function fileOptions(column: ExampleColumn, type: string): string[] {
  if (type === 'select') return column.options.select;
  if (type === 'multi_select') return column.options.multiSelect;
  return [];
}

/** Whether two option lists are the same options in the same order. */
export function sameOptions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * A question's options once its type changes. A choice with no options yet, or still holding one
 * of the file's readings as filled, takes the file's reading for its new type; options the
 * organizer edited are theirs, and stay, so switching back and forth never drops their work.
 */
export function optionsForType(
  field: FormField,
  type: string,
  column: ExampleColumn | null,
): string[] {
  if (!column || !CHOICE_TYPES.has(type)) return field.options;
  const reading = fileOptions(column, type);
  const blank = field.options.every((option) => !option.trim());
  const unedited =
    sameOptions(field.options, column.options.select) ||
    sameOptions(field.options, column.options.multiSelect);
  return reading.length && (blank || unedited) ? [...reading] : field.options;
}

/** The columns "Add from your file" offers: every kept column no question has the key of. */
export function columnsToAdd(
  columns: ExampleColumn[] | undefined,
  fields: FormField[],
): ExampleColumn[] {
  const keys = new Set(fields.map((f) => f.key));
  return (columns ?? []).filter((column) => !keys.has(column.key));
}

/**
 * A new question made from a column, under the key the saved import mapping already names, so the
 * first import restores it. A choice the file gives nothing to choose from is a question answered
 * in words, as the start makes it.
 */
export function questionFrom(column: ExampleColumn, order: number): FormField {
  const options = [...fileOptions(column, column.type)];
  const type = CHOICE_TYPES.has(column.type) && !options.length ? 'text' : column.type;
  return {
    key: column.key,
    label: column.label,
    helpText: column.helpText ?? undefined,
    type,
    required: false,
    options,
    order,
  };
}
