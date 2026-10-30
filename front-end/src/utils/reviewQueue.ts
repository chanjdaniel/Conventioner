import {
  ApplicationStatus,
  type Application,
  type ApplicationForm,
} from '@/assets/types/datatypes';
import { applicationAnswerRows, type AnswerRow } from '@/utils/essentialFields';

/**
 * Everything an application says, as a reviewer reads it.
 *
 * This exists because the review queue showed an email address, a status pill and two buttons -
 * so an organizer was asked to accept or refuse 232 people with nothing to decide on (E08/F04).
 * Triage answers that by showing the whole application, one at a time.
 *
 * The answers the market MARKED come first (E19/F03/S01).
 *
 * This used to put the organizer's own questions first and the essential answers after, reasoning
 * that custom questions "are what distinguish applicants from each other". That was a heuristic
 * standing in for exactly this mark, and it was wrong in both directions: a custom "how did you
 * hear about us?" is noise on a triage card, and an essential availability answer can be the whole
 * decision. Now the market says which, and within each group the previous order is unchanged - so
 * nothing else moves at the same time.
 *
 * The rendering itself belongs to the contract being rendered, so it lives in `essentialFields.ts`
 * and the applicant's own dashboard reads the same answers back.
 */
export function reviewAnswers(
  application: Application,
  form?: ApplicationForm | null,
  highlights: string[] = [],
): { leading: AnswerRow[]; rest: AnswerRow[] } {
  const { essential, custom } = applicationAnswerRows(
    (application.formData ?? {}) as Record<string, unknown>,
    form?.fields ?? [],
  );
  const all = [...custom, ...essential];
  if (!highlights.length) return { leading: [], rest: all };

  const marked = new Set(highlights);
  return {
    // In the order the market marked them: that order is what a reviewer reads down.
    leading: highlights.flatMap((key) => all.filter((row) => row.key === key)),
    rest: all.filter((row) => !marked.has(row.key)),
  };
}

/**
 * Whether this market's form asks anything that tells one applicant from another.
 *
 * When it does not, every triage card is identical and the only rational act is pressing Approve
 * over and over. Saying so beats letting the reviewer discover it at card forty. The form freezes
 * when a market leaves draft, so the fix - reopening for editing and adding a question - is a thing
 * the organizer can still do while nobody has applied (E03/F04).
 *
 * This is NOT the "does this market have a form?" question: a market whose form asks only the
 * essential questions has a form, and a valid one. See `asked_essential_keys()` in
 * `back-end/essential_fields.py` for that one.
 */
export function asksNothingDistinguishing(form?: ApplicationForm | null): boolean {
  return (form?.fields ?? []).length === 0;
}

/**
 * Applications in the order they arrived, earliest first (E30/F01/S05).
 *
 * The server lists them newest first, so the deck's "1 of 16" was the last to arrive. First come is
 * the order an organizer decides in, and the one a first-come rule assigns in. One with no time
 * goes last, and those it cannot tell apart keep the order they came in.
 */
export function inArrivalOrder<T extends Pick<Application, 'submittedAt'>>(apps: T[]): T[] {
  const time = (app: T) => (app.submittedAt ? Date.parse(app.submittedAt) : NaN);
  return apps
    .map((app, index) => ({ app, index, at: time(app) }))
    .sort((x, y) => {
      const xKnown = !Number.isNaN(x.at);
      const yKnown = !Number.isNaN(y.at);
      if (xKnown !== yKnown) return xKnown ? -1 : 1;
      return (xKnown && x.at !== y.at ? x.at - y.at : 0) || x.index - y.index;
    })
    .map(({ app }) => app);
}

/** Awaiting a verdict, and nobody is chasing it yet. */
const AWAITING: readonly string[] = [ApplicationStatus.Open, ApplicationStatus.UnderReview];

/** Waiting on its applicant, with someone reaching out (E34/F02/S01). */
export function followUps(applications: Application[]): Application[] {
  return inArrivalOrder(applications.filter((a) => a.status === ApplicationStatus.NeedsFollowUp));
}

