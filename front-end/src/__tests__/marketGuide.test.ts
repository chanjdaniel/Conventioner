/**
 * What a market's screens say, phase by phase and path by path (E31/F02/S02, F03).
 *
 * Ticket 02 of the "what to show, and when" map: the walk found every screen offering what the
 * market could not do yet, refusing only after the click, and a CSV market wearing the form
 * path's words for steps no vendor ever sees.
 */
import { describe, expect, it } from 'vitest';
import {
  IntakeMode,
  MarketPhase,
  type ApplicationForm,
  type ExampleColumn,
  type Market,
  type PreconditionResult,
} from '@/assets/types/datatypes';
import { phaseSpine } from '@/utils/phase';
import { movesServedFrom } from './support/servedMoves';
import { assignmentPlacing } from './support/assignment';
import { answersRefusing, EDITOR_ANSWERS, VIEWER_ANSWERS } from './support/servedAnswers';
import { MarketAction } from '@/utils/marketActions';
import {
  blockersFor,
  currentPage,
  firstInTheWay,
  forwardFrom,
  landingPage,
  spineFor,
  intakeModeOf,
  nextStep,
  pathPhaseLabel,
  pathTabLabel,
  pathTransitionLabel,
  stageActions,
  tabNote,
} from '@/utils/marketGuide';
import { TAB_LABELS } from '@/utils/marketPage';

const TODAY = '2099-05-10';

/** A market whose assignment placed one vendor. */
const ASSIGNED: Pick<Market, 'assignmentObject'> = {
  assignmentObject: assignmentPlacing('a@example.com'),
};

function market(phase: MarketPhase, overrides: Partial<Market> = {}): Market {
  return {
    id: 'm1',
    name: 'Riverside',
    phase,
    intakeMode: IntakeMode.Form,
    setupObject: { marketDates: [{ date: '2099-05-20' }] },
    assignmentObject: { vendorAssignments: [] },
    transitionBlockers: movesServedFrom(phase),
    actionRefusals: answersRefusing(),
    ...overrides,
  } as unknown as Market;
}

describe('the path a market is on', () => {
  it('is CSV unless the market says form, as the server reads it', () => {
    expect(intakeModeOf(market(MarketPhase.Draft))).toBe(IntakeMode.Form);
    expect(intakeModeOf(market(MarketPhase.Draft, { intakeMode: undefined }))).toBe(IntakeMode.Csv);
  });
});

describe('the words a CSV market wears', () => {
  it('names the stage Review on a Google Form market and Applications on the other (E38/F04/S01)', () => {
    expect(pathPhaseLabel(MarketPhase.Applications, IntakeMode.Csv)).toBe('Review');
    expect(pathPhaseLabel(MarketPhase.Applications, IntakeMode.Form)).toBe('Applications');
    expect(pathPhaseLabel(MarketPhase.Assignment, IntakeMode.Csv)).toBe('Assignment');
  });

  it('names the moves for what the organizer does on each path', () => {
    const draft = MarketPhase.Draft;
    const stage = MarketPhase.Applications;
    expect(pathTransitionLabel(draft, stage, IntakeMode.Csv)).toBe('Begin review');
    expect(pathTransitionLabel(draft, stage, IntakeMode.Form)).toBe('Open applications');
    expect(pathTransitionLabel(stage, draft, IntakeMode.Form)).toBe('Reopen for editing');
    expect(pathTransitionLabel(stage, MarketPhase.Assignment, IntakeMode.Csv)).toBe(
      'Begin assignment',
    );
  });

  it('calls the way back from Assignment "Back to review" on both paths (T207)', () => {
    const back = (path: IntakeMode) =>
      pathTransitionLabel(MarketPhase.Assignment, MarketPhase.Applications, path);
    expect(back(IntakeMode.Form)).toBe('Back to review');
    expect(back(IntakeMode.Csv)).toBe('Back to review');
  });

  it('calls the form "Questions", since no applicant ever sees it', () => {
    expect(pathTabLabel('form', IntakeMode.Csv, TAB_LABELS)).toBe('Questions');
    expect(pathTabLabel('form', IntakeMode.Form, TAB_LABELS)).toBe('Application Form');
  });

  it('never says vendors apply here, in any phase', () => {
    for (const phase of phaseSpine()) {
      const said = nextStep(market(phase as MarketPhase, { intakeMode: IntakeMode.Csv }), TODAY);
      expect(said.text, phase).not.toMatch(/applications? (are |is )?open|open applications/i);
    }
  });
});

