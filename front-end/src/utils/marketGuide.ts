/**
 * What a market's screens say about where it stands and what to do now, for each phase and each
 * intake path (E31/F02/S02, F03).
 *
 * The one table the product reads it from - the answer to ticket 02 of the "what to show, and when"
 * map (`.scratch/wayfinding/what-to-show-and-when/issues/02-the-next-step-per-phase-and-path.md`).
 * The phases are the same on both paths; what they are called, what the rail says, and what each
 * tab says out of its phase are not. A CSV market's vendors apply on the organizer's own Google
 * Form, so nothing on it may suggest they apply here.
 *
 * Statements name the one next step. When the server would refuse that step, the statement is its
 * first blocker instead (served on the market as `transitionBlockers`, judged by the same guards
 * the move runs), so the rail says no before the click rather than after it.
 */
import {
  IntakeMode,
  MarketPhase,
  type Market,
  type PreconditionResult,
} from '@/assets/types/datatypes';
import { phaseLabel, phaseSpine, transitionDirection, VALID_TRANSITIONS } from '@/utils/phase';
import { TAB_PAGES, hasAssignment, type MarketPage, type MarketTab } from '@/utils/marketPage';

/** Absent means CSV, as the server reads it: the applicant surface fails closed. */
export function intakeModeOf(market: Pick<Market, 'intakeMode'> | null | undefined): IntakeMode {
  return market?.intakeMode === IntakeMode.Form ? IntakeMode.Form : IntakeMode.Csv;
}

/** The CSV path's names for the two phases whose meaning differs there. */
const CSV_PHASE_LABELS: Partial<Record<string, string>> = {
  [MarketPhase.ApplicationsOpen]: 'Collecting',
  [MarketPhase.ApplicationsClosed]: 'Form Closed',
};

/** A phase as the market's own path names it. */
export function pathPhaseLabel(phase: string | null | undefined, path: IntakeMode): string {
  if (path === IntakeMode.Csv && phase && CSV_PHASE_LABELS[phase]) return CSV_PHASE_LABELS[phase]!;
  return phaseLabel(phase);
}

/**
 * A move as the market's own path names it - for what the organizer wants to do, not for the
 * phase. Going back to draft exists so the setup and the form become editable again.
 */
export function pathTransitionLabel(from: string, to: string, path: IntakeMode): string {
  const csv = path === IntakeMode.Csv;
  switch (to) {
    case MarketPhase.Archived:
      return 'Archive Market';
    case MarketPhase.Draft:
      return 'Reopen for Editing';
    case MarketPhase.ApplicationsOpen:
      if (from === MarketPhase.Draft) return csv ? 'Start Collecting' : 'Open Applications';
      return csv ? 'Collect Again' : 'Reopen Applications';
    case MarketPhase.ApplicationsClosed:
      if (from === MarketPhase.ApplicationsOpen)
        return csv ? 'Done Collecting' : 'Close Applications';
      return csv ? 'Back to Importing' : 'Return to Applications Closed';
    case MarketPhase.Review:
      return 'Begin Review';
    case MarketPhase.Assignment:
      return 'Begin Assignment';
    case MarketPhase.Offers:
      return 'Send Offers';
    case MarketPhase.MarketDays:
      return 'Publish Market';
    default:
      return `Move to ${pathPhaseLabel(to, path)}`;
  }
}

/**
 * Today as a market date, on the viewer's own calendar: the door's day. In UTC, a Vancouver market
 * would have read its last day as over by four in the afternoon. The one definition, read by the
 * rail and by Attendance alike. The server, which cannot know where a market is, calls a date over
 * only once it is over everywhere (`_earliest_calendar_day` in `guards.py`), so any date it refuses
 * is over on this calendar too.
 */
export function calendarToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Whether every one of the market's dates is over. False for a market with none. */
export function lastDateHasPassed(market: Market, today: string = calendarToday()): boolean {
  const dates = (market.setupObject?.marketDates ?? []).map((d) => d.date).sort();
  return dates.length > 0 && dates[dates.length - 1] < today;
}

/**
 * The stages a market in this phase is drawn on: the lifecycle, which leaves `offers` off - nothing
 * sets `assignment_sent` - unless the market IS in such a phase, which then gets its stage back at
 * the place the transition table puts it. A rail with no marker says nothing about where it stands.
 */
