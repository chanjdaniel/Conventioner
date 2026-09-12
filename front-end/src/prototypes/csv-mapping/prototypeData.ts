/**
 * THROWAWAY PROTOTYPE DATA - not production code.
 *
 * Three variants of the CSV column-mapping screen, switchable via `?variant=`, on the
 * throwaway route `/prototype/csv-mapping`. Everything here is in-memory: no API calls,
 * no persistence. Delete this whole directory once a variant has won.
 */

export type TargetId =
  | 'essential_email'
  | 'essential_available_dates'
  | 'essential_tier_preference'
  | 'essential_max_dates'
  | 'essential_section_ranking'
  | 'essential_table_choice'
  | 'essential_table_share_email'
  | 'submitted_at'
  | 'custom_business_name'
  | 'custom_returning_vendor'
  | 'custom_instagram';

export interface MappingTarget {
  id: TargetId;
  label: string;
  /** What the solver does with it - one short sentence, organizer-facing. */
  help: string;
  required: boolean;
  /** `multi` targets can consume several CSV columns at once (checkbox-grid exports). */
  arity: 'single' | 'multi';
  group: 'essential' | 'meta' | 'custom';
  /** Which market vocabulary a cell value must resolve against, if any. */
  vocabulary?: 'dates' | 'tiers' | 'sections' | 'tableChoice';
}

export const TARGETS: MappingTarget[] = [
  {
    id: 'essential_email',
    label: 'Applicant email',
    help: 'Identifies the vendor. Every downstream notification goes here.',
    required: true,
    arity: 'single',
    group: 'essential',
  },
  {
    id: 'essential_available_dates',
    label: 'Available dates',
    help: 'Which market dates the vendor can attend. The solver will not assign any other day.',
    required: true,
    arity: 'multi',
    group: 'essential',
    vocabulary: 'dates',
  },
  {
    id: 'essential_tier_preference',
    label: 'Tier preference',
    help: 'The set of tiers this vendor will accept.',
    required: true,
    arity: 'multi',
    group: 'essential',
    vocabulary: 'tiers',
  },
  {
    id: 'essential_max_dates',
    label: 'Max days',
    help: 'Whole-number cap on how many days one vendor is assigned.',
    required: true,
    arity: 'single',
    group: 'essential',
  },
  {
    id: 'essential_section_ranking',
    label: 'Section ranking',
    help: 'Preferred sections, best first. Ties are broken by application time.',
    required: true,
    arity: 'multi',
    group: 'essential',
    vocabulary: 'sections',
  },
  {
    id: 'essential_table_choice',
    label: 'Table choice',
    help: 'Full table, half table, or either.',
    required: true,
    arity: 'single',
    group: 'essential',
    vocabulary: 'tableChoice',
  },
  {
    id: 'essential_table_share_email',
    label: 'Table-share partner email',
    help: 'Optional. The solver seats the pair together when both applied.',
    required: false,
    arity: 'single',
    group: 'essential',
  },
  {
    id: 'submitted_at',
    label: 'Submitted at',
    help: 'The Google Forms Timestamp. Breaks ties when demand exceeds tables.',
    required: false,
    arity: 'single',
    group: 'meta',
  },
  {
    id: 'custom_business_name',
    label: 'Business name (custom)',
    help: 'Organizer-defined text field. Shown on the floorplan and the check-in list.',
    required: false,
    arity: 'single',
    group: 'custom',
  },
  {
    id: 'custom_returning_vendor',
    label: 'Returning vendor? (custom)',
    help: 'Organizer-defined checkbox field.',
    required: false,
    arity: 'single',
    group: 'custom',
  },
  {
    id: 'custom_instagram',
    label: 'Instagram handle (custom)',
    help: 'Organizer-defined text field.',
    required: false,
    arity: 'single',
    group: 'custom',
  },
];

export function targetById(id: TargetId): MappingTarget {
  return TARGETS.find((t) => t.id === id)!;
}

/** The market's own configuration - what CSV cell values have to resolve against. */
export const MARKET_CONFIG = {
  name: 'Riverside Summer Market',
  dates: ['Saturday July 4', 'Sunday July 5', 'Monday July 6'],
  tiers: ['Gold', 'Silver'],
  sections: ['Main Hall', 'Annex', 'Courtyard'],
  tableChoice: ['Full table', 'Half table', 'Either'],
};

export interface CsvDataset {
  key: 'grid' | 'single';
  /** How the reviewer should read this fixture. */
  shapeLabel: string;
  fileName: string;
  headers: string[];
  rows: string[][];
}

/**
 * Shape 1: the checkbox GRID export. One column per option, three of them, all feeding
 * one target. This is the shape a naive one-column-to-one-target screen breaks on.
 */
