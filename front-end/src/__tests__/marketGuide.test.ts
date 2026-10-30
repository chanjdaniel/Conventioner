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
import { movesServedFrom } from './support/servedMoves';
import { answersRefusing } from './support/servedAnswers';
import { MarketAction } from '@/utils/marketActions';
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
  stageActions,
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
    expect(pathTransitionLabel(draft, stage, IntakeMode.Csv)).toBe('Begin Review');
    expect(pathTransitionLabel(draft, stage, IntakeMode.Form)).toBe('Open Applications');
    expect(pathTransitionLabel(stage, draft, IntakeMode.Form)).toBe('Reopen for Editing');
    expect(pathTransitionLabel(stage, MarketPhase.Assignment, IntakeMode.Csv)).toBe(
      'Begin Assignment',
    );
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
      'Results are published, so the assignments are settled. Publish the market to put the check-in page up; that cannot be undone.',
    );
  });

  it('in the stage, says what is arriving before the work left', () => {
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
    expect(nextStep(market(MarketPhase.Applications, undecided), TODAY)).toMatchObject({
      text: 'Applications are open on your application page: review them as they arrive. Finish deciding: 2 applications are still awaiting review.',
      page: 'applications',
    });
    const stopped = market(MarketPhase.Applications, { ...undecided, applicationsStopped: true });
    expect(nextStep(stopped, TODAY).text).toMatch(
      /^Your application page is not taking applications\. Finish deciding: /,
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
      'Your application page is not taking applications. To begin assignment: Tier Gold has no tables.',
    );
  });

  it('names where applications are open, on the form path', () => {
    expect(nextStep(market(MarketPhase.Applications), TODAY).text).toMatch(
      /^Applications are open on your application page/,
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
