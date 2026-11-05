<script setup lang="ts">
/**
 * Importing vendors from a CSV of responses the organizer already collected.
 *
 * A full-width flow rather than a dialog: mapping a dozen columns against a target list is too
 * dense for one, and Market Setup already carries dates, sections, tiers, priorities and the form
 * builder.
 *
 * The layout is a column ledger - one row per CSV column, in file order, each with a "Maps to"
 * control - with a rail tracking which required questions are still unserved. That shape won a
 * three-variant prototype because mappings are pre-filled on re-import, and a filled ledger is
 * scannable: the eye goes to the exceptions. Designs built around the act of assigning opened
 * with nothing left to assign.
 */
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import { whoMayTake } from '@/utils/permissionTable';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { marketPath } from '@/utils/market';
import { useRoute, useRouter } from 'vue-router';
import { useOpenMarket } from '@/utils/openMarket';
import MarketFrame from '@/components/MarketFrame.vue';
import FileDropZone from '@/components/FileDropZone.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { getFormattedDate, oneLine } from '@/utils/utils';
import { firstImportBlockers, importRefusal, takesNoImport } from '@/utils/importPhase';
import BlockerPanel from '@/components/BlockerPanel.vue';
import { readCsvFile } from '@/utils/csvFile';
import AmendFormDialog from '@/components/application/AmendFormDialog.vue';
import ChoiceField from '@/components/ChoiceField.vue';
import type { PickerGroup, PickerOption } from '@/components/SearchPicker.vue';
import ValueFixes from '@/components/ValueFixes.vue';
import { IGNORE_VALUE } from '@/utils/valueFixes';
import { EMPTY_ESSENTIAL_OPTIONS, applicantName } from '@/utils/essentialFields';
import {
  findsRejectedRow,
  findsReplacedRow,
  IMPORT_LIST_FIRST,
  previewHeadline as previewHeadlineText,
  rejectedRowsWhy,
  writingRowCount,
} from '@/utils/importPreview';
import { reviewAnswers } from '@/utils/reviewQueue';
import ImportRowList, { type ImportRow } from '@/components/csvImport/ImportRowList.vue';
import ImportRefusedRows, { type RefusedRow } from '@/components/csvImport/ImportRefusedRows.vue';
import ListFrame from '@/components/ListFrame.vue';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import {
  chooseReviewers,
  reviewerAddresses,
  sameTeam,
  teamToChange,
  unansweredWrite,
} from '@/utils/reviewTeam';
import {
  MarketPhase,
  type ApplicationForm,
  type EssentialFormOptions,
  type Market,
} from '@/assets/types/datatypes';
import {
  AVAILABLE_DATES_KEY,
  SECTION_RANKING_KEY,
  TABLE_TYPE_RANKING_KEY,
  TIER_PREFERENCE_KEY,
  UNASKABLE_ESSENTIAL_KEYS,
} from '@/utils/essentialFields';

/** Targets whose answer is several values, so one column holds a comma-separated list. */
const MULTI_VALUE_TARGETS = new Set<string>([
  AVAILABLE_DATES_KEY,
  TIER_PREFERENCE_KEY,
  SECTION_RANKING_KEY,
  TABLE_TYPE_RANKING_KEY,
]);

type Step = 'upload' | 'map' | 'preview' | 'done';

/**
 * Sentinel for "I want this column and there is no target for it". Not a mapping - it never
 * reaches the server - it is the ledger's way of explaining the dead end rather than leaving the
 * organizer to conclude the import is broken.
 */
const NEEDS_A_FIELD = '__needs_a_field__';

/** The target "Submitted at", `csv_import.SUBMITTED_AT_TARGET`. */
const SUBMITTED_AT_KEY = 'submitted_at';

interface ImportTarget {
  key: string;
  label: string;
  required: boolean;
  kind: 'identity' | 'essential' | 'custom' | 'meta';
}

/** Several columns that are one question: a Google Forms checkbox or multiple-choice grid. */
interface ColumnGroup {
  stem: string;
  columns: number[];
  options: string[];
}

/** A cell value that names nothing this market offers, and how many rows carry it. */
interface UnmatchedValue {
  target: string;
  targetLabel: string;
  value: string;
  rows: number;
  offered: string[];
}

/** A row of the file as the dry run says it will be stored, and why a rule rejects it, if one does. */
interface PreviewRow {
  row: number;
  email: string;
  formData: Record<string, unknown> | null;
  reason?: string;
}

/** A value a saved decision settles, with that decision: listed so it can be changed. */
interface DecidedValue extends UnmatchedValue {
  choice: string | null;
}

/** An earlier submission, replaced by the same applicant's later row in the file. */
interface ImportRepeat {
  row: number;
  email: string;
  latestRow: number;
}

const router = useRouter();

/**
 * The market in the route, from the one store (E21/F02/S04). It used to be read out of
 * `localStorage`, because `/import-applications` carried no id - and an import writes the market
 * without ever touching that copy, so returning to Market Setup after one showed the market as it
 * had been.
 */
const route = useRoute();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market, refresh: refreshMarket } = useOpenMarket(marketId);

/**
 * Importing belongs to a draft's first import and to Review (E38/F04/S01). The server enforces this
 * - all three import endpoints are reachable directly, and a hidden button is not a rule - but
 * saying so before the organizer picks a file beats letting them choose one and then refusing it.
 */
const marketPhase = computed(() => String((market.value as { phase?: string })?.phase ?? ''));
/** Importing is the table's import row: who is asking comes before the phase (bug 37). */
const roleRefusal = computed(() => actionRefusal(market.value, MarketAction.ImportApplications));
/** Who may overturn what the automatic rejections rejected, from the market's table (E38/F06/S01). */
const overturnedBy = computed(() =>
  whoMayTake(market.value?.permissionTable, MarketAction.ChangeVerdicts),
);
const phaseRefusal = computed(() => roleRefusal.value || importRefusal(market.value));
/**
 * What a draft's first import waits on, for someone who may import: every blocker of the move into
 * Review at once, each linked to where it is done, so one trip to Market Setup is enough
 * (T205/F09). The role refusal is said before the plan, so its reader is shown none of them.
 */
const firstImportWaitsOn = computed(() =>
  roleRefusal.value ? [] : firstImportBlockers(market.value),
);
const takingApplications = computed(() => Boolean(market.value) && !phaseRefusal.value);
/**
 * A draft's first import takes it into Review once it is written; in Review the import reads the
 * whole responses file again (E38/F04/S01, S03). Said on the page, since the file to bring differs.
 */
const firstImport = computed(() => marketPhase.value === MarketPhase.Draft);
/** The market entered Review with this import: the done step says where it now stands. */
const enteredReview = ref(false);

/**
 * The first import is where a Google Form market's review begins, so its preview step offers the
 * reviewers, as "Open applications" does on a market's own form (E38/F07/S02): chosen before the
 * rows are written, the server deals them as they arrive. A redo import offers nothing: by then the
 * reviewers are the Reviewers panel's.
 */
const offersReviewers = computed(
  () => firstImport.value && mayTake(market.value, MarketAction.ChooseReviewers),
);
/** The reviewers ticked: none, or whoever was chosen in draft before. */
const reviewers = ref<string[]>([]);
watch(
  () => market.value?.id,
  () => {
    reviewers.value = teamToChange(market.value);
  },
  { immediate: true },
);
/** Why the reviewers could not be written; nothing is imported then. */
const reviewersError = ref('');

const step = ref<Step>('upload');

/** Leave the wizard for the market it belongs to. Nothing is written until the final confirm. */
function leaveImport() {
  if (market.value?.id) router.push(marketPath(market.value.id, 'applications'));
  else router.push('/markets');
}
const busy = ref(false);
const error = ref('');
const fileName = ref('');
const csvContent = ref('');

const headers = ref<string[]>([]);
const sampleValues = ref<string[][]>([]);
const rowCount = ref(0);
const targets = ref<ImportTarget[]>([]);
/** Column index -> target key. The ledger is column-driven, so this is its natural direction. */
const columnTarget = ref<Record<number, string>>({});
const groups = ref<ColumnGroup[]>([]);
/** A previous import's decisions, re-applied to this file. */
const restoredTargets = ref<Set<string>>(new Set());
const restoredMissing = ref<Array<{ target: string; missingHeaders: string[] }>>([]);
const newHeaders = ref<string[]>([]);
const hasSavedMapping = ref(false);
/**
 * Whose decisions the saved mapping holds: the start of the form, or an earlier import. The first
 * import after a start used to call the start's choices "your last import" (E30/F02/S01).
 */
