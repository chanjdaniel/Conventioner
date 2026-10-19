#!/usr/bin/env python3
"""Make production's test markets: one of each intake path, in a test organization. For operators.

A check in production - did an applicant's sign-in code arrive, does a Google Form market's sign-in
read as absent - needs markets to run against that are nobody's real market (E32/F03/S03). This
makes them, owned by an operator's own account:

- "Conventioner Test - Online Applications": vendors apply on its page, open for applications.
- "Conventioner Test - Google Form": its vendors are imported, open for importing.

Both are in "Conventioner Test Organization", carry a plan a year out and two plain questions, and
hold no applicant. Every write goes through the product's own (create, the plan, the form, the
judged move), so a seeded market is one the product could have made. Running it again changes
nothing that exists, and finishes a market a failed run left in draft.

Run from ``back-end/`` against the database the environment names - for production, put the URI on
the command line, never in ``back-end/.env``. The owner is an existing account
(``create_account.py`` makes one):

    MONGODB_URI='mongodb+srv://...' .venv/bin/python seed_test_markets.py --owner you@example.com
"""
import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, NamedTuple, Optional

from datatypes import IntakeMode, MarketPhase, MarketRole, market_name_slug

TEST_ORGANIZATION = "Conventioner Test Organization"


class TestMarket(NamedTuple):
    name: str
    intake_mode: IntakeMode


TEST_MARKETS = (
    TestMarket("Conventioner Test - Online Applications", IntakeMode.FORM),
    TestMarket("Conventioner Test - Google Form", IntakeMode.CSV),
)

TEST_FORM_FIELDS: List[Dict[str, Any]] = [
    {"key": "business_name", "label": "Business Name", "type": "text", "required": True,
     "options": [], "order": 0},
    {"key": "product_type", "label": "What do you sell?", "type": "text", "required": True,
     "options": [], "order": 1},
]

_SATURDAY = 5


class SeedError(Exception):
    """Why a test market was not made, in words for the operator."""


def test_plan(today: date) -> Dict[str, Any]:
    """A plan complete enough to leave draft: two Saturdays a year out, one location, tables at
    both tiers. A year out, so a test market stays open for applications long after it is seeded."""
    first = today + timedelta(days=365)
    first += timedelta(days=(_SATURDAY - first.weekday()) % 7)
    dates = [first, first + timedelta(days=7)]
    tiers = [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}]
    location = {"name": "Test Hall"}
    return {
        "priority": [],
        "marketDates": [{"date": day.isoformat()} for day in dates],
        "tiers": tiers,
        "locations": [location],
        "sections": [
            {"name": "Hall A", "count": 6, "location": location, "tier": tiers[0]},
            {"name": "Hall B", "count": 6, "location": location, "tier": tiers[1]},
        ],
        "assignmentOptions": {
            "maxAssignmentsPerVendor": None,
            "maxHalfTableProportionPerSection": None,
        },
        "floorplans": [{
            "tableTypes": [
                {"name": "Full Table", "widthMm": 1800, "heightMm": 800, "maxCapacity": 2},
                {"name": "Half Table", "widthMm": 900, "heightMm": 800, "maxCapacity": 1},
            ],
        }],
    }


def _test_organization(owner_email: str, owner_id: str) -> str:
    import api.organizations as OrgsApi

    existing = OrgsApi.organizations_collection.find_one({"name": TEST_ORGANIZATION})
    if existing is None:
        return OrgsApi.create_organization(owner_email, TEST_ORGANIZATION)
    if existing.get("owner") != owner_id:
        raise SeedError(
            f"{TEST_ORGANIZATION!r} exists and belongs to another account. Seed as its owner."
        )
    return existing["id"]


def _seeded_market(test_market: TestMarket, organization_id: str, owner_email: str,
                   owner_id: str) -> Dict[str, Any]:
    """The stored market for ``test_market``: found by its public address, or created."""
    import api.markets as MarketsApi
    from datatypes import AssignmentObject, Market

    slug = market_name_slug(test_market.name)
    document = MarketsApi.markets_collection.find_one({"slug": slug})
    if document is not None:
        if document.get("organizationId") != organization_id:
            raise SeedError(
                f"The address /{slug} belongs to a market outside {TEST_ORGANIZATION!r}; "
                "nothing was changed."
            )
        return document
    refusal = MarketsApi.organization_refusal(owner_email, organization_id)
    if refusal:
        raise SeedError(refusal)
    _result, market_id = MarketsApi.create_market(Market(
        id="",
        name=test_market.name,
        creation_date=datetime.now(timezone.utc).isoformat(),
        organization_id=organization_id,
        roles={owner_id: MarketRole.OWNER},
        modification_list=[],
        assignment_object=AssignmentObject(),
    ), owner_email)
    return MarketsApi.markets_collection.find_one({"id": market_id})


def seed_test_market(test_market: TestMarket, organization_id: str, owner_email: str,
                     owner_id: str, today: date) -> str:
    """Make ``test_market`` open, or leave it as it stands once it has left draft. Returns its phase."""
    import api.markets as MarketsApi
    from datatypes import phase_from_market_document

    document = _seeded_market(test_market, organization_id, owner_email, owner_id)
    market_id = document["id"]
    if phase_from_market_document(document) != MarketPhase.DRAFT:
        return phase_from_market_document(document).value

    MarketsApi.save_plan(market_id, {
        "setupObject": test_plan(today),
        "intakeMode": test_market.intake_mode.value,
    }, owner_email)
    MarketsApi.save_application_form(market_id, {"fields": TEST_FORM_FIELDS}, owner_email)
    blockers = MarketsApi.take_move(
        MarketsApi.load_market_context(market_id), MarketPhase.APPLICATIONS_OPEN.value,
        by=owner_email,
    )
    if blockers:
        raise SeedError(
            f"{test_market.name!r} could not open: " + " ".join(b.message for b in blockers)
        )
    return MarketPhase.APPLICATIONS_OPEN.value


def seed_test_markets(owner_email: str, today: Optional[date] = None) -> List[str]:
    """Seed every test market for the account ``owner_email``. Returns a line per market."""
    import api.users as UsersApi
    from utils.email import frontend_url

    owner = UsersApi.get_user(owner_email)
    if owner is None:
        raise SeedError(f"No account for {owner_email}. Make one with create_account.py first.")
    organization_id = _test_organization(owner.email, owner.id)
    lines = []
    for test_market in TEST_MARKETS:
        phase = seed_test_market(
            test_market, organization_id, owner.email, owner.id, today or date.today(),
        )
        address = f"{frontend_url()}/{market_name_slug(test_market.name)}"
        lines.append(f"{test_market.name} ({test_market.intake_mode.value}): {phase}, {address}")
    return lines


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--owner", required=True, help="the existing account that owns them")
    args = parser.parse_args(argv)
    try:
        for line in seed_test_markets(args.owner):
            print(line)
    except SeedError as e:
        print(f"Not done: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
