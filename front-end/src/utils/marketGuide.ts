/**
 * What a market's screens say about where it stands and what to do now, for each phase and each
 * intake path (E31/F02/S02, F03).
 *
 * The one table the product reads it from - the answer to `wayfinding/what-to-show-and-when/02`,
 * kept in `docs/implementation/modules/market-guide.md`.
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
import { MarketAction, mayTake } from '@/utils/marketActions';
import { phaseLabel, phaseSpine, transitionDirection, VALID_TRANSITIONS } from '@/utils/phase';
import {
  TAB_PAGES,
  hasAssignment,
  type MarketFlow,
  type MarketPage,
  type MarketTab,
} from '@/utils/marketPage';

/** Absent means CSV, as the server reads it: the applicant surface fails closed. */
export function intakeModeOf(market: Pick<Market, 'intakeMode'> | null | undefined): IntakeMode {
  return market?.intakeMode === IntakeMode.Form ? IntakeMode.Form : IntakeMode.Csv;
}

/**
 * The CSV path's names for the phases whose meaning differs there. Its organizer holds the responses
 * when the market leaves draft, and its first import takes it into the stage, so on this path the
 * stage is where they are reviewed (E38/F04/S01).
 */
const CSV_PHASE_LABELS: Partial<Record<string, string>> = {
  [MarketPhase.Applications]: 'Review',
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
    // A Google Form market's first import takes this move once its rows are written, so beside the
    // rail's "Import responses" it is the step after, never pressed (E38/F04/S01).
    case MarketPhase.Applications:
      return csv ? 'Begin Review' : 'Open Applications';
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
 * sets `assignment_sent` - unless the market IS in it, which then gets its stage back at the place
 * the transition table puts it. A rail with no marker says nothing about where it stands.
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
  return movesOf(market).find((to) => transitionDirection(phase, to, spine) === 'forward') ?? null;
}

/**
 * Every move open to the market from its phase, as the market read served them: the keys of
 * `transitionBlockers`, each judged on the server.
 */
export function movesOf(market: Pick<Market, 'transitionBlockers'> | null | undefined): string[] {
  return Object.keys(market?.transitionBlockers ?? {});
}

/** An action inside the stage that is not a move: the rail lists it in its More… menu. */
export interface StageAction {
  id: 'redo-import' | 'stop-applications' | 'take-applications';
  label: string;
}

/**
 * The actions the rail offers inside the stage, beside its moves (E38/F04): a Google Form market's
 * Redo import, which reads the whole responses file again while the review goes on, and an own-form
 * market's stop and resume, a fact about its form rather than a move. Each only for someone the
 * server would let take it: the table's import row and its stop row (E39/F01/S02), and the stop
 * served with the stage's own reason beside it.
 */
export function stageActions(market: Market | null | undefined): StageAction[] {
  if (!market || market.phase !== MarketPhase.Applications) return [];
  if (intakeModeOf(market) === IntakeMode.Csv) {
    return mayTake(market, MarketAction.ImportApplications)
      ? [{ id: 'redo-import', label: 'Redo import' }]
      : [];
  }
  if (!mayTake(market, MarketAction.StopApplications) || market.applicationsStopReason) return [];
  return market.applicationsStopped
    ? [{ id: 'take-applications', label: 'Take applications again' }]
    : [{ id: 'stop-applications', label: 'Stop taking applications' }];
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
  /** Its applicants have been told whether they have a table, which settles the result. */
  published?: boolean;
  /** Its application page has stopped taking applications, inside the stage (E38/F04/S02). */
  stopped?: boolean;
}

/** One phase's row: the page it is worked on - the one carrying the dot - and what the rail says. */
interface GuideRow {
  page: MarketPage;
  /** Where a move into the phase lands, when not on `page`: a flow the phase's work is done in. */
  lands?: MarketFlow;
  statement: string;
  /** False where the statement leads nowhere: an archive is done with. */
  links?: boolean;
}

/**
 * What the stage means on each path, where applications arrive and are reviewed at once
 * (E38/F04/S01): on a market's own page they keep arriving until the organizer stops taking them;
 * on the Google Form path everything imported is here, and a late export comes in by the rail's
 * Redo import.
 */