const savedMappingFrom = ref<'start' | 'import'>('import');
/** Does this market order vendors by when they applied? Decides the warning below. */
const ordersBySubmittedAt = ref(false);
/**
 * Targets whose own option labels contain commas, as the server reports them.
 *
 * A checkbox question exports one column holding the selected labels comma-joined, and throws the
 * separator information away before writing the file. When the labels themselves contain commas,
 * nothing can recover which separator was which - so a single column mapped to one of these
 * produces fragments, and the organizer is owed the reason rather than a list of values that
 * "did not match your market".
 */
const commaBearingTargets = ref<Set<string>>(new Set());
/** Group stem -> target key: a grid is mapped once, for all of its columns at a time. */
const groupTarget = ref<Record<string, string>>({});
/** Stems the organizer has broken apart, when the detection guessed wrong. */
const splitStems = ref<Set<string>>(new Set());

const unmatched = ref<UnmatchedValue[]>([]);
/** The file's values a decision already settles - restored, saved by the proposal, or made here. */
const decided = ref<DecidedValue[]>([]);
/** target -> raw value -> the market's own name for it, or '' meaning "ignore this value". */
const resolutions = ref<Record<string, Record<string, string>>>({});
/** The resolutions the saved mapping arrived with, to tell its decisions from the organizer's. */
const startedResolutions = ref<Record<string, Record<string, string>>>({});

const created = ref(0);
const updated = ref(0);
/** Applications already here whose answers this file does not change: nothing is written. */
const unchanged = ref(0);
/** How many the market's automatic rejections rejected (E33/F03/S02). */
const rejectedByRules = ref(0);
const failures = ref<RefusedRow[]>([]);
/** What the dry run said would import, and what it said would be skipped. */
const validRows = ref(0);
const previewFailures = ref<RefusedRow[]>([]);
/** How the file lands against what is already here. */
const newRows = ref(0);
const updatedRows = ref(0);
const unchangedRows = ref(0);

/** How many rows the import will write, as the headline counts them: the confirm button's count. */
const writingRows = computed(() =>
  writingRowCount({
    validRows: validRows.value,
    newRows: newRows.value,
    updatedRows: updatedRows.value,
    unchangedRows: unchangedRows.value,
  }),
);

/**
 * The preview's headline: what the import will write. It counted every readable row, so importing
 * the same file again read "212 of 212 rows will be imported" beside "0 new, 0 updated, 212
 * unchanged" (2026-10-18 dry run). The wording lives in `previewHeadline` (utils/importPreview),
 * so the sentences are tested apart from the view.
 */
const previewHeadline = computed(() =>
  previewHeadlineText({
    rowCount: rowCount.value,
    validRows: validRows.value,
    newRows: newRows.value,
    updatedRows: updatedRows.value,
    unchangedRows: unchangedRows.value,
    rejected: previewRejected.value.length,
  }),
);
const absentApplications = ref(0);
const absentEmails = ref<string[]>([]);
const returningToReview = ref(0);
const returningEmails = ref<string[]>([]);
/** Rows the file holds more than once for one applicant: each applicant is one application. */
const repeats = ref<ImportRepeat[]>([]);

onMounted(() => {
  if (!marketId.value) {
    error.value = 'No market is open. Open a market first, then import into it.';
  }
});

const activeGroups = computed(() => groups.value.filter((g) => !splitStems.value.has(g.stem)));
const groupedColumns = computed(
  () => new Set(activeGroups.value.flatMap((group) => group.columns)),
);

/** The ledger in render order: a grid appears once, at its first column's position. */
const ledgerRows = computed(() => {
  const byFirstColumn = new Map(activeGroups.value.map((g) => [g.columns[0], g]));
  const rows: Array<{ kind: 'group'; group: ColumnGroup } | { kind: 'column'; index: number }> = [];
  headers.value.forEach((_header, index) => {
    const group = byFirstColumn.get(index);
    if (group) {
      rows.push({ kind: 'group', group });
    } else if (!groupedColumns.value.has(index)) {
      rows.push({ kind: 'column', index });
    }
  });
  return rows;
});

const requiredTargets = computed(() => targets.value.filter((t) => t.required));
const mappedKeys = computed(() => {
  const keys = new Set(
    [
      ...Object.entries(columnTarget.value)
        .filter(([index]) => !groupedColumns.value.has(Number(index)))
        .map(([, key]) => key)
        // The ledger's dead-end sentinel is not a target; it must not satisfy a required question.
        .filter((key) => key !== NEEDS_A_FIELD),
      ...activeGroups.value.map((g) => groupTarget.value[g.stem]),
    ].filter(Boolean),
  );
  // A per-date tier grid answers availability too: the days a vendor named tiers for are the days
  // they can come. The server's `unserved_required` says so, and the rail must agree with it, or a
  // real form's grid - the shape every Google Form export has - reads as missing a question.
  if (activeGroups.value.some((g) => groupTarget.value[g.stem] === TIER_PREFERENCE_KEY))
    keys.add(AVAILABLE_DATES_KEY);
  return keys;
});

/** What shape a mapped target is being read from, said plainly so a wrong guess is visible. */
function shapeLabel(group: ColumnGroup): string {
  // A grid mapped to the days is one column per day - a tier grid's options ARE days, and calling
  // them options described the columns as the tiers they hold (bug 40).
  const target = groupTarget.value[group.stem];
  const perDay = target === TIER_PREFERENCE_KEY || target === AVAILABLE_DATES_KEY;
  return `${group.columns.length} columns · one per ${perDay ? 'day' : 'option'}`;
}

function singleShapeLabel(index: number): string {
  const key = columnTarget.value[index];
  return key && MULTI_VALUE_TARGETS.has(key) ? '1 column · values split on commas' : '';
}

/** The unmatched values belonging to whatever target this ledger row is mapped to. */
function unmatchedFor(key: string | undefined): UnmatchedValue[] {
  if (!key) return [];
  return unmatched.value.filter((entry) => entry.target === key);
}

function decidedFor(key: string | undefined): (DecidedValue & { decidedBy?: string })[] {
  if (!key) return [];
  return decided.value
    .filter((entry) => entry.target === key)
    .map((entry) => ({ ...entry, decidedBy: decidedByStart(entry.target, entry.value) }));
}

/**
 * Whose decision a value carries, when it is still the start's (E30/F02/S01): the start sets a
 * rarely given value aside, and the import listed it as "already decided" as though the organizer
 * had. Changed here, it is the organizer's, and says nothing.
 */
function decidedByStart(target: string, value: string): string | undefined {
  if (savedMappingFrom.value !== 'start') return undefined;
  const started = startedResolutions.value[target]?.[value];
  if (started === undefined || resolutionFor(target, value) !== started) return undefined;
  return started === IGNORE_VALUE
    ? 'set aside when your form was started'
    : 'decided when your form was started';
}

/** Was this row's target restored from last time, rather than chosen just now? */
function isRestored(key: string | undefined): boolean {
  return !!key && restoredTargets.value.has(key);
}

/** What a restored column says of where its mapping came from: the start, or the last import. */
const restoredBadge = computed(() =>
  savedMappingFrom.value === 'start'
    ? 'mapped when your form was started'
    : 'restored from last import',
);

/**
 * A value to resolve an unmatched cell to, as a person would say it.
 *
 * Tiers and sections are the organizer's own names and read fine as they are. Dates are not: they
 * are stored as `2026-11-21`, a format shown nowhere else in the product, on the path every CSV
 * market walks. The option's value stays the stored date - that is what the import writes - and
 * only its text changes.
 */
function offeredLabel(target: string, value: string): string {
  // A market day reads as a day wherever it is offered: for availability, and for a tier grid's
  // day headings, which are matched to days rather than tiers (bug 26).
  const day = target === AVAILABLE_DATES_KEY || target === TIER_PREFERENCE_KEY;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(value)) return getFormattedDate(value) ?? value;
  return value;
}

/**
 * Whether one column mapped to this target cannot be split reliably: one of its options is made of
 * others ("Prints, Cards" beside "Prints" and "Cards"). An option with a comma of its own is read
 * whole, so it is not this case (bug 27).
 *
 * A **grid** mapping is silent: its option comes from the column header and nothing is split, and
 * that is the shape a real export of this question has. Only the single-column case is ambiguous.
 */
function cannotSplitReliably(key: string | undefined): boolean {
  return !!key && commaBearingTargets.value.has(key);
}

function labelForTarget(key: string): string {
  return targets.value.find((t) => t.key === key)?.label ?? key;
}

