import type { Router } from 'vue-router';
import { api } from '@/utils/api';
import {
  type ApplicationForm,
  type Market,
  MarketPhase,
  MarketRole,
} from '@/assets/types/datatypes';

/**
 * Where a market opens: its own screens, in every phase.
 *
 * This used to branch. A market in `market_days` or `archived` was sent to `/<slug>`, "the public
 * page it serves" - except that `/<slug>` is gated by `applicant_intake_market_by_slug` to
 * form-intake markets only, and every MVP market is CSV. So Open on a published market landed on
 * "Page not found", while its check-in page - the thing the organizer was trying to reach - was
 * working the whole time. The gate exists precisely so a CSV market serves no public page; the
 * branch described one that does not exist.
 *
 * There is nothing to branch on. A published market has plenty to show on its own screens, the
 * check-in URL among it, and sending every phase to the same place is one fewer thing that can be
 * wrong about a phase.
 */
export const MARKET_HOME_PATH = '/market-setup';

/** Make this the open market and go to it. The three lists that open a market all did this by hand. */
export function openMarket(router: Router, market: Market): void {
  localStorage.setItem('market', JSON.stringify(market));
  router.push(MARKET_HOME_PATH);
}

/**
 * Every market this account can reach, newest payload from the server.
 *
 * Four screens asked for this list and three of them spelled the request out again; the fourth
 * pushed onto a ref in a loop. It lives here beside `parseMarketFromApi` because the parse is the
 * only interesting half, and a caller that forgets it gets raw API shapes with snake_case keys.
 *
 * Note what the endpoint answers: markets the caller can REACH, which includes ones reached
 * through an organization as a viewer. It is not a list of markets they own, and copy drawn from
 * its length should not say so.
 */
export async function fetchMarkets(): Promise<Market[]> {
  const response = await api.get('/markets');
  return ((response.data.markets || []) as unknown[]).map(parseMarketFromApi);
}

/**
 * Normalize a market payload from the API (camelCase or snake_case) into a `Market`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMarketFromApi(market: any): Market {
  const userRoleRaw = market.userRole ?? market.user_role;
  const creationDate = market.creationDate ?? market.creation_date;
  const rolesRaw = market.roles || {};
  const roles: Record<string, MarketRole> = {};
  for (const [userId, role] of Object.entries(rolesRaw)) {
    const r = String(role).toLowerCase();
    if (r === 'owner' || r === 'admin' || r === 'editor' || r === 'viewer') {
      roles[userId] = r as MarketRole;
    }
  }
  const roleEmails = market.roleEmails ?? market.role_emails ?? {};
  const phaseRaw = market.phase;
  const applicationForm = market.applicationForm ?? market.application_form;
  return {
    id: market.id,
    name: market.name,
    // The market's public identifier, computed and persisted server-side (`Market.slug`). Kept
    // rather than recomputed from the name, so the rail's check-in URL is the URL the server
    // would actually serve (E10/F01/S02).
    slug: market.slug ?? undefined,
    creationDate,
    roles,
    roleEmails,
    organizationId: market.organizationId ?? market.organization_id ?? undefined,
    organizationName: market.organizationName ?? market.organization_name ?? market.organization,
    theme: market.theme,
    userRole: userRoleRaw ? (userRoleRaw as MarketRole) : undefined,
    isDraft: phaseRaw
      ? (phaseRaw as MarketPhase) === 'draft'
      : (market.isDraft ?? market.is_draft ?? true),
    phase: phaseRaw ? (phaseRaw as MarketPhase) : undefined,
    setupObject: {
      priority: market.setupObject?.priority || [],
      marketDates: market.setupObject?.marketDates || [],
      tiers: market.setupObject?.tiers || [],
      locations: market.setupObject?.locations || [],
      sections: market.setupObject?.sections || [],
      assignmentOptions: {
        maxAssignmentsPerVendor:
          market.setupObject?.assignmentOptions?.maxAssignmentsPerVendor ?? null,
        maxHalfTableProportionPerSection:
          market.setupObject?.assignmentOptions?.maxHalfTableProportionPerSection ?? null,
      },
    },
    modificationList: market.modificationList || [],
    assignmentObject: market.assignmentObject || {
      vendorAssignments: [],
      assignmentDate: '',
      totalVendorsAssigned: 0,
      totalTablesAssigned: 0,
      assignmentStatistics: null,
    },
    applicationForm: applicationForm ? (applicationForm as ApplicationForm) : undefined,
    reviewConfig: market.reviewConfig ?? market.review_config ?? undefined,
    // Which answers a reviewer reads first (E19/F03/S01). Absent means nothing is marked, which
    // renders the card exactly as it did before this existed.
    reviewHighlights: (market.reviewHighlights ?? market.review_highlights ?? []) as string[],
  };
}
