/**
 * What a market's screens say, phase by phase and path by path (E31/F02/S02, F03).
 *
 * Ticket 02 of the "what to show, and when" map: the walk found every screen offering what the
 * market could not do yet, refusing only after the click, and a CSV market wearing the form
 * path's words for steps no vendor ever sees.
 */
import { describe, expect, it } from 'vitest';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { phaseSpine } from '@/utils/phase';
import { IMPORTING_SERVED, movesServedFrom } from './support/servedMoves';
import {
  currentPage,
  forwardFrom,
  landingPage,
  spineFor,
  intakeModeOf,
  nextStep,
  pathPhaseLabel,
  pathTabLabel,
  pathTransitionLabel,
  tabNote,
} from '@/utils/marketGuide';
import { TAB_LABELS } from '@/utils/marketPage';

const TODAY = '2099-05-10';

function market(phase: MarketPhase, overrides: Partial<Market> = {}): Market {
  return {
    id: 'm1',
    name: 'Riverside',
    phase,
    intakeMode: IntakeMode.Form,
    setupObject: { marketDates: [{ date: '2099-05-20' }] },
    assignmentObject: { vendorAssignments: [] },
    transitionBlockers: movesServedFrom(phase),
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
  it('names its importing for what it is, and the form path keeps its own (E32/F02/S01)', () => {
    expect(pathPhaseLabel(MarketPhase.ApplicationsOpen, IntakeMode.Csv)).toBe('Import');
    // Shown only for a market moved there by the single edge: its responses are in.
    expect(pathPhaseLabel(MarketPhase.ApplicationsClosed, IntakeMode.Csv)).toBe('Imported');
    expect(pathPhaseLabel(MarketPhase.ApplicationsOpen, IntakeMode.Form)).toBe('Applications Open');
  });

  it('names the moves for what the organizer does on each path', () => {
    const draft = MarketPhase.Draft;
    const open = MarketPhase.ApplicationsOpen;
    const closed = MarketPhase.ApplicationsClosed;
    const review = MarketPhase.Review;
    expect(pathTransitionLabel(draft, open, IntakeMode.Csv)).toBe('Import responses');
    expect(pathTransitionLabel(open, review, IntakeMode.Csv)).toBe('Begin Review');
    expect(pathTransitionLabel(review, open, IntakeMode.Csv)).toBe('Import more responses');
    expect(pathTransitionLabel(draft, open, IntakeMode.Form)).toBe('Open Applications');
    expect(pathTransitionLabel(open, closed, IntakeMode.Form)).toBe('Close Applications');
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
        applications_open: [
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
      page: 'assignment',
    });
    const run = market(MarketPhase.Assignment, {
      assignmentObject: { vendorAssignments: [{ email: 'a@example.com' }] },
    } as Partial<Market>);
    expect(nextStep(run, TODAY)).toMatchObject({ page: 'result' });
    expect(nextStep(run, TODAY).text).toMatch(/cannot be undone/);
  });

  it('once the results are published, says the result is settled (E36/F04/S02)', () => {
    const told = market(MarketPhase.Assignment, {
      assignmentObject: { vendorAssignments: [{ email: 'a@example.com' }] },
      resultsPublished: true,
    } as Partial<Market>);

    expect(nextStep(told, TODAY).text).toBe(
      'Results are published, so the result is settled. Publish the market to put the check-in page up; that cannot be undone.',
    );
  });

  it('in review, says nothing more is coming in before the work left', () => {
    const undecided = {
      transitionBlockers: {
        assignment: [
          {
            id: 'all_applications_reviewed',
            passed: false,
            message: '2 applications are still awaiting review.',
            resolutionLink: 'applications',
          },
        ],
      },
    };
    expect(nextStep(market(MarketPhase.Review, undecided), TODAY)).toMatchObject({
      text: 'Nothing more is coming in. Finish deciding: 2 applications are still awaiting review.',
      page: 'applications',
    });
    const csv = market(MarketPhase.Review, { ...undecided, intakeMode: IntakeMode.Csv });
    // More can still be imported, from the rail's menu (E32/F02/S02), so it says only what is so.
    expect(nextStep(csv, TODAY).text).toMatch(
      /^Every imported response is here\. Finish deciding: /,
    );
    const noTables = market(MarketPhase.Review, {
      transitionBlockers: {
        assignment: [{ id: 'no_empty_tier', passed: false, message: 'Tier Gold has no tables.' }],
      },
    });
    expect(nextStep(noTables, TODAY).text).toBe(
      'Nothing more is coming in. To begin assignment: Tier Gold has no tables.',
    );
  });

  it('names where applications are open, on the form path', () => {
    expect(nextStep(market(MarketPhase.ApplicationsOpen), TODAY).text).toMatch(
      /^Applications are open on your application page\./,
    );
  });

  it('points an archive that ran at the record its check-in page keeps', () => {
    const ran = market(MarketPhase.Archived, { phasesReached: [MarketPhase.MarketDays] });
    expect(nextStep(ran, TODAY)).toMatchObject({ page: null });
    expect(nextStep(ran, TODAY).text).toMatch(/check-in page/);
    expect(nextStep(market(MarketPhase.Archived), TODAY).text).not.toMatch(/check-in page/);
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
      text: 'Check vendors in at the door.',
      page: 'attendance',
    });
    expect(nextStep(market(MarketPhase.MarketDays), '2099-06-01').text).toMatch(/Archive it/);
  });
});

