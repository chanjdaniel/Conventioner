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
import { currentPage, hasAssignment, type MarketPage, type MarketTab } from '@/utils/marketPage';

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
 * rail and by Attendance alike.
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

const STATEMENTS: Record<string, Record<IntakeMode, string>> = {
  [MarketPhase.Draft]: {
    [IntakeMode.Form]: 'Plan the market and its application form, then open applications.',
    [IntakeMode.Csv]:
      "Plan the market, from your Google Form's responses or by hand, then start collecting.",
  },
  [MarketPhase.ApplicationsOpen]: {
    [IntakeMode.Form]:
      'Applications are open. Review them as they arrive, and close applications when you stop taking them.',
    [IntakeMode.Csv]:
      'Collecting on your Google Form. Import responses as they arrive and review them, and say when you are done collecting.',
  },
  [MarketPhase.ApplicationsClosed]: {
    [IntakeMode.Form]:
      'Applications are closed. Finish deciding, and begin review once no more are coming; until then you can still reopen.',
    [IntakeMode.Csv]: 'Your Google Form is closed. Import the last responses, then begin review.',
  },
  [MarketPhase.Review]: {
    [IntakeMode.Form]: 'Nothing more is coming in. Every application is decided: begin assignment.',
    [IntakeMode.Csv]:
      'Nothing more is coming in, and nothing more can be imported. Every application is decided: begin assignment.',
  },
};

/** The rail's statement for this market, now. */
export function nextStep(market: Market, today: string = calendarToday()): NextStep {
  const phase = String(market.phase ?? MarketPhase.Draft);
  const path = intakeModeOf(market);
  const forward = forwardFrom(market, today);
  const [blocker] = blockersFor(market, forward);
  // Before a run, running is the step, and the sentence says so; Publish still waits, disabled with
  // its own reason. Anywhere else a refused step onward is the next thing to put right.
  const runFirst = phase === MarketPhase.Assignment && !hasAssignment(market);
  if (forward && blocker && !runFirst) {
    return {
      text: `To ${pathTransitionLabel(phase, forward, path).toLowerCase()}: ${blocker.message}`,
      page: blocker.resolutionLink ?? null,
      blocker,
    };
  }
  const page = currentPage(phase, hasAssignment(market));
  const said = (text: string, where: MarketPage | null = page): NextStep => ({
    text,
    page: where,
    blocker: null,
  });

  if (STATEMENTS[phase]) return said(STATEMENTS[phase][path]);
  switch (phase) {
    case MarketPhase.Assignment:
      return hasAssignment(market)
        ? said(
            'Check the result, then publish the market: that puts the check-in page up, and cannot be undone.',
          )
        : said('Set the rules and run the assignment.');
    case MarketPhase.MarketDays:
      return lastDateHasPassed(market, today)
        ? said('The market has run. Archive it to keep it as the record of what happened.')
        : said('Check vendors in at the door.');
    case MarketPhase.Archived:
      return said('Archived: this market is the record of what happened.', null);
    default:
      return said(`This market is in ${pathPhaseLabel(phase, path)}.`);
  }
}

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
        ? 'This market was never published, so nobody checked in.'
        : 'Opens when the market is published.';
    }
    default:
      return null;
  }
}
