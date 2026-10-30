import type { Market } from '@/assets/types/datatypes';

/**
 * Who may do what on a market, as the server answers it for the person looking (E39/F01/S02).
 *
 * The server keeps one table of actions, each saying the lowest role that may take it
 * (`back-end/api/market_actions.py`), and the market read serves every row's answer for the person
 * asking as `actionRefusals`: null where they may, the sentence they would be refused with where
 * not. A screen offers a control on the answer of the action the control takes, and never compares
 * a role itself, so a row changed on the server reaches every screen without touching one.
 */

/** Every row of the server's table, by its id, in the table's order. */
export const MarketAction = {
  Read: 'read',
  ReadHistory: 'read-history',
  ExportCsv: 'export-csv',
  ChangeSetup: 'change-setup',
  ChangeForm: 'change-form',
  ImportApplications: 'import-applications',
  GiveVerdicts: 'give-verdicts',
  ChangeVerdicts: 'change-verdicts',
  ChooseReviewers: 'choose-reviewers',
  MovePhase: 'move-phase',
  StopApplications: 'stop-applications',
  PublishResults: 'publish-results',
  AddVendor: 'add-vendor',
  WriteVendorNotes: 'write-vendor-notes',
  UpdateVendorInfo: 'update-vendor-info',
  Assign: 'assign',
  CheckIn: 'check-in',
  ConnectDiscord: 'connect-discord',
  ManageEditorsAndViewers: 'manage-editors-and-viewers',
  ManageAdmins: 'manage-admins',
  DeleteMarket: 'delete-market',
  ChangeTheTable: 'change-the-table',
} as const;

export type MarketAction = (typeof MarketAction)[keyof typeof MarketAction];

/**
 * Said of an action the market in hand carries no answer for: a read that predates the action, or
 * no market at all. Nothing is offered on a missing answer, since the server would refuse it.
 */
export const UNANSWERED = 'This is not yours to do on this market.';

/** Why this person may not take this action on this market, or null when they may. */
export function actionRefusal(
  market: Pick<Market, 'actionRefusals'> | null | undefined,
  action: MarketAction,
): string | null {
  const answers = market?.actionRefusals;
  if (!answers || !(action in answers)) return UNANSWERED;
  return answers[action] ?? null;
}

/** Whether this person may take this action on this market. */
export function mayTake(
  market: Pick<Market, 'actionRefusals'> | null | undefined,
  action: MarketAction,
): boolean {
  return actionRefusal(market, action) === null;
}