describe('the next step', () => {
  it('has a statement for every phase on the spine, on both paths', () => {
    for (const intakeMode of [IntakeMode.Form, IntakeMode.Csv]) {
      for (const phase of phaseSpine()) {
        const said = nextStep(market(phase as MarketPhase, { intakeMode }), TODAY);
        expect(said.text, `${intakeMode} ${phase}`).not.toMatch(/^This market is in /);
      }
    }
  });

  it('is the first blocker, pointing at its fix, when the step would be refused', () => {
    const blocked = market(MarketPhase.Draft, {
      transitionBlockers: {
        applications: [
          {
            id: 'every_tier_has_tables',
            passed: false,
            message: 'Tier Bronze has no tables.',
            resolutionLink: 'setup',
          },
        ],
      },
    });

    const said = nextStep(blocked, TODAY);

    expect(said.text).toBe('To open applications: Tier Bronze has no tables.');
    expect(said.page).toBe('setup');
    expect(said.blocker?.id).toBe('every_tier_has_tables');
  });

  it('asks for a run before a result, and a check before publishing after one', () => {
    expect(nextStep(market(MarketPhase.Assignment), TODAY).text).toMatch(/allocate tables/);
    // Publish waits on the run, and the run - not its refusal - is what the sentence names.
    const unrun = market(MarketPhase.Assignment, {
      transitionBlockers: {
        market_days: [{ id: 'assignment_computed', passed: false, message: 'Run it first.' }],
      },
    });
    expect(nextStep(unrun, TODAY)).toMatchObject({
      text: 'Set the rules and allocate tables.',
      page: 'settings',
    });
    const run = market(MarketPhase.Assignment, {
      assignmentObject: { vendorAssignments: [{ email: 'a@example.com' }] },
    } as Partial<Market>);
    expect(nextStep(run, TODAY)).toMatchObject({ page: 'assignments' });
    expect(nextStep(run, TODAY).text).toMatch(/cannot be undone/);
  });

  it('once the results are published, says the assignments are settled (E36/F04/S02)', () => {
    const told = market(MarketPhase.Assignment, {
      assignmentObject: { vendorAssignments: [{ email: 'a@example.com' }] },
      resultsPublished: true,
    } as Partial<Market>);

    expect(nextStep(told, TODAY).text).toBe(
      'Results are published, so the assignments are settled. Publish the market to open check-in with the door code; that cannot be undone.',
    );
  });

  it('in the stage, says what is arriving before the work left', () => {
    const undecided = {
      transitionBlockers: {
        assignment: [
          {
            id: 'all_applications_reviewed',
            passed: false,
            message: '2 applications are still open.',
            resolutionLink: 'applications',
          },
        ],
      },
    };
    expect(nextStep(market(MarketPhase.Applications, undecided), TODAY)).toMatchObject({
      text: 'Applications are open on your vendor page: review them as they arrive. Finish deciding: 2 applications are still open.',
      page: 'applications',
    });
    const stopped = market(MarketPhase.Applications, { ...undecided, applicationsStopped: true });
    expect(nextStep(stopped, TODAY).text).toMatch(
      /^Your vendor page is not taking applications\. Finish deciding: /,
    );
    const csv = market(MarketPhase.Applications, { ...undecided, intakeMode: IntakeMode.Csv });
    // A late export comes in by the rail's Redo import, so it says only what is so.
    expect(nextStep(csv, TODAY).text).toMatch(
      /^Every imported response is here\. Finish deciding: /,
    );
    const noTables = market(MarketPhase.Applications, {
      applicationsStopped: true,
      transitionBlockers: {
        assignment: [{ id: 'no_empty_tier', passed: false, message: 'Tier Gold has no tables.' }],
      },
    });
    expect(nextStep(noTables, TODAY).text).toBe(
      'Your vendor page is not taking applications. To begin assignment: Tier Gold has no tables.',
    );
  });

  it('names where applications are open, on the form path', () => {
    expect(nextStep(market(MarketPhase.Applications), TODAY).text).toMatch(
      /^Applications are open on your vendor page/,
    );
  });

  it('points an archive that ran at the record its vendor page keeps', () => {
    const ran = market(MarketPhase.Archived, { phasesReached: [MarketPhase.MarketDays] });
    expect(nextStep(ran, TODAY)).toMatchObject({ page: null });
    expect(nextStep(ran, TODAY).text).toMatch(/vendor page/);
    expect(nextStep(market(MarketPhase.Archived), TODAY).text).not.toMatch(/vendor page/);
  });

  // Where a move into the phase lands, too: a Google Form market's importing is done on the import,
  // while the dot stays on the Applications tab that holds it (E32/F02/S01).
  it('is where the market is worked on: the statement leads where a move lands', () => {
    for (const intakeMode of [IntakeMode.Form, IntakeMode.Csv]) {
      for (const phase of phaseSpine().filter((p) => p !== MarketPhase.Archived)) {
        for (const assigned of [false, true]) {
          const m = market(
            phase as MarketPhase,
            {
              intakeMode,
              assignmentObject: { vendorAssignments: assigned ? [{ email: 'a@example.com' }] : [] },
            } as Partial<Market>,
          );
          expect(nextStep(m, TODAY).page, `${intakeMode} ${phase} ${assigned}`).toBe(
            landingPage(phase, assigned, intakeMode),
          );
        }
      }
    }
  });

  it('sends market days to the door, and to archiving once the last date has passed', () => {
    expect(nextStep(market(MarketPhase.MarketDays), TODAY)).toMatchObject({
      text: "Print each day's roster, then check vendors in at the door.",
      page: 'attendance',
    });
    expect(nextStep(market(MarketPhase.MarketDays), '2099-06-01').text).toMatch(/Archive it/);
  });
});

