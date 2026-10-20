"""What an applicant is told when results are published: a table, or none (E36/F05/S02).

Read off the STORED seats, never the verdict: a rejected applicant seated by hand has a table, and an
approved one the run could not place has none. Two outcomes and no reason, so rejected and
approved-without-a-seat read the same (decision 13 of the rejection-visibility map). The publish
confirmation counts them (E36/F04/S01) by the same rule the applicant's page reads.
"""
from typing import Dict, Set

import api.applications as ApplicationsApi
from datatypes import ApplicationType, Market
from utils.email_address import normalized_email

HAS_A_TABLE = "has_a_table"
NOT_ASSIGNED = "not_assigned"


def seated_addresses(market: Market) -> Set[str]:
    """Everyone the stored assignment gives a seat on any date."""
    return {
        normalized_email(placement.email)
        for placement in market.assignment_object.vendor_assignments or []
        if placement.email
    }


def outcome_of(address: str, seated: Set[str]) -> str:
    """One applicant's outcome."""
    return HAS_A_TABLE if normalized_email(address) in seated else NOT_ASSIGNED


def outcome_counts(market: Market) -> Dict[str, int]:
    """How many of the market's applicants will read each outcome."""
    seated = seated_addresses(market)
    counts = {"haveATable": 0, "notAssigned": 0}
    for document in ApplicationsApi.list_applications_for_market(market.id):
        kind = document.get("application_type") or ApplicationType.MAIN.value
        if kind != ApplicationType.MAIN.value:
            continue
        has = outcome_of(document.get("applicant_email") or "", seated) == HAS_A_TABLE
        counts["haveATable" if has else "notAssigned"] += 1
    return counts
