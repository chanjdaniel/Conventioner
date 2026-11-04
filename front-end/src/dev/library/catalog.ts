import type { Component } from 'vue';

/**
 * Every entry of the component library, written once and whole, in the review's order (T200's
 * `component-review.md`): one group of the index each, and what each serves, by T191's F12 survey
 * places (C1-C15 for a choice among many, L1-L13 for a long list), its findings, or the screens.
 *
 * An entry's file is under `entries/`, named for its id in PascalCase with `Entry` after it
 * (`filter-toggles` is `FilterTogglesEntry.vue`), where `import.meta.glob` finds it. So adding an
 * entry is adding its line here and its file.
 */
/** Where the library lives, in a development build only. */
export const LIBRARY_PATH = '/dev/components';

export interface LibraryEntry {
  /** Its address under `/dev/components/`, and its file's name under `entries/` (`entryFileName`). */
  id: string;
  /** The index's group it is listed under, and the entry page's title. */
  title: string;
  /** What it is, in a line. */
  summary: string;
  /** The places it would serve. */
  serves: string;
}

export const ENTRIES: readonly LibraryEntry[] = [
  {
    id: 'primitives',
    title: 'Primitives',
    summary:
      'Buttons, fields, chips, the add-row, the drag handle, the link, the card grid, the note',
    serves: 'Every screen',
  },
  {
    id: 'components',
    title: 'Existing components',
    summary:
      'ReadFailed, PhaseBadge, SummaryCard, EmailAddress, VendorNameButton, RowMenu, StepHeader, AnswerValue, SignInMessage, BarLedger, FileDropZone',
    serves: 'The screens that use them',
  },
  {
    id: 'dialog',
    title: 'Dialog',
    summary: 'Three widths, a body that scrolls under a pinned title and actions, a tray, a phone',
    serves: 'All 38 dialogs, the 2 floorplan dialogs, F03',
  },
  {
    id: 'combobox',
    title: 'Combobox',
    summary: 'One choice, several as chips, typed text accepted, a capped match list',
    serves: 'C1-C14, L13, F08',
  },
  {
    id: 'filter-toggles',
    title: 'Filter toggles',
    summary: 'One row of pressed buttons, one choice or several, with counts',
    serves:
      'L2, L5, L6, L8, L12; Applications, Vendors, Payments, Attendance, Assignments, Stats and Markets',
  },
  {
    id: 'list-frame',
    title: 'List frame',
    summary: 'Find, the screen\'s filters, the count line, 50 rows and "Show N more"',
    serves: 'L1, L2, L5, L6, L10, L12, C6',
  },
  {
    id: 'summaries',
    title: 'Summaries',
    summary: 'The names line, and the list frame inside a dialog',
    serves: 'L3, L4, L9',
  },
  {
    id: 'folds',
    title: 'Folds',
    summary: 'Bars folded past 10, row groups folded past 20',
    serves: 'L7, L11',
  },
  {
    id: 'proposals',
    title: 'Proposals',
    summary: 'The badge tones, the data table, the side panel',
    serves: 'The 15 one-off badges, the 6 tables, the vendor drawer and the navigation drawer',
  },
  {
    id: 'export-vendors',
    title: 'Export vendors dialog',
    summary: 'The export redesigned on the new parts: broad, shorter, its chosen columns a cart',
    serves: 'The export dialog, C11, F03',
  },
];

/** The files under `entries/`, loaded when opened. */
const FILES = import.meta.glob<{ default: Component }>('./entries/*.vue');

/** The file an entry's id names: `filter-toggles` is `FilterTogglesEntry.vue`. */
export function entryFileName(id: string): string {
  const words = id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return `${words.join('')}Entry.vue`;
}

export function entryFile(id: string): (() => Promise<{ default: Component }>) | undefined {
  return FILES[`./entries/${entryFileName(id)}`];
}

export function entryById(id: string): LibraryEntry | undefined {
  return ENTRIES.find((entry) => entry.id === id);
}