/*
 * The rail told a Viewer "Check vendors in at the door." just above the frame's line saying they may
 * change nothing, and on every other row a step that was not theirs either (E38/F15/S04). Someone
 * the row's action refuses is told what they may do there, read, and led to it; never what they may
 * not, which the frame says once.
 */
describe('what the rail tells someone the step is not theirs', () => {
  const viewer = (phase: MarketPhase, overrides: Partial<Market> = {}) =>
    market(phase, { actionRefusals: VIEWER_ANSWERS, ...overrides });

  const rows: [string, Market, string, string, string][] = [
    [
      'draft',
      viewer(MarketPhase.Draft),
      TODAY,
      'The market is being planned. Read its plan on Market Setup.',
      'setup',
    ],
    [
      'applications, open',
      viewer(MarketPhase.Applications),
      TODAY,
      'Applications are open on the vendor page. Read where each application stands.',
      'applications',
    ],
    [
      'applications, stopped',
      viewer(MarketPhase.Applications, { applicationsStopped: true }),
      TODAY,
      'The vendor page is not taking applications. Read where each application stands.',
      'applications',
    ],
    [
      'review',
      viewer(MarketPhase.Applications, { intakeMode: IntakeMode.Csv }),
      TODAY,
      'Every imported response is here. Read where each response stands.',
      'applications',
    ],
    [
      'assignment, not assigned',
      viewer(MarketPhase.Assignment),
      TODAY,
      'Tables are not allocated yet. Read the rules they will follow on Settings.',
      'settings',
    ],
    [
      'assignment, assigned',
      viewer(MarketPhase.Assignment, ASSIGNED),
      TODAY,
      'Tables are allocated, and the market is not published yet. Read the assignments.',
      'assignments',
    ],
    [
      'assignment, results published',
      viewer(MarketPhase.Assignment, { ...ASSIGNED, resultsPublished: true }),
      TODAY,
      'Results are published, so the assignments are settled. Check-in with the door code opens when the market is published.',
      'assignments',
    ],
    [
      'market days, a date to come',
      viewer(MarketPhase.MarketDays),
      TODAY,
      'Follow who has checked in at the door.',
      'attendance',
    ],
    [
      'market days, every date over',
      viewer(MarketPhase.MarketDays),
      '2099-06-01',
      'The market has run. Who came is on Attendance.',
      'attendance',
    ],
  ];

  for (const [standing, m, today, text, page] of rows) {
    it(`${standing}: says what a Viewer may do there, and leads them to it`, () => {
      expect(nextStep(m, today)).toMatchObject({ text, page, action: MarketAction.Read });
      // Nothing that is not theirs: no step to take, and not the frame's line again.
      expect(nextStep(m, today).text).not.toMatch(
        /review them|allocate tables|then publish|Publish the market|Archive|Check vendors|Plan the|import the|\bchange\b|\bview\b/i,
      );
    });
  }

  /*
   * The server serves a step's blockers to everyone, so a refused step onward is the common case:
   * the stage while an application waits, Assignment until a form market's results are published.
   * Someone who may not take the blocker's remedy reads the row's onlooker sentence instead, and
   * that sentence holds whether the blocker stands or has passed, on either path.
   */
  const UNDECIDED_BLOCKER = {
    id: 'all_applications_reviewed',
    passed: false,
    message:
      '1 application is still open. Every application must be approved or rejected before the market can enter Assignment.',
    resolutionLink: 'applications',
    resolutionLabel: 'Finish deciding',
    resolutionAction: MarketAction.GiveVerdicts,
  };
  const UNPUBLISHED_BLOCKER: PreconditionResult = {
    id: 'results_published',
    passed: false,
    message:
      'Vendors have not been told whether they have a table. Publish the results before the market goes live.',
    resolutionLink: 'applications',
    resolutionLabel: 'Publish results',
    resolutionAction: MarketAction.PublishResults,
  };
  const NOT_THEIRS = /review them|Finish deciding|Publish the results|Begin assignment|To /;

  it('the stage, an application still waiting: never asks a Viewer to review', () => {
    const waiting = viewer(MarketPhase.Applications, {
      transitionBlockers: { assignment: [UNDECIDED_BLOCKER], draft: [] },
    });
    const said = nextStep(waiting, TODAY);
    expect(said.text).not.toMatch(NOT_THEIRS);
    expect(said).toMatchObject({
      text: 'Applications are open on the vendor page. Read where each application stands.',
      page: 'applications',
      blocker: null,
      action: MarketAction.Read,
    });
  });

  it('the stage, every response decided: never says the review is still going on', () => {
    const decided = viewer(MarketPhase.Applications, {
      intakeMode: IntakeMode.Csv,
      transitionBlockers: { assignment: [], draft: [] },
    });
    const said = nextStep(decided, TODAY);
    expect(said.text).not.toMatch(/as they|are decided|Follow the review/);
    expect(said).toMatchObject({
      text: 'Every imported response is here. Read where each response stands.',
      page: 'applications',
      action: MarketAction.Read,
    });
  });

  it('the stage with no applications: says the fact, in words that ask nobody to review', () => {
    // Its guard names no remedy, so the blocker is everyone's to read (T142).
    const none = viewer(MarketPhase.Applications, {
      transitionBlockers: {
        assignment: [
          {
            id: 'all_applications_reviewed',
            passed: false,
            message:
              'There are no applications for this market. At least one application must exist before the market can enter Assignment.',
            resolutionLink: null,
          },
        ],
        draft: [],
      },
    } as unknown as Partial<Market>);
    expect(nextStep(none, TODAY).text).toBe(
      'Applications are open on the vendor page. To begin assignment: There are no applications for this market. At least one application must exist before the market can enter Assignment.',
    );
  });

  it('Assignment on a form market, results not published: never asks a Viewer to publish', () => {
    const unpublished = viewer(MarketPhase.Assignment, {
      ...ASSIGNED,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
    });
    const said = nextStep(unpublished, TODAY);
    expect(said.text).not.toMatch(NOT_THEIRS);
    expect(said).toMatchObject({
      text: 'Tables are allocated, and the market is not published yet. Read the assignments.',
      page: 'assignments',
      blocker: null,
      action: MarketAction.Read,
    });
  });

  it('Assignment on a Google Form market, results not published: the same sentence', () => {
    const csv = viewer(MarketPhase.Assignment, {
      ...ASSIGNED,
      intakeMode: IntakeMode.Csv,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
    });
    expect(nextStep(csv, TODAY)).toMatchObject({
      text: 'Tables are allocated, and the market is not published yet. Read the assignments.',
      page: 'assignments',
      action: MarketAction.Read,
    });
  });

  it('Assignment on a Google Form market leads its owner to Publish results (ADR 0022)', () => {
    const csv = market(MarketPhase.Assignment, {
      ...ASSIGNED,
      intakeMode: IntakeMode.Csv,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
    });
    expect(nextStep(csv, TODAY)).toMatchObject({
      text: `To publish market: ${UNPUBLISHED_BLOCKER.message}`,
      page: 'applications',
      blocker: { id: 'results_published' },
      action: MarketAction.PublishResults,
    });
  });

  it('reads the blocker to whoever may take its remedy, exactly as T142 decided', () => {
    const waiting = market(MarketPhase.Applications, {
      transitionBlockers: { assignment: [UNDECIDED_BLOCKER], draft: [] },
    });
    expect(nextStep(waiting, TODAY)).toMatchObject({
      text: `Applications are open on your vendor page: review them as they arrive. Finish deciding: ${UNDECIDED_BLOCKER.message}`,
      blocker: { id: 'all_applications_reviewed' },
      action: MarketAction.GiveVerdicts,
    });
    const unpublished = market(MarketPhase.Assignment, {
      ...ASSIGNED,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
    });
    expect(nextStep(unpublished, TODAY)).toMatchObject({
      text: `To publish market: ${UNPUBLISHED_BLOCKER.message}`,
      blocker: { id: 'results_published' },
      action: MarketAction.PublishResults,
    });
  });

  /*
   * A blocker that names no remedy has two, on two pages, and its message ends in them ("Restore
   * the seat in the plan, or move or free those vendors."): an instruction like any other, so an
   * onlooker reads the row's sentence. Only a plain fact, "There are no applications for this
   * market.", reads to everyone.
   */
  const ORPHANED_PIN = {
    id: 'no_orphaned_pin',
    passed: false,
    message:
      '1 hand assignment names a seat the plan no longer has: vendor@example.com at A3 on 2099-05-01. Restore the seat in the plan, or move or free those vendors.',
    resolutionLink: null,
  };
  const TIER_WITHOUT_TABLES = {
    id: 'no_asked_for_tier_without_tables',
    passed: false,
    message:
      '1 tier has no tables, and approved applicants are waiting on them: Gold (vendor@example.com). Add a section at that tier, or reject those applications, before allocating tables.',
    resolutionLink: null,
  };

  it('Assignment with an orphaned pin: a Viewer reads no remedy that is not theirs', () => {
    const orphaned = viewer(MarketPhase.Assignment, {
      ...ASSIGNED,
      transitionBlockers: { market_days: [ORPHANED_PIN], applications: [] },
    } as unknown as Partial<Market>);
    const said = nextStep(orphaned, TODAY);
    expect(said.text).not.toMatch(/Restore|move or free/);
    expect(said).toMatchObject({
      text: 'Tables are allocated, and the market is not published yet. Read the assignments.',
      blocker: null,
      action: MarketAction.Read,
    });
  });

  it('the stage with a tier that has no tables: a Viewer reads no remedy that is not theirs', () => {
    const short = viewer(MarketPhase.Applications, {
      transitionBlockers: { assignment: [TIER_WITHOUT_TABLES], draft: [] },
    } as unknown as Partial<Market>);
    const said = nextStep(short, TODAY);
    expect(said.text).not.toMatch(/Add a section|reject those applications/);
    expect(said).toMatchObject({
      text: 'Applications are open on the vendor page. Read where each application stands.',
      blocker: null,
      action: MarketAction.Read,
    });
  });

  it("reads a remedy-less blocker to whoever may do the row's work, as before", () => {
    const orphaned = market(MarketPhase.Assignment, {
      ...ASSIGNED,
      transitionBlockers: { market_days: [ORPHANED_PIN], applications: [] },
    } as unknown as Partial<Market>);
    expect(nextStep(orphaned, TODAY)).toMatchObject({
      text: `To publish market: ${ORPHANED_PIN.message}`,
      blocker: { id: 'no_orphaned_pin' },
    });
    // An Editor may move or free those vendors, so it is theirs too.
    expect(nextStep({ ...orphaned, actionRefusals: EDITOR_ANSWERS }, TODAY)).toMatchObject({
      text: `To publish market: ${ORPHANED_PIN.message}`,
      blocker: { id: 'no_orphaned_pin' },
    });
  });

  /*
   * An Editor may change the seats in Assignment, but neither publish the results nor the market:
   * the Viewer's read step undersold what they may do, and the row's own sentence told them to
   * publish. They read what is theirs, and who does the rest.
   */
  it('reads an Editor in Assignment before results are published what they may do there', () => {
    const unpublished = market(MarketPhase.Assignment, {
      ...ASSIGNED,
      actionRefusals: EDITOR_ANSWERS,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
    });
    expect(nextStep(unpublished, TODAY)).toMatchObject({
      text: 'Check the assignments; the results are published by whoever may publish them.',
      page: 'assignments',
      blocker: null,
      action: MarketAction.Assign,
    });
    // A Google Form market publishes results too, so its Editor reads the same (ADR 0022).
    const csv = market(MarketPhase.Assignment, {
      ...ASSIGNED,
      intakeMode: IntakeMode.Csv,
      actionRefusals: EDITOR_ANSWERS,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
    });
    expect(nextStep(csv, TODAY)).toMatchObject({
      text: 'Check the assignments; the results are published by whoever may publish them.',
      page: 'assignments',
      action: MarketAction.Assign,
    });
    // The Viewer's read sentence stays.
    expect(
      nextStep(
        viewer(MarketPhase.Assignment, {
          ...ASSIGNED,
          transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER], applications: [] },
        }),
        TODAY,
      ).text,
    ).toBe('Tables are allocated, and the market is not published yet. Read the assignments.');
  });

  it('says the step to whoever may take it, an Editor at the door and a chosen Viewer in review', () => {
    expect(
      nextStep(market(MarketPhase.MarketDays, { actionRefusals: EDITOR_ANSWERS }), TODAY).text,
    ).toBe("Print each day's roster, then check vendors in at the door.");
    const chosen = market(MarketPhase.Applications, {
      actionRefusals: { ...VIEWER_ANSWERS, [MarketAction.GiveVerdicts]: null },
    });
    expect(nextStep(chosen, TODAY).text).toMatch(/review them as they arrive/);
    expect(nextStep(chosen, TODAY).action).toBe(MarketAction.GiveVerdicts);
  });

  /*
   * Nothing moves a market into Offers now, but one left there from before still has a step onward,
   * and its blockers ("Publish the results ...", "Restore the seat ...") are served to everyone.
   */
  it('Offers, a blocker standing: a Viewer reads no remedy that is not theirs', () => {
    const left = viewer(MarketPhase.Offers, {
      ...ASSIGNED,
      transitionBlockers: { market_days: [UNPUBLISHED_BLOCKER] },
    });
    const said = nextStep(left, TODAY);
    expect(said.text).not.toMatch(/Publish the results/);
    expect(said).toMatchObject({
      text: 'This market is in Offers. Read the assignments.',
      page: 'assignments',
      blocker: null,
      action: MarketAction.Read,
    });
    const orphaned = viewer(MarketPhase.Offers, {
      ...ASSIGNED,
      intakeMode: IntakeMode.Csv,
      transitionBlockers: { market_days: [ORPHANED_PIN] },
    } as unknown as Partial<Market>);
    expect(nextStep(orphaned, TODAY).text).toBe('This market is in Offers. Read the assignments.');
    expect(nextStep(viewer(MarketPhase.Offers), TODAY)).toMatchObject({
      text: 'This market is in Offers. Read the rules on Settings.',
      page: 'settings',
      action: MarketAction.Read,
    });
  });

  it("says what is true to everyone where nothing is anyone's to do: an archive", () => {
    expect(nextStep(viewer(MarketPhase.Archived), TODAY)).toMatchObject({
      text: nextStep(market(MarketPhase.Archived), TODAY).text,
      action: null,
    });
  });
});