/** Where a target's answer comes from: a whole grid, one column, or nothing yet. */
type TargetSource =
  { kind: 'group'; group: ColumnGroup } | { kind: 'column'; index: number } | { kind: 'none' };

/**
 * Which column, or columns, a target is being read from.
 *
 * One statement of it, because two readers need the answer and they must not disagree: the recap
 * names the source, and the sample rows read cells out of it. The recap used to look only in
 * `columnTarget`, so a target fed by a grid showed nothing at all while every single-column
 * target named its source - a blank reads as "not mapped" at the exact moment the organizer is
 * confirming that rows will be written.
 */
function sourceFor(key: string): TargetSource {
  const group = activeGroups.value.find((g) => groupTarget.value[g.stem] === key);
  if (group) return { kind: 'group', group };
  const index = Object.entries(columnTarget.value).find(([, k]) => k === key)?.[0];
  return index === undefined ? { kind: 'none' } : { kind: 'column', index: Number(index) };
}

/** That source, said the way the ledger said it. */
function sourceLabelFor(key: string): string {
  const source = sourceFor(key);
  if (source.kind === 'group') {
    return `${source.group.stem} (${source.group.columns.length} columns)`;
  }
  return source.kind === 'column' ? (headers.value[source.index] ?? '') : '';
}

/**
 * The first rows that will import, as the applications they will become (bug 40).
 *
 * The server sends them already read through the mapping and the same validators the write runs,
 * and they read as the review card reads an application: what the market marked first, then the
 * rest (E38/F03/S01). Built here from the file's first cells instead, the sample showed a row listed
 * as skipped a few lines above, and read availability as "no answer" when a tier grid had answered
 * it.
 */
const previewSamples = ref<PreviewRow[]>([]);

const sampleApplications = computed(() => previewRows(previewSamples.value));

/**
 * The rows the import's judging will newly reject, with the reason, judged by the dry run as the
 * import's end judges them (E38/F03/S02); a row a rule already rejected for the same reason is
 * not among them. Not among the samples either: those check the mapping, these check the rules.
 */
const previewRejected = ref<PreviewRow[]>([]);

const rejectedApplications = computed(() => previewRows(previewRejected.value));

/** The preview's rows as `ImportRowList` heads and opens them. */
function previewRows(rows: PreviewRow[]): ImportRow[] {
  const held = market.value as Market | null;
  return rows
    .filter((row) => row.formData)
    .map((row) => ({
      row: row.row,
      email: row.email,
      name: applicantName(row.formData),
      reason: row.reason,
      ...reviewAnswers(
        { formData: row.formData ?? {} },
        held?.applicationForm,
        held?.reviewHighlights ?? [],
      ),
    }));
}

function isNewHeader(index: number): boolean {
  return newHeaders.value.includes((headers.value[index] ?? '').trim());
}

function resolutionFor(target: string, value: string): string {
  return resolutions.value[target]?.[value] ?? '';
}

function setResolution(target: string, value: string, choice: string) {
  resolutions.value = {
    ...resolutions.value,
    [target]: { ...(resolutions.value[target] ?? {}), [value]: choice },
  };
}

const unresolvedCount = computed(
  () => unmatched.value.filter((e) => resolutionFor(e.target, e.value) === '').length,
);

function splitGroup(stem: string) {
  const next = new Set(splitStems.value);
  next.add(stem);
  splitStems.value = next;
  delete groupTarget.value[stem];
}
const unservedRequired = computed(() =>
  requiredTargets.value.filter((t) => !mappedKeys.value.has(t.key)),
);
/**
 * Required questions this file cannot answer that the market may simply stop asking (E01/F06).
 *
 * Only preference orderings appear, and that is the whole rule: the solver gives a vendor their
 * best-ranked option still open and never excludes anyone for a ranking, so treating every
 * applicant equally on it changes nothing but the tie-break. The same offer for dates or tiers
 * would let a default invent a commitment the applicant never made.
 */
const declarableUnasked = computed(() =>
  unservedRequired.value.filter((t) => UNASKABLE_ESSENTIAL_KEYS.includes(t.key)),
);

const canPreview = computed(() => unservedRequired.value.length === 0);

/** A row of the ledger: an ordinary column by its position, or a grid by its stem. */
type LedgerRowId = { column: number; stem: null } | { column: null; stem: string };

/** What the ledger calls a column, in its "Maps to" words as in its row. */
function columnName(index: number): string {
  return oneLine(headers.value[index] ?? '') || `column ${index + 1}`;
}

/** Which rows hold each target. */
const holders = computed(() => {
  const held = new Map<string, (LedgerRowId & { name: string })[]>();
  const hold = (key: string, holder: LedgerRowId & { name: string }) => {
    if (key) held.set(key, [...(held.get(key) ?? []), holder]);
  };
  for (const [index, key] of Object.entries(columnTarget.value)) {
    const column = Number(index);
    if (!groupedColumns.value.has(column)) {
      hold(key, { column, stem: null, name: columnName(column) });
    }
  }
  for (const [stem, key] of Object.entries(groupTarget.value)) {
    hold(key, { column: null, stem, name: oneLine(stem) });
  }
  return held;
});

/** What another row calls itself if it holds this target, so this row can say why it may not. */
function takenBy(key: string, row: LedgerRowId): string | undefined {
  return holders.value
    .get(key)
    ?.find((holder) => holder.column !== row.column || holder.stem !== row.stem)?.name;
}

/** The questions every market asks, and when they applied, ahead of this market's own. */
const isEssentialTarget = (target: ImportTarget) =>
  target.kind === 'identity' || target.kind === 'essential' || target.key === SUBMITTED_AT_KEY;
const essentialTargets = computed(() => targets.value.filter(isEssentialTarget));
const ownTargets = computed(() => targets.value.filter((target) => !isEssentialTarget(target)));

/** One row's "Maps to", with what another row holds taken and naming it. */
function mapsTo(row: LedgerRowId): PickerGroup[] {
  const option = (target: ImportTarget): PickerOption => {
    const holder = takenBy(target.key, row);
    return {
      value: target.key,
      label: `${target.label}${target.required ? ' *' : ''}`,
      detail: holder === undefined ? undefined : `Mapped from "${holder}"`,
      disabled: holder !== undefined,
    };
  };
  // The ways out first, so the cap never hides them and an unmapped row's list opens at its head.
  return [
    {
      label: 'Ignore',
      options:
        row.column === null
          ? [{ value: '', label: 'Ignore these columns' }]
          : [
              { value: '', label: 'Ignore this column' },
              { value: NEEDS_A_FIELD, label: 'This column has nowhere to go…' },
            ],
    },
    { label: 'Essential', options: essentialTargets.value.map(option) },
    { label: 'Your questions', options: ownTargets.value.map(option) },
  ];
}

/**
 * How many choices a row's "Maps to" counts: every target and a column's two ways out. A grid has
 * one way out, and counts the same, so a ledger never mixes a select with a field.
 */
const mapsToCount = computed(() => targets.value.length + 2);

/**
 * Take one file, whichever way it arrived.
 *
 * A file picked and a file dragged land here alike; anything that is not a CSV, by its name or by
 * what it holds, is refused here rather than parsed into a wall of nonsense columns, and the
 * upload step stays for another file (`readCsvFile`).
 */
async function acceptFile(file: File) {
  const read = await readCsvFile(file);
  if ('error' in read) {
    error.value = read.error;
    return;
  }
  error.value = '';
  fileName.value = file.name;
  csvContent.value = read.text;
  await inspect();
}

/* ── Fixing the form without leaving the import (E20/F03/S01) ─────────────────────────────────
 *
 * Both of the ledger's dead ends end here, because they are the same shape: a column with nowhere
 * to go needs a custom field, and a question the form never asked needs that question turned off.
 * A first import runs in draft, where the form is writable, so the dialog writes it there and the
 * file and the mapping stay; once anything is imported the form is fixed, and the dead end says so.
 */
const amendOpen = ref(false);
const amendFieldLabel = ref('');
const amendUnasked = ref('');
const amendForm = ref<ApplicationForm | null>(null);
const amendOptions = ref<EssentialFormOptions>(EMPTY_ESSENTIAL_OPTIONS);
/**
 * Whether the form may change from here, by the lock the market read serves: a control that fails
 * when pressed is a broken one, so the wizard says "the questions are fixed, and here is why".
 */
const amendAvailability = computed(() =>
  market.value
    ? {
        available: !market.value.applicationFormLockReason,
        reason: market.value.applicationFormLockReason ?? null,
      }
    : null,
);