function stageLead({ path, stopped }: Pick<Standing, 'path' | 'stopped'>): string {
  if (path === IntakeMode.Csv) return 'Every imported response is here.';
  return stopped
    ? 'Your application page is not taking applications.'
    : 'Applications are open on your application page: review them as they arrive.';
}

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
        : "Plan the market, from your Google Form's responses or by hand, then import the responses.",
  }),
  // The application page's address is in the rail beside this, under the same name, with Copy.
  [MarketPhase.Applications]: (standing) => ({
    page: 'applications',
    statement: `${stageLead(standing)} Every application is decided: Begin Assignment.`,
  }),
  // Worked on the rules until there is a result, and on the result after.
  [MarketPhase.Assignment]: ({ assigned, published }) =>
    published
      ? {
          page: 'assignments',
          statement:
            'Results are published, so the result is settled. Publish the market to put the check-in page up; that cannot be undone.',
        }
      : assigned
        ? {
            page: 'assignments',
            statement:
              'Check the result, then publish the market: that puts the check-in page up, and cannot be undone.',
          }
        : { page: 'settings', statement: 'Set the rules and allocate tables.' },
  [MarketPhase.Offers]: ({ assigned, path }) => ({
    page: assigned ? 'assignments' : 'settings',
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
    page: assigned ? 'assignments' : 'setup',
    statement: ran
      ? 'Archived: the record of what happened stays on its check-in page.'
      : 'Archived: this market is the record of what happened.',
    links: false,
  }),
};

/** Where a row's work is done: the flow it lands on, else its page. */
function landingOf(row: GuideRow): MarketPage | MarketFlow {
  return row.lands ?? row.page;
}

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

/**
 * Where a move into a phase lands (E32/F01/S01): the phase's page, or the flow its work is done in
 * - a Google Form market's importing lands on the import (E32/F02/S01).
 */
export function landingPage(
  phase: string,
  hasAssignment: boolean,
  path: IntakeMode,
): MarketPage | MarketFlow {
  return landingOf(rowFor(phase, { path, assigned: hasAssignment, ended: false, ran: false }));
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
  const stopped = Boolean(market.applicationsStopped);
  if (forward && blocker && !runFirst) {
    const stage = phase === MarketPhase.Applications;
    // Work left to finish leads to the review; none at all is said as what the move waits on.
    const ask =
      stage && blocker.id === UNDECIDED && blocker.resolutionLink
        ? 'Finish deciding'
        : `To ${pathTransitionLabel(phase, forward, path).toLowerCase()}`;
    return {
      text: `${stage ? `${stageLead({ path, stopped })} ` : ''}${ask}: ${blocker.message}`,
      page: blocker.resolutionLink ?? null,
      blocker,
    };
  }
  const row = rowFor(phase, {
    path,
    assigned,
    ended: lastDateHasPassed(market, today),
    ran: (market.phasesReached ?? []).includes(MarketPhase.MarketDays),
    published: Boolean(market.resultsPublished),
    stopped,
  });
  return {
    text: row.statement,
    page: row.links === false ? null : landingOf(row),
    blocker: null,
  };
}

/** The application form tab's steps (E33/F01/S01). */
export type FormStepId = 'essentials' | 'questions' | 'preview' | 'review';
export interface FormStep {
  id: FormStepId;
  label: string;
}

const FORM_STEPS: readonly FormStep[] = [
  { id: 'essentials', label: 'Essential questions' },
  { id: 'questions', label: 'Your questions' },
  { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'Review setup' },
];

/**
 * The form tab's steps on a path. A Google Form market's vendors are imported, so nobody fills its
 * form in: it has no preview (E33/F01/S02).
 */
export function formSteps(path: IntakeMode): readonly FormStep[] {
  return path === IntakeMode.Form ? FORM_STEPS : FORM_STEPS.filter((step) => step.id !== 'preview');
}

/** The guard that holds the stage open while an application is undecided (`guards.py`). */
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
          ? 'Responses arrive here with your first import, which begins review.'
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