describe('the action a step takes (T142)', () => {
  it("names the table's row for each phase's step, so the rail offers it only to whom it may", () => {
    const steps: [string, Market, string, MarketAction | null][] = [
      ['draft', market(MarketPhase.Draft), TODAY, MarketAction.ChangeSetup],
      ['applications', market(MarketPhase.Applications), TODAY, MarketAction.GiveVerdicts],
      [
        'review',
        market(MarketPhase.Applications, { intakeMode: IntakeMode.Csv }),
        TODAY,
        MarketAction.GiveVerdicts,
      ],
      ['assignment, not assigned', market(MarketPhase.Assignment), TODAY, MarketAction.Assign],
      [
        'assignment, assigned',
        market(MarketPhase.Assignment, ASSIGNED),
        TODAY,
        MarketAction.Assign,
      ],
      [
        'assignment, results published',
        market(MarketPhase.Assignment, { ...ASSIGNED, resultsPublished: true }),
        TODAY,
        MarketAction.MovePhase,
      ],
      ['offers, not assigned', market(MarketPhase.Offers), TODAY, MarketAction.Assign],
      ['offers, assigned', market(MarketPhase.Offers, ASSIGNED), TODAY, MarketAction.Assign],
      ['market days, a date to come', market(MarketPhase.MarketDays), TODAY, MarketAction.CheckIn],
      [
        'market days, every date over',
        market(MarketPhase.MarketDays),
        '2099-06-01',
        MarketAction.MovePhase,
      ],
      ['archived', market(MarketPhase.Archived), TODAY, null],
    ];
    for (const [standing, m, today, action] of steps) {
      expect(nextStep(m, today).action, standing).toBe(action);
    }
  });

  it("is the blocker's own when the step is a blocker's remedy", () => {
    const blocked = market(MarketPhase.Draft, {
      transitionBlockers: {
        applications: [
          {
            id: 'setup_has_dates',
            passed: false,
            message: 'This market has no dates.',
            resolutionLink: 'setup',
            resolutionLabel: 'Pick market dates',
            resolutionAction: MarketAction.ChangeSetup,
          },
        ],
      },
    });
    expect(nextStep(blocked, TODAY)).toMatchObject({
      page: 'setup',
      action: MarketAction.ChangeSetup,
    });
    const importing = market(MarketPhase.Draft, {
      intakeMode: IntakeMode.Csv,
      transitionBlockers: {
        applications: [
          {
            id: 'responses_imported',
            passed: false,
            message: 'No responses are imported yet.',
            resolutionLink: 'import',
            resolutionLabel: 'Import responses',
            resolutionAction: MarketAction.ImportApplications,
          },
        ],
      },
    });
    expect(nextStep(importing, TODAY).action).toBe(MarketAction.ImportApplications);
  });

  it('is none for a blocker that names no action, as a read from an older server would', () => {
    const older = market(MarketPhase.Draft, {
      transitionBlockers: {
        applications: [
          {
            id: 'setup_has_dates',
            passed: false,
            message: 'This market has no dates.',
            resolutionLink: 'setup',
            resolutionLabel: 'Pick market dates',
          },
        ],
      },
    });
    expect(nextStep(older, TODAY)).toMatchObject({ page: 'setup', action: null });
  });
});

