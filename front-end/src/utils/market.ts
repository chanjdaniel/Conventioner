import { type Market, MarketRole } from '@/assets/types/datatypes';
import { marketNameToKebabSlug } from '@/utils/marketSlug';

/**
 * Where to send the user after choosing a market (draft → setup, else → kebab URL).
 */
export function pathAfterLoadingMarket(market: Market): string {
    if (market.isDraft === false) {
        const slug = marketNameToKebabSlug(market.name);
        if (slug) return `/${slug}`;
    }
    return '/market-setup';
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
    return {
        id: market.id,
        name: market.name,
        creationDate,
        roles,
        roleEmails,
        organizationId: market.organizationId ?? market.organization_id ?? undefined,
        organizationName: market.organizationName ?? market.organization_name ?? market.organization,
        theme: market.theme,
        userRole: userRoleRaw ? (userRoleRaw as MarketRole) : undefined,
        isDraft: market.isDraft ?? market.is_draft ?? true,
        setupObject: {
            colNames: market.setupObject?.colNames || [],
            colValues: market.setupObject?.colValues || [],
            colInclude: market.setupObject?.colInclude || [],
            enumPriorityOrder: market.setupObject?.enumPriorityOrder || [],
            priority: market.setupObject?.priority || [],
            marketDates: market.setupObject?.marketDates || [],
            tiers: market.setupObject?.tiers || [],
            locations: market.setupObject?.locations || [],
            sections: market.setupObject?.sections || [],
            assignmentOptions: {
                maxAssignmentsPerVendor: market.setupObject?.assignmentOptions?.maxAssignmentsPerVendor ?? null,
                maxHalfTableProportionPerSection:
                    market.setupObject?.assignmentOptions?.maxHalfTableProportionPerSection ?? null,
                emailColNameIdx:
                    market.setupObject?.assignmentOptions?.emailColNameIdx ??
                    market.setupObject?.assignmentOptions?.email_col_name_idx ??
                    null,
                tableChoiceColNameIdx:
                    market.setupObject?.assignmentOptions?.tableChoiceColNameIdx ??
                    market.setupObject?.assignmentOptions?.table_choice_col_name_idx ??
                    null,
                tableShareEmailColNameIdx:
                    market.setupObject?.assignmentOptions?.tableShareEmailColNameIdx ??
                    market.setupObject?.assignmentOptions?.table_share_email_col_name_idx ??
                    null,
                maxDaysColNameIdx:
                    market.setupObject?.assignmentOptions?.maxDaysColNameIdx ??
                    market.setupObject?.assignmentOptions?.max_days_col_name_idx ??
                    null,
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
    };
}