/**
 * The page's stays on one market: it moves on when the page goes, and when the router keeps the page
 * for another market's import, as a jump through history does, there and back alike. `marketId` goes
 * on following the address once the page has gone, so it cannot say any of this itself.
 */
let visit = 0;
onBeforeUnmount(() => {
  visit += 1;
});

/** Noted before a request: asked at its answer, whether that answer is still this page's to show. */
function leftSinceNow(): () => boolean {
  const at = visit;
  return () => visit !== at;
}

async function openAmend(options: { fieldLabel?: string; unasked?: string }) {
  amendFieldLabel.value = options.fieldLabel ?? '';
  amendUnasked.value = options.unasked ?? '';
  try {
    const { data } = await api.get(`/markets/${marketId.value}/application-form`);
    amendForm.value = (data?.application_form ?? null) as ApplicationForm | null;
    amendOptions.value = (data?.essential_options ??
      EMPTY_ESSENTIAL_OPTIONS) as EssentialFormOptions;
  } catch (err) {
    error.value = getApiErrorMessage(err, "Could not read this market's application form.");
    return;
  }
  amendOpen.value = true;
}

/**
 * The form changed, so the ledger's targets have, and the file and mapping must not.
 *
 * Re-inspecting is what picks up a new custom field as a target and drops a question that was
 * turned off. It rebuilds the mapping from scratch, so the organizer's own decisions are carried
 * across - without this the story trades a four-step round trip for a two-step one.
 */
async function onAmended() {
  // The form is a write, so the store re-reads the market and every screen showing it follows.
  void refreshMarket();
  const keptColumns = { ...columnTarget.value };
  const keptGroups = { ...groupTarget.value };
  const keptResolutions = { ...resolutions.value };
  const keptStep = step.value;
  const left = leftSinceNow();

  await inspect();
  if (left()) return;

  // By column index and group stem, both of which are properties of the FILE - and the file is
  // the one thing that did not change.
  for (const [index, target] of Object.entries(keptColumns)) {
    if (target) columnTarget.value[Number(index)] = target;
  }
  groupTarget.value = { ...groupTarget.value, ...keptGroups };
  resolutions.value = { ...keptResolutions };
  step.value = keptStep;
  // What the values mean follows the decisions just put back, not the ones inspect restored.
  await readValues(false).catch(() => {});
}

async function inspect() {
  const left = leftSinceNow();
  busy.value = true;
  error.value = '';
  try {
    const { data } = await api.post(`/markets/${marketId.value}/applications/import/inspect`, {
      csvContent: csvContent.value,
    });
    if (left()) return;
    headers.value = data.headers ?? [];
    sampleValues.value = data.sampleValues ?? [];
    rowCount.value = data.rowCount ?? 0;
    targets.value = data.targets ?? [];
    groups.value = data.groups ?? [];
    splitStems.value = new Set();
    columnTarget.value = {};
    unmatched.value = [];
    decided.value = [];
    resolutions.value = {};
    startedResolutions.value = {};
    // Seed every column with '' - the "Ignore this column" option's value. Left undefined, the
    // select matches no option, reports selectedIndex -1 and renders completely blank, so an
    // unmapped column is indistinguishable from one that has not loaded.
    headers.value.forEach((_header, index) => {
      columnTarget.value[index] = '';
    });
    // And every grid with its "Ignore these columns", for the same reason (bug 43): the columns
    // were seeded and the grids were not, so a grid's select read blank until it was chosen.
    groupTarget.value = Object.fromEntries(groups.value.map((group) => [group.stem, '']));
    for (const [key, index] of Object.entries(data.suggestedMapping ?? {})) {
      columnTarget.value[Number(index)] = key;
    }

    // A previous import's decisions win over the auto-detected two: the organizer already said
    // what these columns mean, and re-asking is the friction this remembers them to avoid.
    hasSavedMapping.value = data.hasSavedMapping === true;
    savedMappingFrom.value = data.savedMappingFrom === 'start' ? 'start' : 'import';
    ordersBySubmittedAt.value = data.ordersBySubmittedAt === true;
    commaBearingTargets.value = new Set<string>(data.commaBearingTargets ?? []);
    restoredMissing.value = data.restoredTargetsMissingColumns ?? [];
    newHeaders.value = data.newHeaders ?? [];
    restoredTargets.value = new Set(Object.keys(data.restoredMapping ?? {}));
    const groupByFirstColumn = new Map(
      (groups.value ?? []).map((group) => [group.columns[0], group]),
    );
    for (const [key, indexes] of Object.entries(
      (data.restoredMapping ?? {}) as Record<string, number[]>,
    )) {
      const group = groupByFirstColumn.get(indexes[0]);
      if (group && group.columns.length === indexes.length) {
        groupTarget.value[group.stem] = key;
      } else {
        columnTarget.value[indexes[0]] = key;
      }
    }
    resolutions.value = Object.fromEntries(
      Object.entries(
        (data.restoredResolutions ?? {}) as Record<string, Record<string, string | null>>,
      ).map(([target, byValue]) => [
        target,
        Object.fromEntries(
          Object.entries(byValue).map(([value, choice]) => [value, choice ?? IGNORE_VALUE]),
        ),
      ]),
    );
    startedResolutions.value = resolutions.value;
    step.value = 'map';
    // A restored mapping carries decisions about this file's values: read them now, so they are on
    // the page to be seen and changed before anything is previewed (bug 28).
    if (Object.keys(data.restoredMapping ?? {}).length) await readValues(false);
  } catch (e) {
    if (!left()) error.value = getApiErrorMessage(e, 'That file could not be read.');
  } finally {
    busy.value = false;
  }
}

function currentMapping(): Record<string, number | number[]> {
  const mapping: Record<string, number | number[]> = {};
  for (const [index, key] of Object.entries(columnTarget.value)) {
    if (!key || key === NEEDS_A_FIELD) continue;
    if (!groupedColumns.value.has(Number(index))) mapping[key] = Number(index);
  }
  for (const group of activeGroups.value) {
    const key = groupTarget.value[group.stem];
    if (key) mapping[key] = group.columns;
  }
  return mapping;
}

/** Values the organizer has spoken for, in the shape the back end expects ('' means ignore). */
function currentResolutions(): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const [target, byValue] of Object.entries(resolutions.value)) {
    out[target] = {};
    for (const [value, choice] of Object.entries(byValue)) {
      if (choice !== '') out[target][value] = choice === IGNORE_VALUE ? null : choice;
    }
  }
  return out;
}

/**
 * Ask which cell values name nothing this market offers, before anything is written. Unresolved
 * values keep the organizer on the mapping step, with each one shown in the row that owns it.
 */
async function checkValues() {
  const left = leftSinceNow();
  busy.value = true;
  error.value = '';
  try {
    await readValues(true);
  } catch (e) {
    if (!left()) error.value = getApiErrorMessage(e, 'That file could not be checked.');
  } finally {
    busy.value = false;
  }
}

/** The dry run: what the file's values mean, and - with `advance` - on to the preview. */
async function readValues(advance: boolean) {
  const left = leftSinceNow();
  const { data } = await api.post(`/markets/${marketId.value}/applications/import/preview`, {
    csvContent: csvContent.value,
    mapping: currentMapping(),
    resolutions: currentResolutions(),
  });
  if (left()) return;
  unmatched.value = data.unmatched ?? [];
  decided.value = data.decided ?? [];
  validRows.value = data.validRows ?? 0;
  previewFailures.value = data.failures ?? [];
  newRows.value = data.newRows ?? 0;
  updatedRows.value = data.updatedRows ?? 0;
  unchangedRows.value = data.unchangedRows ?? 0;
  previewSamples.value = data.samples ?? [];
  previewRejected.value = data.rejected ?? [];
  absentApplications.value = data.absentApplications ?? 0;
  absentEmails.value = data.absentEmails ?? [];
  returningToReview.value = data.returningToReview ?? 0;
  returningEmails.value = data.returningEmails ?? [];
  repeats.value = data.repeats ?? [];
  if (advance && unmatched.value.length === 0) step.value = 'preview';
}

/**
 * The confirm: the reviewers first, when the choice differs from the team they start from
 * (`teamToChange`), then the import.
 * A refused reviewers write imports nothing. Once written they stay chosen, so an import that fails
 * after them is tried again without writing them twice.
 * A page left during those writes stops at them: the file was this stay's, and whatever is on
 * screen by the answer is not.
 */