describe('the step onward', () => {
  it('is archiving once a running market has had its last day, and none before', () => {
    expect(forwardFrom(market(MarketPhase.MarketDays), TODAY)).toBeNull();
    expect(forwardFrom(market(MarketPhase.MarketDays), '2099-05-21')).toBe(MarketPhase.Archived);
  });

  it('is the spine step elsewhere', () => {
    expect(forwardFrom(market(MarketPhase.Applications), TODAY)).toBe(MarketPhase.Assignment);
  });
});

describe('a tab out of its phase says when it matters', () => {
  it('says applications arrive once they open, in the words of each path', () => {
    expect(tabNote(market(MarketPhase.Draft), 'applications')).toMatch(/once they open/);
    expect(
      tabNote(market(MarketPhase.Draft, { intakeMode: IntakeMode.Csv }), 'applications'),
    ).toMatch(/with your first import, which begins review/);
    expect(tabNote(market(MarketPhase.Applications), 'applications')).toBeNull();
  });

  it('says attendance opens on publishing, and is live once the market has run', () => {
    expect(tabNote(market(MarketPhase.Draft), 'attendance')).toBe(
      'Opens when the market is published.',
    );
    expect(tabNote(market(MarketPhase.MarketDays), 'attendance')).toBeNull();
    const ran = market(MarketPhase.Archived, { phasesReached: [MarketPhase.MarketDays] });
    expect(tabNote(ran, 'attendance')).toBeNull();
    // Archived without running: said as archived, and why there is no roster (ticket 02).
    const abandoned = market(MarketPhase.Archived, { phasesReached: [MarketPhase.Draft] });
    expect(tabNote(abandoned, 'attendance')).toBe(
      'This market was archived without being published, so nobody checked in.',
    );
  });
});