export function spineFor(phase: string): string[] {
  const lifecycle = phaseSpine();
  if (lifecycle.includes(phase)) return lifecycle;
  const arrivedFrom = VALID_TRANSITIONS.find(
    ([from, to]) => to === phase && lifecycle.includes(from),
  );
  const at = arrivedFrom ? lifecycle.indexOf(arrivedFrom[0]) + 1 : lifecycle.length - 1;
  return [...lifecycle.slice(0, at), phase, ...lifecycle.slice(at)];
}

/**
 * The one step onward from a phase, read off the spine. Once its last date has passed, a running
 * market's step onward is archiving it (E31/F02/S03); before then archiving stays in the menu.
 */
export function forwardFrom(market: Market, today: string = calendarToday()): string | null {
  const phase = String(market.phase ?? MarketPhase.Draft);
  if (phase === MarketPhase.MarketDays) {
    return lastDateHasPassed(market, today) ? MarketPhase.Archived : null;
  }
  const spine = spineFor(phase);
  return (
    VALID_TRANSITIONS.filter(([from]) => from === phase)
      .map(([, to]) => to)
      .find((to) => transitionDirection(phase, to, spine) === 'forward') ?? null
  );
}

/** What would refuse a move, as the market read served it; empty when nothing would. */
export function blockersFor(market: Market, toPhase: string | null): PreconditionResult[] {
  if (!toPhase) return [];
  return market.transitionBlockers?.[toPhase] ?? [];
}

export interface NextStep {
  /** What the rail says. */
  text: string;
  /** Where it is done: a page of this market, relative to `/markets/<id>/`. Null for nowhere. */
  page: MarketPage | string | null;
  /** The move it would take, refused for this reason, when it would be. */
  blocker: PreconditionResult | null;
}

/** What a row of the guide reads off the market, beyond its phase. */
interface Standing {
  path: IntakeMode;
  /** An assignment is stored. */
  assigned: boolean;
  /** Every one of its dates is over. */
  ended: boolean;
  /** It reached market days: its check-in page is the record. */
  ran: boolean;
}

/** One phase's row: the page it is worked on - the one carrying the dot - and what the rail says. */
interface GuideRow {
  page: MarketPage;
  statement: string;
  /** False where the statement leads nowhere: an archive is done with. */
  links?: boolean;
}

/** Review means nothing more arrives, on either path (ticket 02). */
const REVIEW_LEAD: Record<IntakeMode, string> = {
  [IntakeMode.Form]: 'Nothing more is coming in.',
  [IntakeMode.Csv]: 'Nothing more is coming in, and nothing more can be imported.',
};

/**
 * Ticket 02's answer, one row per phase. `currentPage` reads its pages, so the dot, the landing page
 * and the rail's link can never disagree about where a market is worked on.
 */
const GUIDE: Record<string, (standing: Standing) => GuideRow> = {
  [MarketPhase.Draft]: ({ path }) => ({
    page: 'setup',
    statement:
      path === IntakeMode.Form
        ? 'Plan the market and its application form, then open applications.'
        : "Plan the market, from your Google Form's responses or by hand, then start collecting.",
  }),
  // The address itself is in the rail beside this, under the same name, with Copy.
  [MarketPhase.ApplicationsOpen]: ({ path }) => ({
    page: 'applications',
    statement:
      path === IntakeMode.Form
        ? 'Applications are open on your application page. Review them as they arrive, and close applications when you stop taking them.'
        : 'Collecting on your Google Form. Import responses as they arrive and review them, and say when you are done collecting.',
  }),
  [MarketPhase.ApplicationsClosed]: ({ path }) => ({
    page: 'applications',
    statement:
      path === IntakeMode.Form
        ? 'Applications are closed. Finish deciding, and begin review once no more are coming; until then you can still reopen.'
        : 'Your Google Form is closed. Import the last responses, then begin review.',
  }),
  [MarketPhase.Review]: ({ path }) => ({
    page: 'applications',
    statement: `${REVIEW_LEAD[path]} Every application is decided: begin assignment.`,
  }),
  // Worked on the rules until there is a result, and on the result after.
  [MarketPhase.Assignment]: ({ assigned }) =>
    assigned
      ? {
          page: 'result',
          statement:
            'Check the result, then publish the market: that puts the check-in page up, and cannot be undone.',
        }
      : { page: 'assignment', statement: 'Set the rules and run the assignment.' },
  [MarketPhase.Offers]: ({ assigned, path }) => ({
    page: assigned ? 'result' : 'assignment',
    statement: `This market is in ${pathPhaseLabel(MarketPhase.Offers, path)}.`,
  }),
  [MarketPhase.MarketDays]: ({ ended }) => ({
    page: 'attendance',
    statement: ended
      ? 'The market has run. Archive it to keep it as the record of what happened.'
      : 'Check vendors in at the door.',
  }),
  // One that never ran has nothing to show but its plan.
  [MarketPhase.Archived]: ({ assigned, ran }) => ({
    page: assigned ? 'result' : 'setup',
    statement: ran
      ? 'Archived: the record of what happened stays on its check-in page.'
      : 'Archived: this market is the record of what happened.',
    links: false,
  }),
};