async function confirmImport() {
  if (offersReviewers.value) {
    const pressedOn = marketId.value;
    const left = leftSinceNow();
    busy.value = true;
    reviewersError.value = '';
    try {
      // A write left by a page history took: nothing imports before its answer, and a refusal shows here.
      await unansweredWrite(pressedOn)?.answer;
      if (!left() && !sameTeam(reviewers.value, teamToChange(market.value))) {
        await chooseReviewers(pressedOn, reviewers.value);
        await refreshMarket();
      }
    } catch (err) {
      if (!left()) {
        reviewersError.value = getApiErrorMessage(err, 'Could not save the reviewers.');
      }
      busy.value = false;
      return;
    }
    if (left()) {
      busy.value = false;
      return;
    }
  }
  await runImport();
}

async function runImport() {
  const left = leftSinceNow();
  busy.value = true;
  error.value = '';
  reviewersError.value = '';
  try {
    const { data } = await api.post(`/markets/${marketId.value}/applications/import`, {
      csvContent: csvContent.value,
      mapping: currentMapping(),
      resolutions: currentResolutions(),
    });
    // Applications now exist, which locks the form: part of the market every screen reads.
    void refreshMarket();
    if (left()) return;
    created.value = data.created ?? 0;
    updated.value = data.updated ?? 0;
    unchanged.value = data.unchanged ?? 0;
    rejectedByRules.value = data.rejectedByRules ?? 0;
    failures.value = data.failures ?? [];
    repeats.value = data.repeats ?? [];
    enteredReview.value = firstImport.value && data.phase === MarketPhase.Applications;
    step.value = 'done';
  } catch (e) {
    if (!left()) error.value = getApiErrorMessage(e, 'The import could not be completed.');
  } finally {
    busy.value = false;
  }
}

/** Sample cells for a column, with empties named rather than rendered as bare separators. */
function samplesFor(index: number): string {
  const values = (sampleValues.value[index] ?? []).filter((value) => value.trim() !== '');
  return values.length ? values.join(' · ') : 'no values in the first rows';
}

function startOver() {
  step.value = 'upload';
  fileName.value = '';
  csvContent.value = '';
  headers.value = [];
  failures.value = [];
  error.value = '';
  reviewersError.value = '';
}
// A jump through history from one market's import to another's keeps this page, not its file, and
// at once, so that no answer can land between the jump and a later flush.
watch(
  marketId,
  () => {
    visit += 1;
    startOver();
  },
  { flush: 'sync' },
);
</script>