/**
 * What the one-by-one review walks: the undecided in the order they arrived, and the follow-ups
 * after them only when the reviewer asks (E34/F02/S01) - a follow-up waits on its applicant, so it
 * is not the next thing to decide.
 */
export function reviewQueue(applications: Application[], includeFollowUps: boolean): Application[] {
  const waiting = inArrivalOrder(applications.filter((a) => AWAITING.includes(a.status)));
  return includeFollowUps ? [...waiting, ...followUps(applications)] : waiting;
}

/**
 * Reviewed: everything the queue is done with, whatever became of it since.
 *
 * Deliberately "neither awaiting nor followed up" rather than "approved or rejected". An
 * application does not stay at its reviewer verdict: assignment carries it to `assigned` or
 * `unassigned`, offers to `assignment_sent`, and the sweep into market days to `vendor_accepted` or
 * `vendor_refused`. A list of the two reviewer verdicts alone would drop each application the
 * moment the market moved on.
 */
export function reviewed(applications: Application[]): Application[] {
  return applications.filter(
    (a) => !AWAITING.includes(a.status) && a.status !== ApplicationStatus.NeedsFollowUp,
  );
}

/**
 * The review's two views (E34/F04/S01), All first and the default (E38/F05/S01): an address with no
 * `view` opens All, and One by one is `view=one` - or a named application with no `view`, which is a
 * link to one card (bug 42).
 */
export type ReviewView = 'all' | 'one';

export function reviewView(query: Record<string, unknown>): ReviewView {
  if (query.view === 'one') return 'one';
  return !query.view && query.application ? 'one' : 'all';
}

/**
 * The All view's status filters (E34/F04/S01), as the address names them. The undecided read
 * "Open", the status an undecided application shows (E38/F05/S01); its address is still `undecided`.
 */
export const ALL_VIEW_FILTERS = [
  { id: 'all', label: 'Any status' },
  { id: 'undecided', label: 'Open' },
  { id: ApplicationStatus.NeedsFollowUp, label: 'Needs follow-up' },
  { id: ApplicationStatus.ReviewerApproved, label: 'Approved' },
  { id: ApplicationStatus.ReviewerRejected, label: 'Rejected' },
] as const;

export type AllViewFilter = (typeof ALL_VIEW_FILTERS)[number]['id'];

/** The filter an address names, or every application for one it does not know. */
export function allViewFilter(asked: unknown): AllViewFilter {
  return ALL_VIEW_FILTERS.some((f) => f.id === asked) ? (asked as AllViewFilter) : 'all';
}

/**
 * Whether the All view lists an application of this status under this filter: a filter is decided
 * by status alone, so the Stats tab can count the filters from counts by status.
 */
export function allViewLists(filter: AllViewFilter, status: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'undecided') return AWAITING.includes(status);
  return status === filter;
}

/**
 * The applications the All view lists: those with the status asked for - "Open" is every one
 * awaiting a verdict - and, with Mine, only the follow-ups the viewer owns.
 */
export function allViewApplications(
  applications: Application[],
  filter: AllViewFilter,
  mine: boolean,
  me: string,
): Application[] {
  const shown = applications.filter((a) => allViewLists(filter, a.status));
  if (!mine) return inArrivalOrder(shown);
  const viewer = me.trim().toLowerCase();
  return inArrivalOrder(
    shown.filter(
      (a) =>
        a.status === ApplicationStatus.NeedsFollowUp &&
        (a.followUpOwner?.email ?? '').toLowerCase() === viewer,
    ),
  );
}

/** Who else has this application open, if anyone but the viewer does: its tick is not theirs. */
export function heldElsewhere(application: Application, me: string): string | null {
  const holder = application.heldBy?.email;
  return holder && holder.toLowerCase() !== me.trim().toLowerCase() ? holder : null;
}

/**
 * What Select all ticks (E38/F05/S02): every row shown - the filter and Mine already applied - but
 * those another reviewer has open, which cannot be ticked one by one either; and how many it left.
 */
export function selectAll(shown: Application[], me: string): { ids: string[]; skipped: number } {
  const free = shown.filter((a) => !heldElsewhere(a, me));
  return { ids: free.map((a) => a.id), skipped: shown.length - free.length };
}