describe('the Google Form path enters Review by its first import (E38/F04/S01)', () => {
  const csv = (phase: MarketPhase, overrides: Partial<Market> = {}) =>
    market(phase, { intakeMode: IntakeMode.Csv, ...overrides });
  const NOTHING_IMPORTED = {
    id: 'responses_imported',
    passed: false,
    message: "Nothing has been imported yet. Import your Google Form's responses first.",
    resolutionLink: 'import',
    resolutionLabel: 'Import responses',
  };

  it('draws the same five stages as the other path', () => {
    expect(spineFor(MarketPhase.Applications)).toEqual([
      'draft',
      'applications',
      'assignment',
      'market_days',
      'archived',
    ]);
  });

  it('sends a draft to the import, the move waiting on it', () => {
    const draft = csv(MarketPhase.Draft, {
      transitionBlockers: { applications: [NOTHING_IMPORTED], archived: [] },
    });

    expect(forwardFrom(draft, TODAY)).toBe(MarketPhase.Applications);
    expect(nextStep(draft, TODAY)).toMatchObject({
      text: "To begin review: Nothing has been imported yet. Import your Google Form's responses first.",
      page: 'import',
    });
  });

  it('lands a move into the stage on the review, on both paths', () => {
    expect(landingPage(MarketPhase.Applications, false, IntakeMode.Csv)).toBe('applications');
    expect(landingPage(MarketPhase.Applications, false, IntakeMode.Form)).toBe('applications');
    expect(currentPage(MarketPhase.Applications, false)).toBe('applications');
  });

  it('says to import, never to collect', () => {
    for (const phase of [MarketPhase.Draft, MarketPhase.Applications]) {
      expect(nextStep(csv(phase), TODAY).text, phase).not.toMatch(/collect/i);
    }
    expect(tabNote(csv(MarketPhase.Draft), 'applications')).not.toMatch(/collect/i);
  });
});