<template>
  <!-- A flow entered from Applications, standing in the frame like every market page: the bar with
       that tab active (E22/F04/S02), and the rail (bug 12). -->
  <MarketFrame :market="market">
    <div class="import-view" data-testid="import-view">
      <header class="import-header">
        <div>
          <h1>{{ firstImport ? 'Import responses' : 'Redo import' }}</h1>
          <p v-if="fileName" class="import-subtitle" data-testid="import-filename">
            {{ fileName }}
          </p>
        </div>
        <ol class="import-steps">
          <li :class="{ current: step === 'upload' }">1 Upload</li>
          <li :class="{ current: step === 'map' }">2 Map columns</li>
          <li :class="{ current: step === 'preview' }">3 Preview</li>
          <li :class="{ current: step === 'done' }">4 Confirm</li>
        </ol>
      </header>

      <p v-if="error" class="import-error" data-testid="import-error">{{ error }}</p>

      <!-- Not taking applications: say so instead of offering a file picker. -->
      <section
        v-if="step === 'upload' && marketId && !takingApplications"
        class="import-panel"
        data-testid="import-wrong-phase"
      >
        <h2>
          {{
            roleRefusal
              ? 'Importing into this market is not yours to do'
              : takesNoImport(market)
                ? "Vendors apply on this market's page"
                : firstImport
                  ? 'This market is not ready for its first import'
                  : 'This market is not taking applications right now'
          }}
        </h2>
        <BlockerPanel
          v-if="market && firstImportWaitsOn.length"
          :blockers="firstImportWaitsOn"
          :market="market"
          heading="Before its first import, this market needs:"
        />
        <p v-else class="import-help">{{ phaseRefusal }}</p>
        <button type="button" class="button-secondary import-refusal-back" @click="leaveImport">
          Back to the market
        </button>
      </section>

      <!-- 1. Upload -->
      <section
        v-if="step === 'upload' && takingApplications"
        class="import-panel"
        data-testid="import-upload"
      >
        <h2>Choose the CSV your form produced</h2>
        <!-- Which market this writes into. The organizer reached this page from one market's
           Applications tab, but the page itself said nothing about which, and an import is
           232 applications landing somewhere. -->
        <p v-if="market" class="import-help" data-testid="import-target-market">
          Importing into <strong>{{ market.name }}</strong
          >. Nothing is written until you confirm.
        </p>
        <!-- What this import does to the market, which differs by where it stands (E38/F04). -->
        <p class="import-help" data-testid="import-what-it-does">
          {{
            firstImport
              ? 'Bring every response your Google Form collected. Once the import is written, the market enters Review.'
              : 'Bring your whole responses file again, the earlier responses with the new: new rows are added, changed rows are updated and the rest stay as they are. The market stays in Review.'
          }}
        </p>
        <FileDropZone
          accept=".csv,text/csv"
          label="Drop your CSV here, or choose a file"
          hint="Any form tool or spreadsheet that exports CSV will do. Every column comes across; you decide which ones mean something on the next step."
          :busy="busy"
          testid="import-drop-zone"
          input-testid="import-file-input"
          @file="acceptFile"
        />
      </section>

      <!-- 2. Map columns -->
      <section v-if="step === 'map'" class="import-map" data-testid="import-map">
        <div class="import-ledger">
          <div v-if="hasSavedMapping" class="import-restored" data-testid="import-restored-banner">
            <strong v-if="savedMappingFrom === 'start'">
              Mapped when your form was started from this file.
            </strong>
            <strong v-else>Restored from your last import.</strong>
            <span v-if="restoredMissing.length" data-testid="import-restored-missing">
              <template v-for="(entry, position) in restoredMissing" :key="entry.target">
                {{ position ? '; ' : '' }}{{ labelForTarget(entry.target) }} lost
                {{ entry.missingHeaders.join(', ') }}
              </template>
              - map {{ restoredMissing.length === 1 ? 'it' : 'them' }} again.
            </span>
            <span v-if="newHeaders.length" data-testid="import-restored-new">
              {{ newHeaders.length }} column{{ newHeaders.length === 1 ? ' is' : 's are' }} new
              since then.
            </span>
          </div>
          <h2 data-testid="import-column-count">
            {{ headers.length }} column{{ headers.length === 1 ? '' : 's' }} in this file
          </h2>
          <p class="import-help">
            Every column, in file order. Leave a column unmapped to ignore it.
          </p>
          <table class="ledger-table">
            <thead>
              <tr>
                <th>CSV column</th>
                <th>First rows</th>
                <th>Maps to</th>
              </tr>
            </thead>
            <tbody>
              <template
                v-for="row in ledgerRows"
                :key="row.kind === 'group' ? row.group.stem : row.index"
              >
                <!-- A grid: one question spread across several columns, mapped once. -->
                <template v-if="row.kind === 'group'">
                  <tr class="ledger-group-row" data-testid="import-group-row">
                    <td class="ledger-header">
                      <span class="ledger-header-text" :title="oneLine(row.group.stem)">{{
                        oneLine(row.group.stem)
                      }}</span>
                      <span
                        v-if="isRestored(groupTarget[row.group.stem])"
                        class="ledger-badge"
                        data-testid="import-restored-badge"
                      >
                        {{ restoredBadge }}
                      </span>
                      <span class="ledger-shape" data-testid="import-group-shape">
                        {{ shapeLabel(row.group) }}
                      </span>
                    </td>
                    <td class="ledger-samples">
                      <button
                        class="ledger-split"
                        :data-testid="`import-split-group-${row.group.columns[0]}`"
                        @click="splitGroup(row.group.stem)"
                      >
                        Not one question - split
                      </button>
                    </td>
                    <td>
                      <ChoiceField
                        class="ledger-select"
                        :model-value="groupTarget[row.group.stem] ?? ''"
                        :groups="mapsTo({ column: null, stem: row.group.stem })"
                        :whole-count="mapsToCount"
                        :label="`What ${oneLine(row.group.stem)} maps to`"
                        :name="`import-group-target-${row.group.columns[0]}`"
                        :testid="`import-group-select-${row.group.columns[0]}`"
                        hide-label
                        writes
                        @update:model-value="groupTarget[row.group.stem] = $event"
                      />

                      <!-- Values the market does not recognise, fixed in the row that owns them. -->
                      <ValueFixes
                        v-if="unmatchedFor(groupTarget[row.group.stem]).length"
                        :entries="unmatchedFor(groupTarget[row.group.stem])"
                        :resolution-for="resolutionFor"
                        :label-for="offeredLabel"
                        @resolve="setResolution"
                      />
                      <ValueFixes
                        v-if="decidedFor(groupTarget[row.group.stem]).length"
                        :entries="decidedFor(groupTarget[row.group.stem])"
                        :resolution-for="resolutionFor"
                        :label-for="offeredLabel"
                        decided
                        testid="import-decided"
                        @resolve="setResolution"
                      />
                    </td>
                  </tr>
                  <tr
                    v-for="(option, position) in row.group.options"
                    :key="`${row.group.stem}-${option}`"
                    class="ledger-member-row"
                    data-testid="import-group-member"
                  >
                    <td class="ledger-member">↳ {{ option }}</td>
                    <td
                      class="ledger-samples"
                      :class="{
                        empty: samplesFor(row.group.columns[position]).startsWith('no values'),
                      }"
                    >
                      {{ samplesFor(row.group.columns[position]) }}
                    </td>
                    <td class="ledger-member-note">part of the question above</td>
                  </tr>
                </template>

                <!-- An ordinary column. -->
                <tr v-else data-testid="import-column-row">
                  <td class="ledger-header">
                    <!-- Two lines at most, as the proposal shows the same headings (bug 43): one
                         export's terms-and-conditions question ran to twenty. -->
                    <span class="ledger-header-text" :title="oneLine(headers[row.index] ?? '')">{{
                      oneLine(headers[row.index] ?? '') || `(column ${row.index + 1})`
                    }}</span>
                    <span
                      v-if="isRestored(columnTarget[row.index])"
                      class="ledger-badge"
                      data-testid="import-restored-badge"
                    >
                      {{ restoredBadge }}
                    </span>
                    <span
                      v-else-if="isNewHeader(row.index)"
                      class="ledger-badge new"
                      data-testid="import-new-badge"
                    >
                      new since last import
                    </span>
                    <span
                      v-if="singleShapeLabel(row.index)"
                      class="ledger-shape"
                      data-testid="import-column-shape"
                    >
                      {{ singleShapeLabel(row.index) }}
                    </span>
                  </td>
                  <td
                    class="ledger-samples"
                    :class="{ empty: samplesFor(row.index).startsWith('no values') }"
                  >
                    {{ samplesFor(row.index) }}
                  </td>
                  <td>
                    <ChoiceField
                      class="ledger-select"
                      :model-value="columnTarget[row.index] ?? ''"
                      :groups="mapsTo({ column: row.index, stem: null })"
                      :whole-count="mapsToCount"
                      :label="`What ${columnName(row.index)} maps to`"
                      :name="`import-target-${row.index}`"
                      :testid="`import-target-select-${row.index}`"
                      hide-label
                      writes
                      @update:model-value="columnTarget[row.index] = $event"
                    />

                    <!--
                    WAS the dead end (E03/F04), and is now a way through (E20/F03/S01) while the
                    market is a draft: the dialog writes the form through
                    PUT /markets/<id>/application-form like everything else - which is what keeps
                    the D9 lock unbypassable.
                  -->
                    <div
                      v-if="columnTarget[row.index] === NEEDS_A_FIELD"
                      class="ledger-deadend"
                      data-testid="import-needs-a-field"
                    >
                      <p>
                        Nothing here answers this column. To keep it, this market has to ask for it.
                      </p>
                      <button
                        v-if="amendAvailability?.available"
                        type="button"
                        class="btn btn--compact btn--primary"
                        data-testid="import-add-a-field-button"
                        @click="openAmend({ fieldLabel: headers[row.index] })"
                      >
                        Add a question for it
                      </button>
                      <p v-else-if="amendAvailability" class="ledger-deadend-why">
                        {{ amendAvailability.reason }}
                      </p>
                    </div>

                    <!-- Warn, do not block: the reconciliation screen below already refuses to
                       advance until every unmatched value is spoken for, so nothing wrong imports
                       silently either way, and blocking would strand an organizer whose only copy
                       of the data is this file. -->
                    <p
                      v-if="cannotSplitReliably(columnTarget[row.index])"
                      class="ledger-deadend"
                      data-testid="import-cannot-split"
                    >
                      One column cannot answer
                      <strong>{{ labelForTarget(columnTarget[row.index]) }}</strong> reliably: one
                      of its options is other options joined by commas, and this column separates
                      answers with commas too, so there is no way to tell one answer from two.
                      Re-export this question as a grid, one column per option, or rename that
                      option.
                    </p>

                    <!-- Values the market does not recognise, fixed in the row that owns them. -->
                    <ValueFixes
                      v-if="unmatchedFor(columnTarget[row.index]).length"
                      :entries="unmatchedFor(columnTarget[row.index])"
                      :resolution-for="resolutionFor"
                      :label-for="offeredLabel"
                      @resolve="setResolution"
                    />
                    <!-- And the values a decision already settles, so a wrong one can be put right. -->
                    <ValueFixes
                      v-if="decidedFor(columnTarget[row.index]).length"
                      :entries="decidedFor(columnTarget[row.index])"
                      :resolution-for="resolutionFor"
                      :label-for="offeredLabel"
                      decided
                      testid="import-decided"
                      @resolve="setResolution"
                    />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <aside class="import-rail">
          <h3>Required questions</h3>
          <ul class="rail-list">
            <li
              v-for="target in requiredTargets"
              :key="target.key"
              :class="{ served: mappedKeys.has(target.key) }"
              data-testid="import-required-target"
            >
              <span class="rail-tick">{{ mappedKeys.has(target.key) ? '✓' : '○' }}</span>
              {{ target.label }}
            </li>
          </ul>
          <p v-if="canPreview" class="rail-ok" data-testid="import-all-mapped">
            All required questions are mapped.
          </p>
          <!-- Mapping no timestamp is legal - a market with no time-based priority does not need one.
             But this market has a rule that orders by when the application arrived, and with
             nothing feeding it that rule decides nothing. Saying so here is the point: it used to
             fail silently. -->
          <p
            v-if="ordersBySubmittedAt && !mappedKeys.has(SUBMITTED_AT_KEY)"
            class="rail-warning"
            data-testid="import-no-submitted-at-warning"
          >
            This market orders vendors by when they applied, but no column is mapped to “Submitted
            at”. That rule will order nothing.
          </p>
          <p v-if="unresolvedCount" class="rail-warning" data-testid="import-unresolved-warning">
            {{
              unresolvedCount === 1 ? '1 value still needs' : `${unresolvedCount} values still need`
            }}
            a match.
          </p>
          <!-- Only when something actually is unmapped. This was `v-else` on the unresolved-values
             warning above, so a fully mapped file showed a red "Still unmapped:" with an empty list
             directly under the green "All required questions are mapped." -->
          <p
            v-else-if="unservedRequired.length"
            class="rail-warning"
            data-testid="import-unmapped-warning"
          >
            Still unmapped: {{ unservedRequired.map((t) => t.label).join(', ') }}
          </p>

          <!-- Turning a question off is a change to the FORM, and a form is editable only in draft
             (D9): offered on a first import, and once anything is imported the lock says why not.
             Same shape as the unmapped-column dead end in the ledger. -->
          <div
            v-for="target in declarableUnasked"
            :key="target.key"
            class="rail-unasked"
            data-testid="import-declare-unasked"
          >
            <p>
              No column in this file answers <strong>{{ target.label }}</strong
              >. It is a preference, not a constraint, so this market can stop asking it and treat
              every applicant equally.
            </p>
            <button
              v-if="amendAvailability?.available"
              type="button"
              class="btn btn--compact btn--primary"
              :data-testid="`import-stop-asking-${target.key}`"
              @click="openAmend({ unasked: target.key })"
            >
              Stop asking it
            </button>
            <p v-else-if="amendAvailability" class="rail-unasked-how">
              {{ amendAvailability.reason }}
            </p>
          </div>
        </aside>
      </section>

      <!-- 3. Preview -->
      <section v-if="step === 'preview'" class="import-panel" data-testid="import-preview">
        <h2 data-testid="import-preview-counts">{{ previewHeadline }}</h2>
        <p class="import-help" data-testid="import-preview-merge">
          <template v-if="updatedRows || unchangedRows"
            >{{ newRows }} new, {{ updatedRows }} updated<template v-if="unchangedRows"
              >, {{ unchangedRows }} unchanged</template
            >. </template
          >Each imported row becomes an application awaiting your review<template
            v-if="previewRejected.length"
            >, except the {{ previewRejected.length }} listed below, which
            {{ previewRejected.length === 1 ? 'arrives' : 'arrive' }} already rejected</template
          >. Nothing has been written yet.
        </p>

        <!-- An approval the import would invalidate. Said before it happens, because silently
           un-approving someone the organizer already decided on is not acceptable either way. -->
        <p v-if="returningToReview" class="import-note warn" data-testid="import-returning-note">
          {{ returningToReview }} approved application{{ returningToReview === 1 ? '' : 's' }} will
          return to review because
          {{ returningToReview === 1 ? 'its answers have' : 'their answers have' }} changed<span
            v-if="returningEmails.length"
          >
            ({{ returningEmails.join(', ') }})</span
          >.
        </p>

        <!-- A vendor who applied twice is one application, not two rows judged in turn (bug 34). -->
        <div v-if="repeats.length" class="import-note" data-testid="import-repeat-note">
          <p>
            {{ repeats.length }} earlier submission{{ repeats.length === 1 ? '' : 's' }} will be
            replaced by the same applicant's later row. Each applicant is imported once, from their
            latest row, keeping the time they first applied.
          </p>
          <ListFrame
            class="import-note-list"
            :items="repeats"
            :finds="findsReplacedRow"
            :item-key="(repeat) => String(repeat.row)"
            :noun="{ one: 'submission', many: 'submissions' }"
            :page-size="IMPORT_LIST_FIRST"
            show-all
            find-label="Find by address or row"
            testid="import-repeats-list"
          >
            <template #rows="{ rows }">
              <ul>
                <li v-for="repeat in rows" :key="repeat.row" data-list-row tabindex="-1">
                  Row {{ repeat.row }} ({{ repeat.email }}) is replaced by row
                  {{ repeat.latestRow }}
                </li>
              </ul>
            </template>
          </ListFrame>
        </div>

        <!-- Already here, not in this file. Left alone: absence is almost always a filtered export,
           not a withdrawal, and guessing otherwise would destroy review state on a guess. -->
        <p v-if="absentApplications" class="import-note" data-testid="import-absent-note">
          {{ absentApplications }} existing application{{ absentApplications === 1 ? '' : 's' }}
          {{ absentApplications === 1 ? 'is' : 'are' }} not in this file<span
            v-if="absentEmails.length"
          >
            ({{ absentEmails.join(', ') }})</span
          >. They will be left exactly as they are.
        </p>

        <!-- Everything that would be skipped, before it is skipped. -->
        <div
          v-if="previewFailures.length"
          class="import-failures"
          data-testid="import-preview-failures"
        >
          <h3>
            {{ previewFailures.length }} row{{ previewFailures.length === 1 ? '' : 's' }} will be
            skipped
          </h3>
          <p class="import-help">
            These will not be imported. Import the rest, or fix them first: in your spreadsheet, or
            with Back, for an answer that was left out or ignored.
          </p>
          <ImportRefusedRows
            :rows="previewFailures"
            testid="import-preview-failures-list"
            row-testid="import-preview-failure-row"
          />
        </div>
        <!-- The organizer's own data, read through the mapping they just chose. Without a cell of
           it on screen, "Preview" only restates the previous step. -->
        <section v-if="sampleApplications.length" class="preview-rows" data-testid="import-samples">
          <h3>
            The first
            {{ sampleApplications.length === 1 ? 'row' : sampleApplications.length + ' rows' }}, as
            {{ sampleApplications.length === 1 ? 'it' : 'they' }} will be imported
          </h3>
          <p class="preview-rows-why">A check that each answer lands in the right question.</p>
          <ImportRowList :rows="sampleApplications" open-first row-testid="import-sample-row" />
        </section>

        <!-- The rows the import's judging will newly reject, in the samples' format: a check of the
           rules, before they reject anyone (E38/F03/S02). -->
        <section
          v-if="rejectedApplications.length"
          class="preview-rows"
          data-testid="import-rejected"
        >
          <h3>
            Rejected by your automatic rejections
            <span class="chip chip--destructive" data-testid="import-rejected-count">{{
              rejectedApplications.length
            }}</span>
          </h3>
          <p class="preview-rows-why" data-testid="import-rejected-why">
            {{ rejectedRowsWhy(overturnedBy) }}
          </p>
          <ListFrame
            :items="rejectedApplications"
            :finds="findsRejectedRow"
            :item-key="(row) => String(row.row)"
            :noun="{ one: 'row', many: 'rows' }"
            :page-size="IMPORT_LIST_FIRST"
            show-all
            find-label="Find by name or address"
            testid="import-rejected-list"
          >
            <template #rows="{ rows }">
              <ImportRowList :rows="rows" row-testid="import-rejected-row" />
            </template>
          </ListFrame>
        </section>

        <h3 class="preview-mapping-heading">Where each answer comes from</h3>
        <ul class="preview-mapping">
          <li v-for="target in targets" :key="target.key" v-show="mappedKeys.has(target.key)">
            <strong>{{ target.label }}</strong>
            <span data-testid="import-preview-source">{{ sourceLabelFor(target.key) }}</span>
          </li>
        </ul>

        <!-- Last, so it sits right above the confirm that writes it. -->
        <section
          v-if="offersReviewers"
          class="preview-reviewers"
          aria-label="Reviewers"
          data-testid="import-reviewers"
        >
          <ReviewerPicker
            v-model="reviewers"
            :candidates="market?.reviewerCandidates ?? []"
            :current="reviewerAddresses(market)"
            :disabled="busy"
          />
          <p
            v-if="reviewersError"
            class="import-error"
            role="alert"
            data-testid="import-reviewers-error"
          >
            {{ reviewersError }}
          </p>
        </section>
      </section>

      <!-- 4. Done -->
      <section v-if="step === 'done'" class="import-panel" data-testid="import-done">
        <h2 data-testid="import-result-summary">
          Imported {{ created }} new application{{ created === 1 ? '' : 's'
          }}<span v-if="updated">, updated {{ updated }}</span
          >.{{ unchanged ? ` ${unchanged} unchanged.` : '' }}
        </h2>
        <p v-if="enteredReview" class="import-note" data-testid="import-result-in-review">
          This market is now in Review: decide every application, then begin assignment.
        </p>
        <p v-if="rejectedByRules" class="import-note" data-testid="import-result-rejected-note">
          {{ rejectedByRules }} {{ rejectedByRules === 1 ? 'was' : 'were' }} rejected by your
          automatic rejections, each with its reason<template v-if="overturnedBy"
            >; {{ overturnedBy }} can overturn any of them</template
          >.
        </p>
        <p v-if="repeats.length" class="import-note" data-testid="import-result-repeat-note">
          {{ repeats.length }} earlier submission{{ repeats.length === 1 ? ' was' : 's were' }}
          replaced by the same applicant's later row.
        </p>
        <div v-if="failures.length" class="import-failures" data-testid="import-failures">
          <h3>{{ failures.length }} row{{ failures.length === 1 ? '' : 's' }} skipped</h3>
          <p class="import-help">
            These were not imported. Fix them and import again: in your spreadsheet, or, for an
            answer that was left out or ignored, when you map the columns.
          </p>
          <ImportRefusedRows
            :rows="failures"
            testid="import-failures-list"
            row-testid="import-failure-row"
          />
        </div>
      </section>

      <footer class="import-actions">
        <!-- The way out. Upload, Map columns, Preview and the value reconciliation had none at all -
           no Cancel, no breadcrumb - so an organizer who opened this by mistake, or hit a file the
           product could not read, had the browser's back button and nothing else. Nothing is
           written until the final confirm, so leaving costs only the mapping. -->
        <button
          v-if="step !== 'done'"
          class="button-secondary"
          data-testid="import-leave-button"
          @click="leaveImport"
        >
          Cancel import
        </button>
        <button
          v-if="step !== 'upload' && step !== 'done'"
          class="button-secondary"
          data-testid="import-back-button"
          @click="step === 'map' ? startOver() : (step = step === 'preview' ? 'map' : 'preview')"
        >
          Back
        </button>
        <button
          v-if="step === 'map'"
          class="button-primary"
          :disabled="!canPreview || busy || unresolvedCount > 0"
          data-testid="import-preview-button"
          @click="checkValues"
        >
          {{ unmatched.length ? 'Re-check values' : 'Preview import' }}
        </button>
        <button
          v-if="step === 'preview'"
          class="button-primary"
          :disabled="busy || validRows === 0"
          data-testid="import-confirm-button"
          @click="confirmImport"
        >
          <!-- Still offered with nothing to write: the import saves the mapping, and judges. -->
          <template v-if="writingRows"
            >Import {{ writingRows }} row{{ writingRows === 1 ? '' : 's' }}</template
          >
          <template v-else>Import nothing new</template>
        </button>
        <!-- Once imported, the one next step is the review itself (E38/F04/S01). -->
        <button
          v-if="step === 'done'"
          class="button-primary"
          data-testid="import-finish-button"
          @click="leaveImport()"
        >
          {{
            marketPhase === MarketPhase.Applications ? 'Go to the review' : 'Back to applications'
          }}
        </button>
      </footer>

      <AmendFormDialog
        :open="amendOpen"
        :market-id="marketId"
        :application-form="amendForm"
        :essential-options="amendOptions"
        :suggested-field-label="amendFieldLabel"
        :suggested-unasked="amendUnasked"
        @close="amendOpen = false"
        @amended="onAmended()"
      />
    </div>
  </MarketFrame>
