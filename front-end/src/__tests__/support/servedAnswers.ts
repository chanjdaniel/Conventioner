import { MarketAction } from '@/utils/marketActions';

/**
 * The table's answers as the market read serves them (`actionRefusals`, E39/F01/S02): every action
 * allowed but those named, each refused with a sentence that names it. A market fixture without
 * them is one whose screens offer nothing, as a read that carried no answer would.
 */
export function answersRefusing(...refused: MarketAction[]): Record<string, string | null> {
  return Object.fromEntries(
    Object.values(MarketAction).map((action) => [
      action,
      refused.includes(action) ? `Only someone else may ${action}.` : null,
    ]),
  );
}

/** What a Viewer is served by the built-in table: reading and exporting, nothing else. */
export const VIEWER_ANSWERS = answersRefusing(
  ...Object.values(MarketAction).filter(
    (action) =>
      action !== MarketAction.Read &&
      action !== MarketAction.ReadHistory &&
      action !== MarketAction.ExportCsv,
  ),
);

/** What an Editor is served by the built-in table: everything an Admin may do is refused. */
export const EDITOR_ANSWERS = answersRefusing(
  MarketAction.ImportApplications,
  MarketAction.ChangeVerdicts,
  MarketAction.ChooseReviewers,
  MarketAction.MovePhase,
  MarketAction.StopApplications,
  MarketAction.PublishResults,
  MarketAction.UpdateAssignmentOrPriceInfo,
  MarketAction.ChangeOwed,
  MarketAction.AdjustPaid,
  MarketAction.ConnectDiscord,
  MarketAction.ManageEditorsAndViewers,
  MarketAction.ManageAdmins,
  MarketAction.DeleteMarket,
  MarketAction.ChangeTheTable,
);

/** What an Admin is served by the built-in table: only the Owner's rows are refused. */
export const ADMIN_ANSWERS = answersRefusing(
  MarketAction.ManageAdmins,
  MarketAction.DeleteMarket,
  MarketAction.ChangeTheTable,
);