describe('what the stage offers beside its moves (E38/F04/S02, S03)', () => {
  it('offers a Google Form market Redo import', () => {
    const csv = market(MarketPhase.Applications, { intakeMode: IntakeMode.Csv });

    expect(stageActions(csv)).toEqual([{ id: 'redo-import', label: 'Redo import' }]);
  });

  it('offers an own-form market to stop taking applications, and to take them again', () => {
    const taking = market(MarketPhase.Applications, { applicationsStopReason: null });
    const stopped = market(MarketPhase.Applications, {
      applicationsStopReason: null,
      applicationsStopped: true,
    });

    expect(stageActions(taking).map((a) => a.label)).toEqual(['Stop taking applications']);
    expect(stageActions(stopped).map((a) => a.label)).toEqual(['Take applications again']);
  });

  it('offers nothing outside the stage, or to someone the server would refuse', () => {
    expect(stageActions(market(MarketPhase.Draft))).toEqual([]);
    expect(stageActions(market(MarketPhase.Assignment, { intakeMode: IntakeMode.Csv }))).toEqual(
      [],
    );
    const refusing = (...rows: MarketAction[]) => ({ actionRefusals: answersRefusing(...rows) });
    expect(
      stageActions(
        market(MarketPhase.Applications, {
          intakeMode: IntakeMode.Csv,
          ...refusing(MarketAction.ImportApplications),
        }),
      ),
    ).toEqual([]);
    expect(
      stageActions(market(MarketPhase.Applications, refusing(MarketAction.StopApplications))),
    ).toEqual([]);
    expect(
      stageActions(market(MarketPhase.Applications, { applicationsStopReason: 'Not now.' })),
    ).toEqual([]);
  });
});

/*
 * The form comes before Review setup (T260). Once the plan asks the essential questions the
 * server's form guard passes, so a draft whose organizer had not drafted from their Google Form, or
 * added a question of their own, was told to decide what reviewers read first. The step names the
 * form first while it is not drafted, with none of the organizer's own questions and no start from
 * a Google Form's responses run; the server's refusal is unchanged.
 */