</template>

<style scoped>
/*
 * The frame's width, and the PAGE scrolls (E20/F02/S01; in the frame since E26/F10/S01).
 *
 * This view never joined that model: it was uncapped, so at 1920 its 720px panel sat pinned to the
 * left of a full-bleed header with 1,200px of nothing beside it, and Cancel was the width of the
 * screen away from the thing it cancelled. That white space was the whole of the finding - it was
 * never a disagreement with the flow being a page.
 *
 * ONE shell width for all four steps, deliberately. Three of them are narrow panels and the
 * mapping step is a full-width ledger with a rail, so no single CONTENT width is right - but a
 * shell that changed width as the organizer pressed Next would read as instability, and the step
 * indicator already says where they are.
 *
 * Its sides stand on the frame's `--space-6`, the rail's inset, as every page in the card does.
 */
.import-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6) var(--space-6) calc(var(--space-12) + var(--space-12));
  color: var(--mm-black);
}

.import-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: var(--space-4);
}

.import-header h1 {
  margin: 0;
  font-size: var(--text-xl);
}

.import-subtitle {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.import-steps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.import-steps .current {
  color: var(--mm-black);
  font-weight: 600;
}

.import-error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  color: var(--mm-red);
  font-size: var(--text-sm);
}

/* The narrow steps sit in the middle of the shell rather than against its left edge. The mapping
   step is not one of these - it is `.import-map`, and it keeps the whole width. */