describe('the step onward', () => {
  it('is archiving once a running market has had its last day, and none before', () => {
    expect(forwardFrom(market(MarketPhase.MarketDays), TODAY)).toBeNull();
    expect(forwardFrom(market(MarketPhase.MarketDays), '2099-05-21')).toBe(MarketPhase.Archived);
  });

  it('is the spine step elsewhere', () => {
    expect(forwardFrom(market(MarketPhase.Review), TODAY)).toBe(MarketPhase.Assignment);
  });
});

describe('a tab out of its phase says when it matters', () => {
  it('says applications arrive once they open, in the words of each path', () => {
    expect(tabNote(market(MarketPhase.Draft), 'applications')).toMatch(/once they open/);
    expect(
      tabNote(market(MarketPhase.Draft, { intakeMode: IntakeMode.Csv }), 'applications'),
    ).toMatch(/once the market leaves draft/);
    expect(tabNote(market(MarketPhase.ApplicationsOpen), 'applications')).toBeNull();
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

describe('the Google Form path: Plan, Import, Review (E32/F02/S01)', () => {
  const csv = (phase: MarketPhase, overrides: Partial<Market> = {}) =>
    market(phase, { intakeMode: IntakeMode.Csv, ...overrides });

  const PASSED = IMPORTING_SERVED.phasesPassedThrough;

  it('draws no "form closed" stage, which the path steps through', () => {
    expect(spineFor(MarketPhase.ApplicationsOpen, PASSED)).toEqual([
      'draft',
      'applications_open',
      'review',
      'assignment',
      'market_days',
      'archived',
    ]);
    expect(spineFor(MarketPhase.ApplicationsOpen, [])).toContain('applications_closed');
  });

  it('gives a market standing in that phase its stage back, as its responses imported', () => {
    expect(spineFor(MarketPhase.ApplicationsClosed, PASSED)).toContain('applications_closed');
    expect(pathPhaseLabel(MarketPhase.ApplicationsClosed, IntakeMode.Csv)).toBe('Imported');
    expect(nextStep(csv(MarketPhase.ApplicationsClosed), TODAY).text).not.toMatch(/closed/i);
  });

  it('moves on from importing to review, as the read serves the move', () => {
    expect(forwardFrom(csv(MarketPhase.ApplicationsOpen, IMPORTING_SERVED), TODAY)).toBe(
      MarketPhase.Review,
    );
    expect(forwardFrom(market(MarketPhase.ApplicationsOpen), TODAY)).toBe(
      MarketPhase.ApplicationsClosed,
    );
  });

  it('lands a move into importing on the import itself', () => {
    expect(landingPage(MarketPhase.ApplicationsOpen, false, IntakeMode.Csv)).toBe('import');
    expect(landingPage(MarketPhase.ApplicationsOpen, false, IntakeMode.Form)).toBe('applications');
    // The tab's dot stays on Applications, where the imported responses are reviewed.
    expect(currentPage(MarketPhase.ApplicationsOpen, false)).toBe('applications');
  });

  it('says to import, never to collect', () => {
    for (const phase of [MarketPhase.Draft, MarketPhase.ApplicationsOpen]) {
      expect(nextStep(csv(phase), TODAY).text, phase).not.toMatch(/collect/i);
    }
    expect(tabNote(csv(MarketPhase.Draft), 'applications')).not.toMatch(/collect/i);
  });
});