export const DATASET_GRID: CsvDataset = {
  key: 'grid',
  shapeLabel: 'Checkbox grid export (one column per day)',
  fileName: 'Riverside Summer 2026 (Responses) - Form Responses 1.csv',
  headers: [
    'Timestamp',
    'Email Address',
    'Business name',
    'Which days can you attend? [Saturday July 4]',
    'Which days can you attend? [Sunday July 5]',
    'Which days can you attend? [Monday July 6]',
    'What is the maximum number of days you want?',
    'Which tier are you applying for?',
    'Rank your preferred sections',
    'Do you want a full or half table?',
    "If sharing, your partner's email",
    'Have you vended with us before?',
    'Instagram handle',
  ],
  rows: [
    [
      '2026/05/02 9:14:03 AM AST',
      'nadia@emberceramics.ca',
      'Ember Ceramics',
      'Yes',
      'Yes',
      '',
      '2',
      'Gold',
      'Main Hall, Annex, Courtyard',
      'Full table',
      '',
      'Yes',
      '@emberceramics',
    ],
    [
      '2026/05/02 11:40:22 AM AST',
      'hello@thornandthistle.com',
      'Thorn & Thistle',
      'Yes',
      '',
      'Yes',
      '3',
      'Gold Tier',
      'Courtyard, Main Hall',
      'Half table',
      'nadia@emberceramics.ca',
      'No',
      '@thornthistle',
    ],
    [
      '2026/05/03 8:02:55 AM AST',
      'sam@driftwoodprints.ca',
      'Driftwood Prints',
      '',
      'Yes',
      'Yes',
      '2',
      'Silver',
      'Annex, Courtyard, Main Hall',
      'Either',
      '',
      'Yes',
      '@driftwoodprints',
    ],
    [
      '2026/05/03 4:26:10 PM AST',
      'jamie[at]clayworks.ca',
      'Clayworks Studio',
      'Yes',
      'Yes',
      'Yes',
      '1',
      'Silver',
      'Main Hall',
      'Full table',
      '',
      'No',
      '@clayworksstudio',
    ],
    [
      '2026/05/04 10:11:47 AM AST',
      'orders@harbourhoney.ca',
      'Harbour Honey Co.',
      'Yes',
      '',
      '',
      '1',
      'Gold, Silver',
      'Courtyard (outdoor)',
      'Half table',
      'sam@driftwoodprints.ca',
      'Yes',
      '@harbourhoney',
    ],
    [
      '2026/05/04 1:55:09 PM AST',
      'studio@fernandflint.ca',
      'Fern & Flint',
      '',
      'Yes',
      '',
      'as many as possible',
      'Silver',
      'Annex, Main Hall',
      'Either',
      '',
      'No',
      '@fernandflint',
    ],
    [
      '2026/05/05 7:31:18 AM AST',
      'kit@paperlanternco.com',
      'Paper Lantern Co.',
      'Yes',
      'Yes',
      'Yes',
      '3',
      'Gold',
      'Main Hall, Courtyard',
      'Full table',
      '',
      'Yes',
      '@paperlanternco',
    ],
    [
      '2026/05/05 9:47:36 PM AST',
      'bea@saltmarshsoap.ca',
      'Saltmarsh Soap',
      '',
      '',
      'Yes',
      '1',
      'Silver',
      'Annex',
      'Half table',
      '',
      'No',
      '@saltmarshsoap',
    ],
  ],
};

/**
 * Shape 2: the SAME question asked as a single checkbox question. One column, comma
 * separated values. Same three targets, completely different column shape.
 */
export const DATASET_SINGLE: CsvDataset = {
  key: 'single',
  shapeLabel: 'Single checkbox question (comma-separated in one column)',
  fileName: 'Riverside Summer 2026 (Responses) - Form Responses 1 (v2).csv',
  headers: [
    'Timestamp',
    'Email Address',
    'Business name',
    'Which days can you attend? (check all that apply)',
    'What is the maximum number of days you want?',
    'Which tier are you applying for?',
    'Rank your preferred sections',
    'Do you want a full or half table?',
    "If sharing, your partner's email",
    'Have you vended with us before?',
    'Instagram handle',
  ],
  rows: DATASET_GRID.rows.map((r) => {
    const days = [
      r[3] ? 'Saturday July 4' : '',
      r[4] ? 'Sunday July 5' : '',
      r[5] ? 'Monday July 6' : '',
    ]
      .filter(Boolean)
      .join(', ');
    return [r[0], r[1], r[2], days, r[6], r[7], r[8], r[9], r[10], r[11], r[12]];
  }),
};

export const DATASETS: CsvDataset[] = [DATASET_GRID, DATASET_SINGLE];

/** target id -> the CSV headers feeding it. Missing key = unmapped. */
export type Mapping = Partial<Record<TargetId, string[]>>;