describe('the form comes before Review setup', () => {
  const HIGHLIGHTS: PreconditionResult = {
    id: 'review_highlights_decided',
    passed: false,
    message: 'Nothing says what a reviewer reads first.',
    resolutionLink: 'form?step=review',
    resolutionLabel: 'Decide what reviewers read first',
    resolutionAction: MarketAction.ChangeForm,
  };
  const REJECTIONS: PreconditionResult = {
    id: 'rejection_rules_decided',
    passed: false,
    message: 'The automatic rejections are not decided.',
    resolutionLink: 'form?step=review',
    resolutionLabel: 'Decide the automatic rejections',
    resolutionAction: MarketAction.ChangeForm,
  };
  const NO_LOCATION: PreconditionResult = {
    id: 'setup_has_a_location',
    passed: false,
    message: 'This market has no location. Add one on Market Setup.',
    resolutionLink: 'setup',
    resolutionLabel: 'Add a location',
    resolutionAction: MarketAction.ChangeSetup,
  };
  const A_QUESTION: ApplicationForm = {
    fields: [{ key: 'shop', label: 'Shop', type: 'text', required: false, options: [], order: 0 }],
  };
  const draft = (overrides: Partial<Market> = {}, blockers = [HIGHLIGHTS, REJECTIONS]) =>
    market(MarketPhase.Draft, {
      transitionBlockers: { applications: blockers, archived: [] },
      ...overrides,
    });

  it('leads to Your questions on a market whose vendors apply on its page', () => {
    for (const applicationForm of [undefined, null, { fields: [] }]) {
      const step = nextStep(draft({ applicationForm } as Partial<Market>), TODAY);

      expect(step.blocker).toMatchObject({
        resolutionLabel: 'Add your questions',
        resolutionLink: 'form?step=questions',
        resolutionAction: MarketAction.ChangeForm,
      });
      expect(step.page).toBe('form?step=questions');
      expect(step.text).toBe(
        'To open applications: Your form asks only the essential questions so far. Add any of ' +
          'your own on Your questions, then decide what reviewers read first on Review setup.',
      );
    }
  });

  it("leads to the start from a Google Form's responses on a Google Form market", () => {
    const step = nextStep(draft({ intakeMode: IntakeMode.Csv }), TODAY);

    expect(step.blocker).toMatchObject({
      resolutionLabel: 'Draft from your Google Form',
      resolutionLink: 'start-from-csv',
      resolutionAction: MarketAction.ImportApplications,
    });
    expect(step.text).toBe(
      "To begin review: Your form asks only the essential questions so far. Draft the rest from your Google Form's responses, then decide what reviewers read first on Review setup.",
    );
  });

  it('leads a Google Form market to Your questions where the start is refused, or not theirs', () => {
    for (const overrides of [
      { csvStartRefusal: 'This market has applications already.' },
      { actionRefusals: EDITOR_ANSWERS },
    ]) {
      const step = nextStep(draft({ intakeMode: IntakeMode.Csv, ...overrides }), TODAY);

      expect(step.blocker?.resolutionLink).toBe('form?step=questions');
      expect(step.action).toBe(MarketAction.ChangeForm);
    }
  });

  it('names whichever Review setup decision is still open after the form', () => {
    const step = nextStep(draft({}, [REJECTIONS]), TODAY);

    expect(step.text).toContain('then decide the automatic rejections on Review setup.');
  });

  it('is Review setup once the form has a question of its own', () => {
    const step = nextStep(draft({ applicationForm: A_QUESTION }), TODAY);

    expect(step.blocker).toEqual(HIGHLIGHTS);
    expect(step.page).toBe('form?step=review');
  });

  it("is Review setup once the start from a Google Form's responses has run, whatever it kept", () => {
    const shop: ExampleColumn = {
      headers: ['Shop'],
      key: 'shop',
      label: 'Shop',
      type: 'text',
      question: false,
      options: { select: [], multiSelect: [] },
    };
    for (const exampleColumns of [[], [shop]]) {
      const started = draft({
        intakeMode: IntakeMode.Csv,
        applicationForm: { fields: [] },
        exampleColumns,
      });

      expect(nextStep(started, TODAY).blocker).toEqual(HIGHLIGHTS);
    }
  });

  it("leaves the plan's own blockers first, and every blocker the server served as it was", () => {
    const planFirst = draft({}, [NO_LOCATION, HIGHLIGHTS]);

    expect(nextStep(planFirst, TODAY).blocker).toEqual(NO_LOCATION);
    expect(firstInTheWay(planFirst, MarketPhase.Applications)).toEqual(NO_LOCATION);
    const formFirst = draft();
    expect(firstInTheWay(formFirst, MarketPhase.Applications)?.id).toBe('form_first');
    expect(blockersFor(formFirst, MarketPhase.Applications)).toEqual([HIGHLIGHTS, REJECTIONS]);
  });
});
