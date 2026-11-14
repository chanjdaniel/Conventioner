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
  type Allocation,
  type Market,
  type PreconditionResult,
} from '@/assets/types/datatypes';
import { MarketAction, mayTake } from '@/utils/marketActions';
import { phaseLabel, phaseSpine, transitionDirection, VALID_TRANSITIONS } from '@/utils/phase';
import {
  TAB_PAGES,
  resultsAreOut,
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
 * phase. Going back to draft exists so the setup and the form become editable again; going back
 * from Assignment, so a verdict can change (T207).
 */
export function pathTransitionLabel(from: string, to: string, path: IntakeMode): string {
  const csv = path === IntakeMode.Csv;
  switch (to) {
    case MarketPhase.Archived:
      return 'Archive market';
    case MarketPhase.Draft:
      return 'Reopen for editing';
    // A Google Form market's first import takes this move once its rows are written, so beside the
    // rail's "Import responses" it is the step after, never pressed (E38/F04/S01).
    case MarketPhase.Applications:
      if (from === MarketPhase.Assignment) return 'Back to review';
      return csv ? 'Begin review' : 'Open applications';
    case MarketPhase.Assignment:
      return 'Begin assignment';
    case MarketPhase.Offers:
      return 'Send offers';
    case MarketPhase.MarketDays:
      return 'Publish market';
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

/** Review setup's two decisions (T206), which the move out of draft alone waits on. */
const REVIEW_SETUP: ReadonlySet<string> = new Set([
  'review_highlights_decided',
  'rejection_rules_decided',
]);

/**
 * Whether the organizer has drafted the form past its essential questions: it asks one of their
 * own, or the start from a Google Form's responses has run, which keeps what it read of the file
 * (`exampleColumns`, absent on a market never started so) even when the organizer left every column
 * of their own out, and so may leave the form with essential questions alone.
 */
function theFormIsDrafted(market: Market): boolean {
  return (market.applicationForm?.fields?.length ?? 0) > 0 || Array.isArray(market.exampleColumns);
}

/** Publish results waits on a stale run, and the server would take a new one. */
function staleRunToPublish(market: Market, blocker: PreconditionResult): boolean {
  return (
    blocker.resolutionAction === MarketAction.PublishResults &&
    Boolean(market.publishWaitsReason) &&
    market.allocation === 'stale' &&
    !market.assignRefusalReason
  );
}

/**
 * Whether the server would take a blocker's remedy as it stands (T316): Allocate tables only where
 * `assignRefusalReason` is clear, Publish results only where `publishWaitsReason` is, each the
 * server's own answer for that action. A market left in Offers was offered both, and refused
 * both. Whether this person may take it is the role's, `mayTake`; an answer the read does not
 * carry leaves the remedy to the role, as before.
 */
export function serverTakesRemedy(
  market: Pick<Market, 'assignRefusalReason' | 'publishWaitsReason'> | null | undefined,
  blocker: Pick<PreconditionResult, 'resolutionAction' | 'resolutionLink'> | null | undefined,
): boolean {
  if (blocker?.resolutionAction === MarketAction.PublishResults) return !market?.publishWaitsReason;
  // A run is Assign's remedy on Settings, where its button is; on Assignments it is a seat by hand.
  if (blocker?.resolutionAction === MarketAction.Assign && blocker.resolutionLink === 'settings') {
    return !market?.assignRefusalReason;
  }
  return true;
}

/**
 * The first thing in a move's way, in the order the organizer works through it: the first blocker
 * served, except that the form comes before Review setup (T260).
 *
 * Once the plan gives the form its essential questions the server's form guard passes, so a draft
 * whose organizer had not yet drafted from their Google Form, or added a question of their own, was
 * told to decide what reviewers read first, before there was anything of theirs to decide on. While
 * the form is not drafted and Review setup is next, the step is the form: the start from a Google
 * Form's responses on that path, for someone who may take it, else Your questions. Nothing is
 * refused for it: a form of essential questions alone still opens once Review setup is decided,
 * and the server's blockers are what the moves are judged by.
 */
export function firstInTheWay(market: Market, toPhase: string | null): PreconditionResult | null {
  const [blocker] = blockersFor(market, toPhase);
  if (blocker && staleRunToPublish(market, blocker)) {
    // A stale run's fix is a new run (T316): Publish results is refused as out of date, so the
    // rail says the server's refusal and offers what puts it right, where the server takes a run.
    return {
      ...blocker,
      message: market.publishWaitsReason!,
      resolutionLink: 'settings',
      resolutionLabel: 'Allocate tables',
      resolutionAction: MarketAction.Assign,
    };
  }
  if (!blocker || !REVIEW_SETUP.has(blocker.id)) return blocker ?? null;
  if (theFormIsDrafted(market)) return blocker;
  // The decision still open, as the end of a sentence: "then decide what reviewers read first".
  const label = blocker.resolutionLabel ?? 'Decide Review setup';
  const then = `then ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  const fromTheirGoogleForm =
    intakeModeOf(market) === IntakeMode.Csv &&
    !market.csvStartRefusal &&
    mayTake(market, MarketAction.ImportApplications);
  return fromTheirGoogleForm
    ? {
        id: 'form_first',
        passed: false,
        message: `Your form asks only the essential questions so far. Draft the rest from your Google Form's responses, ${then} on Review setup.`,
        resolutionLink: 'start-from-csv',
        resolutionLabel: 'Draft from your Google Form',
        resolutionAction: MarketAction.ImportApplications,
      }
    : {
        id: 'form_first',
        passed: false,
        message: `Your form asks only the essential questions so far. Add any of your own on Your questions, ${then} on Review setup.`,
        resolutionLink: 'form?step=questions',
        resolutionLabel: 'Add your questions',
        resolutionAction: MarketAction.ChangeForm,
      };
}

export interface NextStep {
  /** What the rail says. */
  text: string;
  /** Where it is done: a page of this market, relative to `/markets/<id>/`. Null for nowhere. */
  page: MarketPage | string | null;
  /** The move it would take, refused for this reason, when it would be. */
  blocker: PreconditionResult | null;
  /**
   * The row of the market's actions table the step takes: the blocker's remedy's, else the guide
   * row's. The rail links the step only for someone the table lets take it (T142). Null where it
   * leads nowhere, or a blocker names no action.
   */
  action: MarketAction | null;
}

/** What a row of the guide reads off the market, beyond its phase. */
interface Standing {
  path: IntakeMode;
  /**
   * Where the table allocation stands, as the server serves it (T316): whether tables are
   * allocated, and whether its applicants have been told, which settles the result.
   */
  allocation: Allocation;
  /** Every one of its dates is over. */
  ended: boolean;
  /** It reached market days: its vendor page is the record. */
  ran: boolean;
  /** Its vendor page has stopped taking applications, inside the stage (E38/F04/S02). */
  stopped?: boolean;
}

/**
 * One phase's row: the page it is worked on - the one carrying the dot - what the rail says, and
 * the action of the table its step takes.
 */
interface GuideRow {
  page: MarketPage;
  /** Where a move into the phase lands, when not on `page`: a flow the phase's work is done in. */
  lands?: MarketFlow;
  statement: string;
  /**
   * The row of the market's actions table the work the statement leads to takes, so the rail links
   * the statement only for someone who may (T142). Null where it leads nowhere: an archive is done
   * with.
   */
  action: MarketAction | null;
  /**
   * What the rail says instead to someone who may not take the step - a standing blocker's remedy,
   * else `action` - where the statement would tell them to do it: what they may do there, read, a
   * step that leads to `page`. The rail told a Viewer "Check vendors in at the door." just above
   * the frame's line saying they may change nothing, and every other row a step that was not theirs
   * either (E38/F15/S04). It never says what they may not: the frame says that, once. It must hold
   * whether the row's blockers stand or have passed, on either path. A row whose statement is true
   * for everyone has none.
   */
  onlooker?: string;
  /**
   * What the rail says to someone who may take `action` but not the step onward (moving the phase,
   * or a standing blocker's remedy), where the statement would tell them to take it: the work that
   * is theirs, and who does the rest. An Editor in Assignment may change the seats but publish
   * neither the results nor the market. A row without one says its statement, or its onlooker's.
   */
  helper?: string;
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
    ? 'Your vendor page is not taking applications.'
    : 'Applications are open on your vendor page: review them as they arrive.';
}

/** The stage as someone who may not decide reads it: nothing in it asks them to review. */
function watchedStageLead({ path, stopped }: Pick<Standing, 'path' | 'stopped'>): string {
  if (path === IntakeMode.Csv) return 'Every imported response is here.';
  return stopped
    ? 'The vendor page is not taking applications.'
    : 'Applications are open on the vendor page.';
}

/**
 * The stage's onlooker sentence. It is read while applications wait and once every one is decided,
 * so it never says a review is going on.
 */
function watchedStage(standing: Pick<Standing, 'path' | 'stopped'>): string {
  const each = standing.path === IntakeMode.Csv ? 'response' : 'application';
  return `${watchedStageLead(standing)} Read where each ${each} stands.`;
}

/**
 * Ticket 02's answer, one row per phase. `currentPage` reads its pages, so the dot, the landing page
 * and the rail's link can never disagree about where a market is worked on.
 */
const GUIDE: Record<string, (standing: Standing) => GuideRow> = {
  [MarketPhase.Draft]: ({ path }) => ({
    page: 'setup',
    action: MarketAction.ChangeSetup,
    statement:
      path === IntakeMode.Form
        ? 'Plan the market and its application form, then open applications.'
        : "Plan the market, from your Google Form's responses or by hand, then import the responses.",
    onlooker: 'The market is being planned. Read its plan on Market Setup.',
  }),
  // The vendor page's address is in the rail beside this, under the same name, with Copy.
  [MarketPhase.Applications]: (standing) => ({
    page: 'applications',
    action: MarketAction.GiveVerdicts,
    statement: `${stageLead(standing)} Every application is decided: Begin assignment.`,
    onlooker: watchedStage(standing),
  }),
  // Worked on the rules until tables are allocated, and on the assignments after: tables assigned
  // by hand alone are no allocation, and Publish results waits for one (T316). Once results are
  // published the assignments are settled, and what is left is the move. Both paths publish
  // results before the market goes live (ADR 0022), so the sentences are the same on both.
  [MarketPhase.Assignment]: ({ allocation }) =>
    resultsAreOut(allocation)
      ? {
          page: 'assignments',
          action: MarketAction.MovePhase,
          statement:
            'Results are published, so the assignments are settled. Publish the market to open check-in with the door code; that cannot be undone.',
          onlooker:
            'Results are published, so the assignments are settled. Check-in with the door code opens when the market is published.',
        }
      : allocation === 'current' || allocation === 'stale'
        ? {
            page: 'assignments',
            action: MarketAction.Assign,
            statement:
              'Check the assignments, then publish the market: that opens check-in with the door code, and cannot be undone.',
            onlooker:
              'Tables are allocated, and the market is not published yet. Read the assignments.',
            helper: 'Check the assignments; the results are published by whoever may publish them.',
          }
        : {
            page: 'settings',
            action: MarketAction.Assign,
            statement:
              allocation === 'pinned'
                ? 'Set the rules and allocate tables. The tables you assigned by hand are kept.'
                : 'Set the rules and allocate tables.',
            onlooker: 'Tables are not allocated yet. Read the rules they will follow on Settings.',
          },
  // Nothing sets a market in offers any more, but one left there still has a step onward, whose
  // blockers are served to everyone; someone who may not assign reads only where to look.
  [MarketPhase.Offers]: ({ allocation, path }) => ({
    page: allocation === 'none' ? 'settings' : 'assignments',
    action: MarketAction.Assign,
    statement: `This market is in ${pathPhaseLabel(MarketPhase.Offers, path)}.`,
    onlooker: `This market is in ${pathPhaseLabel(MarketPhase.Offers, path)}. ${
      allocation === 'none' ? 'Read the rules on Settings.' : 'Read the assignments.'
    }`,
  }),
  // Each day's roster printed first, the door's fallback when the venue's network fails (T318);
  // once it has run, what is left is archiving it.
  [MarketPhase.MarketDays]: ({ ended }) =>
    ended
      ? {
          page: 'attendance',
          action: MarketAction.MovePhase,
          statement: 'The market has run. Archive it to keep it as the record of what happened.',
          onlooker: 'The market has run. Who came is on Attendance.',
        }
      : {
          page: 'attendance',
          action: MarketAction.CheckIn,
          statement: "Print each day's roster, then check vendors in at the door.",
          onlooker: 'Follow who has checked in at the door.',
        },
  // One that never ran has nothing to show but its plan.
  [MarketPhase.Archived]: ({ allocation, ran }) => ({
    page: allocation === 'none' ? 'setup' : 'assignments',
    statement: ran
      ? 'Archived: the record of what happened stays on its vendor page.'
      : 'Archived: this market is the record of what happened.',
    action: null,
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
      action: MarketAction.ChangeSetup,
      statement: `This market is in ${pathPhaseLabel(phase, standing.path)}.`,
    }
  );
}

/** Where the table allocation stands; a read that did not carry it reads as nothing allocated. */
function allocationOf(allocation: Allocation | null | undefined): Allocation {
  return allocation ?? 'none';
}

/**
 * The page a market is worked on in its phase: the one carrying the dot, and where it lands. The
 * guide's own page for the phase; only the phase and where the table allocation stands decide it.
 */
export function currentPage(
  phase: string | undefined | null,
  allocation: Allocation | null | undefined,
): MarketPage {
  return rowFor(String(phase ?? MarketPhase.Draft), {
    path: IntakeMode.Csv,
    allocation: allocationOf(allocation),
    ended: false,
    ran: false,
  }).page;
}

/**
 * Where a move into a phase lands (E32/F01/S01): the phase's page, or the flow a row names its work
 * as done in (`lands`), though no row names one now, so a move into the stage lands on Applications
 * on both paths.
 */
export function landingPage(
  phase: string,
  allocation: Allocation | null | undefined,
  path: IntakeMode,
): MarketPage | MarketFlow {
  return landingOf(
    rowFor(phase, { path, allocation: allocationOf(allocation), ended: false, ran: false }),
  );
}

/** The page a tab opens: the one carrying the dot when the tab holds it, else its first. */
export function pageForTab(
  tab: MarketTab,
  phase: string | undefined | null,
  allocation: Allocation | null | undefined,
): MarketPage {
  const current = currentPage(phase, allocation);
  return TAB_PAGES[tab].includes(current) ? current : TAB_PAGES[tab][0];
}

/** The guard that holds the stage open while an application is undecided (`guards.py`). */
const UNDECIDED = 'all_applications_reviewed';

/**
 * The guards whose refusal, when it names no remedy, is a plain fact that asks nobody to do
 * anything, so it reads to everyone: `all_applications_reviewed` names none only to say "There are
 * no applications for this market.". Every other guard the rail can meet that names no remedy has
 * two, on two pages, and its message ends in them ("Restore the seat in the plan, or move or free
 * those vendors."), so it reads only to someone who may do the row's work. `no_applications_yet`
 * names none and is a fact too, but guards only the move back to draft, never the step onward.
 * Keyed on the guard, never on its words.
 */
const FACTS: ReadonlySet<string> = new Set([UNDECIDED]);

/**
 * The rail's statement for this market, now.
 *
 * A step's blockers are served to everyone, so a blocker reads only to someone who may take its
 * remedy (T142), or, naming none, who may do the row's work, unless it is one of the `FACTS`;
 * anyone else reads the row's `helper` when they may do the row's work, else its onlooker sentence,
 * each true whether the blocker stands or not.
 */
export function nextStep(market: Market, today: string = calendarToday()): NextStep {
  const phase = String(market.phase ?? MarketPhase.Draft);
  const path = intakeModeOf(market);
  const allocation = allocationOf(market.allocation);
  const forward = forwardFrom(market, today);
  const blocker = firstInTheWay(market, forward);
  const stopped = Boolean(market.applicationsStopped);
  const row = rowFor(phase, {
    path,
    allocation,
    ended: lastDateHasPassed(market, today),
    ran: (market.phasesReached ?? []).includes(MarketPhase.MarketDays),
    stopped,
  });
  // Before a run, running is the step, and the sentence says so; Publish still waits, disabled with
  // its own reason. Hand assignments alone are no run (T316). Anywhere else a refused step onward
  // is the next thing to put right.
  const runFirst =
    phase === MarketPhase.Assignment && (allocation === 'none' || allocation === 'pinned');
  const standing = forward && blocker && !runFirst ? blocker : null;
  const remedy = standing?.resolutionAction ?? null;
  const theirs = mayTake(market, row.action);
  // The step is the standing blocker's remedy, else the row's own.
  const onlooking = Boolean(row.onlooker) && !mayTake(market, remedy ?? row.action);
  // Someone who may do the row's work, but not what stands in the step's way: its blocker's
  // remedy, or, with none standing, moving the phase.
  const helping =
    Boolean(row.helper) &&
    theirs &&
    (standing
      ? remedy !== null && !mayTake(market, remedy)
      : !mayTake(market, MarketAction.MovePhase));
  const blockerReads =
    standing !== null && !helping && (!onlooking || (!remedy && FACTS.has(standing.id)));
  if (forward && standing && blockerReads) {
    const stage = phase === MarketPhase.Applications;
    const lead = onlooking ? watchedStageLead({ path, stopped }) : stageLead({ path, stopped });
    // Work left to finish leads to the review; none at all is said as what the move waits on.
    const ask =
      stage && standing.id === UNDECIDED && standing.resolutionLink
        ? 'Finish deciding'
        : `To ${pathTransitionLabel(phase, forward, path).toLowerCase()}`;
    return {
      text: `${stage ? `${lead} ` : ''}${ask}: ${standing.message}`,
      page: serverTakesRemedy(market, standing) ? (standing.resolutionLink ?? null) : null,
      blocker: standing,
      action: remedy,
    };
  }
  const said = helping
    ? { statement: row.helper!, action: row.action }
    : onlooking
      ? { statement: row.onlooker!, action: MarketAction.Read }
      : { statement: row.statement, action: row.action };
  return {
    text: said.statement,
    page: said.action ? landingOf(row) : null,
    blocker: null,
    action: said.action,
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

/**
 * The step a form tab address names in its `step` query (T206), while this path has it: a blocker's
 * fix, a bookmark or a shared link opens Review setup as `form?step=review`. Null for no step, an
 * unknown one, or one the path lacks (`preview` on a Google Form market), so the tab opens where it
 * would with none.
 */
export function formStepNamed(named: unknown, path: IntakeMode): FormStepId | null {
  return formSteps(path).find((step) => step.id === named)?.id ?? null;
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