/** Why a mapping row looks the way it does when the screen opens. */
export type Provenance = 'auto' | 'restored' | 'header-changed' | 'manual';

export interface MappingState {
  mapping: Mapping;
  provenance: Partial<Record<TargetId, Provenance>>;
}

/**
 * What the market remembers from the organizer's last import. One header was renamed in
 * the Form since then, and one is gone entirely - both have to show up as flags.
 */
export const LAST_IMPORT = {
  when: 'Apr 18, 2026',
  headers: {
    essential_email: ['Email Address'],
    essential_max_dates: ['What is the maximum number of days you want?'],
    essential_table_share_email: ['Partner email if sharing'],
    custom_business_name: ['Business name'],
    custom_instagram: ['Instagram handle'],
  } as Partial<Record<TargetId, string[]>>,
  /** Mapped last time, and the header no longer exists in this export. */
  vanished: [{ target: 'custom_returning_vendor' as TargetId, header: 'Have you sold with us?' }],
};

/** Crude header matcher - good enough to make the screen feel alive. */
function guess(header: string): TargetId | null {
  const h = header.toLowerCase();
  if (h === 'timestamp') return 'submitted_at';
  if (h.includes('email address')) return 'essential_email';
  if (h.includes('partner')) return 'essential_table_share_email';
  if (h.includes('which days')) return 'essential_available_dates';
  if (h.includes('maximum number of days')) return 'essential_max_dates';
  if (h.includes('tier')) return 'essential_tier_preference';
  if (h.includes('rank') && h.includes('section')) return 'essential_section_ranking';
  if (h.includes('full or half')) return 'essential_table_choice';
  if (h.includes('business name')) return 'custom_business_name';
  if (h.includes('vended')) return 'custom_returning_vendor';
  if (h.includes('instagram')) return 'custom_instagram';
  return null;
}

/** 0-1 how sure the auto-detector is. Purely cosmetic, but it drives variant C's ordering. */
export function confidence(header: string, target: TargetId): number {
  const h = header.toLowerCase();
  if (target === 'submitted_at' && h === 'timestamp') return 1;
  if (target === 'essential_email' && h === 'email address') return 0.98;
  if (target === 'essential_available_dates' && h.startsWith('which days')) return 0.92;
  if (target === 'essential_table_share_email' && h.includes('partner')) return 0.74;
  if (guess(header) === target) return 0.85;
  return 0.12;
}

/**
 * The state the screen opens in: last import's mapping restored where the header still
 * exists, auto-detection filling the rest.
 */
export function initialMappingState(dataset: CsvDataset): MappingState {
  const mapping: Mapping = {};
  const provenance: MappingState['provenance'] = {};

  for (const header of dataset.headers) {
    const t = guess(header);
    if (!t) continue;
    mapping[t] = [...(mapping[t] ?? []), header];
    provenance[t] = 'auto';
  }

  for (const [target, headers] of Object.entries(LAST_IMPORT.headers) as [TargetId, string[]][]) {
    const stillHere = headers.filter((h) => dataset.headers.includes(h));
    if (stillHere.length === headers.length) {
      mapping[target] = stillHere;
      provenance[target] = 'restored';
    } else if (mapping[target]) {
      // The Form renamed this question; we re-found it, but say so out loud.
      provenance[target] = 'header-changed';
    }
  }

  return { mapping, provenance };
}

export function renamedFrom(target: TargetId): string | null {
  const old = LAST_IMPORT.headers[target];
  return old ? old[0] : null;
}

export function unmappedHeaders(dataset: CsvDataset, mapping: Mapping): string[] {
  const used = new Set(Object.values(mapping).flat());
  return dataset.headers.filter((h) => !used.has(h));
}

export function targetOfHeader(mapping: Mapping, header: string): TargetId | null {
  for (const [t, headers] of Object.entries(mapping) as [TargetId, string[]][]) {
    if (headers.includes(header)) return t;
  }
  return null;
}

/** Assign a header to a target, respecting arity and stealing it from wherever it was. */
export function assign(state: MappingState, header: string, target: TargetId | null): void {
  for (const key of Object.keys(state.mapping) as TargetId[]) {
    state.mapping[key] = state.mapping[key]!.filter((h) => h !== header);
    if (state.mapping[key]!.length === 0) delete state.mapping[key];
  }
  if (!target) return;
  const t = targetById(target);
  const existing = t.arity === 'multi' ? (state.mapping[target] ?? []) : [];
  state.mapping[target] = [...existing, header];
  state.provenance[target] = 'manual';
}

export function missingRequired(mapping: Mapping): MappingTarget[] {
  return TARGETS.filter((t) => t.required && !(mapping[t.id]?.length ?? 0));
}

/* ------------------------------------------------------------------ value matching */