.import-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
}

.import-panel h2 {
  margin: 0;
  font-size: var(--text-lg);
}

/* The way back keeps its own width, as the start's refusal's does, rather than a 720px bar. */
.import-refusal-back {
  align-self: flex-start;
}

.import-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.import-map {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 280px);
  gap: var(--space-6);
  align-items: start;
}

.import-ledger h2 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: var(--space-3);
  font-size: var(--text-sm);
}

.ledger-table th {
  text-align: left;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-text-muted);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--mm-border);
}

.ledger-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--mm-border);
  vertical-align: middle;
}

.ledger-header {
  font-weight: 600;
  max-width: 260px;
}

/* Its own weight: the reset gives every element 400, so the cell's 600 does not reach it. */
.ledger-header-text {
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ledger-samples.empty {
  font-style: italic;
  color: var(--mm-text-muted);
}

.ledger-samples {
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ledger-group-row {
  background: rgba(54, 130, 111, 0.16);
}

.ledger-shape {
  display: block;
  margin-top: var(--space-hairline);
  font-weight: 400;
  font-size: var(--text-xs);
  /* It reads on a grid row's tint, where `--mm-green` is 3.75. */
  color: var(--mm-text-green);
}

.ledger-member td {
  border-bottom: none;
}

.ledger-member {
  padding-left: var(--space-6) !important;
  color: var(--mm-text-muted);
}

.ledger-member-note {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.import-restored {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(54, 130, 111, 0.16);
  border-radius: var(--radius-control);
  background: rgba(54, 130, 111, 0.16);
  font-size: var(--text-xs);
}

.ledger-badge {
  display: inline-block;
  margin-left: var(--space-2);
  padding: var(--space-hairline) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--mm-chip-positive);
  color: var(--mm-text-green);
  font-size: var(--text-xs);
  font-weight: 400;
}

/* On a grid row's own tint the chip's ground would vanish. */
.ledger-group-row .ledger-badge {
  background: white;
}

.ledger-badge.new {
  background: var(--mm-chip-attention);
  color: var(--mm-text-yellow-on-tint);
}

.ledger-split {
  --focus-border-offset: var(--focus-border-width);
  border: none;
  background: none;
  padding: 0;
  font-size: var(--text-xs);
  /* It reads on a grid row's tint, where `--mm-text-muted` is 4.26. */
  color: var(--mm-text-muted-on-beige);
  text-decoration: underline;
  cursor: pointer;
}

.ledger-deadend {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--mm-yellow);
  background: rgba(228, 166, 41, 0.18);
  font-size: var(--text-xs);
  max-width: 42ch;
}

.ledger-deadend p {
  margin: 0;
}

.ledger-select {
  max-width: 260px;
}

/* Who holds a target, by a heading that can run to twenty lines: two, as its own row reads it. */
.ledger-select :deep(.search-picker-option-detail) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.import-rail {
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  padding: var(--space-4);
  background: var(--mm-beige);
}

.import-rail h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
}

.rail-list {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

/* The rail is beige: both inks are its own, as the plain muted and green fall below AA there. */
.rail-tick {
  display: inline-block;
  width: 16px;
  color: var(--mm-text-muted-on-beige);
}

.rail-list .served .rail-tick {
  color: var(--mm-text-green);
}

.rail-ok {
  margin: 0;
  font-size: var(--text-xs);
  /* The rail is beige, where `--mm-green` is 3.68. */
  color: var(--mm-text-green);
}

.rail-unasked {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--mm-green);
  background: rgba(54, 130, 111, 0.16);
  font-size: var(--text-xs);
}

.rail-unasked p {
  margin: 0 0 var(--space-1);
}

.rail-unasked p:last-child {
  margin-bottom: 0;
}

.ledger-deadend-why {
  margin: 0;
}

.rail-unasked-how {
  color: rgba(39, 35, 35, 0.66);
}

.rail-warning {
  margin: 0;
  font-size: var(--text-xs);
  /* The rail is beige, where `--mm-red` is 4.37. */
  color: var(--mm-text-red-on-tint);
}

.preview-rows {
  margin-top: var(--space-6);
}

.preview-rows h3,
.preview-mapping-heading {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  margin: 0 0 var(--space-2);
}

/* `pretty`: a two-line line here left one word alone on its second line at the design width. */
.preview-rows-why {
  margin: calc(-1 * var(--space-1)) 0 var(--space-3);
  text-wrap: pretty;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.preview-mapping-heading {
  margin-top: var(--space-6);
}

/* Set apart from the mapping above it as the samples are, and sitting right above the confirm. The
   picker's legend is this section's heading, so it reads as the preview's other headings do. */
.preview-reviewers {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-6);
}

.preview-reviewers :deep(legend) {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.preview-mapping {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.preview-mapping li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.preview-mapping span {
  color: var(--mm-text-muted);
}

.import-note.warn {
  border-color: var(--mm-yellow);
  background: rgba(228, 166, 41, 0.18);
  color: var(--mm-text-yellow);
}

.import-note {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-size: var(--text-xs);
  /* On beige, for what stands in the note too: a list's field label and count line. */
  --mm-text-muted: var(--mm-text-muted-on-beige);
  color: var(--mm-text-muted);
}

.import-note p {
  margin: 0;
}

.import-note-list {
  margin-top: var(--space-1);
}

.import-note ul {
  margin: 0;
  padding-left: var(--space-4);
}

.import-failures {
  margin-top: var(--space-2);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  padding: var(--space-3) var(--space-4);
}

.import-failures h3 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-sm);
  color: var(--mm-red);
}

.import-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  border-top: 1px solid var(--mm-border);
  padding-top: var(--space-4);
}

.button-primary,
.button-secondary {
  height: 38px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid var(--mm-border);
  background: white;
}

.button-primary {
  --focus-border: var(--focus-border-on-fill);
  background: var(--mm-green);
  border-color: var(--mm-green);
  color: white;
}

.button-primary:disabled {
  /* The primitives' one disabled state (`.btn:disabled`): readable, never dimmed by opacity. */
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  border-color: var(--mm-border);
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .import-map {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