function rowFor(phase: string, standing: Standing): GuideRow {
  // A phase this build does not recognise still gets a page. Every market has a plan, so it is the
  // one page that is never wrong to show.
  return (
    GUIDE[phase]?.(standing) ?? {
      page: 'setup',
      statement: `This market is in ${pathPhaseLabel(phase, standing.path)}.`,
    }
  );
}

/**
 * The page a market is worked on in its phase: the one carrying the dot, and where it lands. The
 * guide's own page for the phase; only the phase and whether a run is stored decide it.
 */
export function currentPage(phase: string | undefined | null, hasAssignment: boolean): MarketPage {
  return rowFor(String(phase ?? MarketPhase.Draft), {
    path: IntakeMode.Csv,
    assigned: hasAssignment,
    ended: false,
    ran: false,
  }).page;
}

/** The page a tab opens: the one carrying the dot when the tab holds it, else its first. */
export function pageForTab(
  tab: MarketTab,
  phase: string | undefined | null,
  hasAssignment: boolean,
): MarketPage {
  const current = currentPage(phase, hasAssignment);
  return TAB_PAGES[tab].includes(current) ? current : TAB_PAGES[tab][0];
}

/** The rail's statement for this market, now. */
export function nextStep(market: Market, today: string = calendarToday()): NextStep {
  const phase = String(market.phase ?? MarketPhase.Draft);
  const path = intakeModeOf(market);
  const assigned = hasAssignment(market);
  const forward = forwardFrom(market, today);
  const [blocker] = blockersFor(market, forward);
  // Before a run, running is the step, and the sentence says so; Publish still waits, disabled with
  // its own reason. Anywhere else a refused step onward is the next thing to put right.
  const runFirst = phase === MarketPhase.Assignment && !assigned;
  if (forward && blocker && !runFirst) {
    const review = phase === MarketPhase.Review;
    const ask =
      review && blocker.id === UNDECIDED
        ? 'Finish deciding'
        : `To ${pathTransitionLabel(phase, forward, path).toLowerCase()}`;
    return {
      text: `${review ? `${REVIEW_LEAD[path]} ` : ''}${ask}: ${blocker.message}`,
      page: blocker.resolutionLink ?? null,
      blocker,
    };
  }
  const row = rowFor(phase, {
    path,
    assigned,
    ended: lastDateHasPassed(market, today),
    ran: (market.phasesReached ?? []).includes(MarketPhase.MarketDays),
  });
  return { text: row.statement, page: row.links === false ? null : row.page, blocker: null };
}

/** The guard that holds review open while an application is undecided (`guards.py`). */
const UNDECIDED = 'all_applications_reviewed';

/** A tab as the market's own path names it: a CSV market's form is the questions its file maps onto. */
export function pathTabLabel(
  tab: MarketTab,
  path: IntakeMode,
  labels: Record<MarketTab, string>,
): string {
  return tab === 'form' && path === IntakeMode.Csv ? 'Questions' : labels[tab];
}

/**
 * What a tab says while its work is not yet here, or is over: null when the tab is live.
 *
 * The lines the server owns - the setup's, the form's and the rules' locks - are the server's and
 * are shown where they are; this says only what the phase alone decides.
 */
export function tabNote(market: Market, tab: MarketTab): string | null {
  const phase = String(market.phase ?? MarketPhase.Draft);
  const csv = intakeModeOf(market) === IntakeMode.Csv;
  switch (tab) {
    case 'applications':
      return phase === MarketPhase.Draft
        ? csv
          ? 'Import opens when you start collecting.'
          : 'Applications arrive here once they open.'
        : null;
    case 'attendance': {
      const published =
        phase === MarketPhase.MarketDays ||
        (phase === MarketPhase.Archived &&
          (market.phasesReached ?? []).includes(MarketPhase.MarketDays));
      if (published) return null;
      return phase === MarketPhase.Archived
        ? 'This market was archived without being published, so nobody checked in.'
        : 'Opens when the market is published.';
    }
    default:
      return null;
  }
}