export interface UnmatchedValue {
  target: TargetId;
  raw: string;
  rowCount: number;
  suggestion: string | null;
  /** The organizer's choice, once made. `''` = "ignore this value". */
  resolvedTo: string | null;
}

/**
 * Only the values that FAILED to auto-match. `Gold` matched `Gold` silently and never
 * appears here; `Gold Tier` did not, so it does.
 */
export function initialUnmatched(dataset: CsvDataset): UnmatchedValue[] {
  const base: UnmatchedValue[] = [
    {
      target: 'essential_tier_preference',
      raw: 'Gold Tier',
      rowCount: 1,
      suggestion: 'Gold',
      resolvedTo: null,
    },
    {
      target: 'essential_section_ranking',
      raw: 'Courtyard (outdoor)',
      rowCount: 1,
      suggestion: 'Courtyard',
      resolvedTo: null,
    },
  ];
  if (dataset.key === 'grid') {
    // Grid exports carry `Yes`/blank per column, so the day names come from the header
    // rather than the cell - one fewer class of mismatch.
    return base;
  }
  return [
    ...base,
    {
      target: 'essential_available_dates',
      raw: 'Sat Jul 4',
      rowCount: 2,
      suggestion: 'Saturday July 4',
      resolvedTo: null,
    },
  ];
}

export function autoMatchedCount(dataset: CsvDataset): number {
  return dataset.key === 'grid' ? 31 : 34;
}

export function vocabularyFor(target: TargetId): string[] {
  const v = targetById(target).vocabulary;
  if (v === 'dates') return MARKET_CONFIG.dates;
  if (v === 'tiers') return MARKET_CONFIG.tiers;
  if (v === 'sections') return MARKET_CONFIG.sections;
  if (v === 'tableChoice') return MARKET_CONFIG.tableChoice;
  return [];
}

/* -------------------------------------------------------------------- row outcomes */

export interface RowOutcome {
  rowNumber: number;
  vendor: string;
  status: 'ok' | 'skipped';
  reason: string | null;
}

/** Refuse at the mapping level, tolerate at the row level: these are the tolerated ones. */
export function rowOutcomes(dataset: CsvDataset): RowOutcome[] {
  return dataset.rows.map((row, i) => {
    const email = row[1];
    const vendor = row[2];
    const maxDays = dataset.key === 'grid' ? row[6] : row[4];
    if (!email.includes('@')) {
      return {
        rowNumber: i + 2,
        vendor,
        status: 'skipped',
        reason: `Applicant email "${email}" is not a valid email address.`,
      };
    }
    if (!/^\d+$/.test(maxDays.trim())) {
      return {
        rowNumber: i + 2,
        vendor,
        status: 'skipped',
        reason: `Max days reads "${maxDays}", which is not a whole number.`,
      };
    }
    return { rowNumber: i + 2, vendor, status: 'ok', reason: null };
  });
}

/** What one CSV cell contributes, resolved through the mapping. Used by the preview. */
export function resolvedCell(
  dataset: CsvDataset,
  mapping: Mapping,
  rowIndex: number,
  target: TargetId,
  /** Hand-mapped values, so the preview shows `Gold`, not `Gold Tier`. */
  resolutions: UnmatchedValue[] = [],
): string {
  const headers = mapping[target] ?? [];
  if (headers.length === 0) return '--';
  const row = dataset.rows[rowIndex];
  const parts: string[] = [];
  for (const h of headers) {
    const value = row[dataset.headers.indexOf(h)] ?? '';
    if (!value.trim()) continue;
    if (headers.length > 1) {
      // Grid shape: the header carries the option name, the cell only says "ticked".
      const inside = h.match(/\[(.+)\]$/);
      parts.push(inside ? inside[1] : h);
    } else {
      parts.push(value);
    }
  }
  return (
    parts
      .flatMap((p) => p.split(',').map((s) => s.trim()))
      .map((p) => {
        const fix = resolutions.find((u) => u.target === target && u.raw === p);
        if (!fix) return p;
        return fix.resolvedTo ?? fix.suggestion ?? p;
      })
      .join(', ') || '--'
  );
}

/** `Which days can you attend? [Saturday July 4]` -> `Saturday July 4`. */
export function optionLabel(header: string): string | null {
  const m = header.match(/\[(.+)\]$/);
  return m ? m[1] : null;
}

/** `Which days can you attend? [Saturday July 4]` -> `Which days can you attend?`. */
export function questionStem(header: string): string {
  return header.replace(/\s*\[.+\]$/, '');
}

/** Columns that share a question stem - the checkbox-grid signature. */
export function gridGroups(headers: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const h of headers) {
    if (!optionLabel(h)) continue;
    const stem = questionStem(h);
    groups[stem] = [...(groups[stem] ?? []), h];
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 1));
}

export const FLOW_STEPS = ['Upload', 'Map columns', 'Preview', 'Confirm'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];
