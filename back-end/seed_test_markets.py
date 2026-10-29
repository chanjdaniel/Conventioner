#!/usr/bin/env python3
"""Make production's test markets: one of each intake path, in a test organization. For operators.

A check in production - did an applicant's sign-in code arrive, does a Google Form market's sign-in
read as absent - needs markets to run against that are nobody's real market (E32/F03/S03). This
makes them, owned by an operator's own account:

- "Conventioner Test - Online Applications": vendors apply on its page, open for applications.
- "Conventioner Test - Google Form": its vendors are imported, a draft ready for its first import,
  which takes it into Review.

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

import api.market_actions as Actions
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
from client_errors import ClientError
from datatypes import IntakeMode, MarketPhase, User, market_name_slug
from market_documents import market_doc_field, market_doc_filter

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


def _test_organization(owner: User) -> str:
    existing = OrgsApi.organizations_collection.find_one({"name": TEST_ORGANIZATION})
    if existing is None:
        return OrgsApi.create_organization(owner.email, TEST_ORGANIZATION)
    if existing.get("owner") != owner.id:
        raise SeedError(
            f"{TEST_ORGANIZATION!r} exists and belongs to another account. Seed as its owner."
        )
    return existing["id"]


def _seeded_market(
    test_market: TestMarket, organization_id: str, owner: User,
) -> MarketsApi.MarketContext:
    """The stored market for ``test_market``: found by its public address, or created."""
    slug = market_name_slug(test_market.name)
    found = MarketsApi.markets_collection.find_one(market_doc_filter("slug", slug), {"id": 1})
    if found is None:
        market_id = MarketsApi.create_owned_market(owner, {
            "name": test_market.name,
            "creation_date": datetime.now(timezone.utc).isoformat(),
            "organization_id": organization_id,
            "modification_list": [],
            "assignment_object": {},
        })
    else:
        market_id = found["id"]
    context = MarketsApi.load_market_context(market_id)
    if market_doc_field(context.document, "organization_id") != organization_id:
        raise SeedError(
            f"The address /{slug} belongs to a market outside {TEST_ORGANIZATION!r}; "
            "nothing was changed."
        )
    return context


def seed_test_market(test_market: TestMarket, organization_id: str, owner: User,
                     today: date) -> str:
    """Make ``test_market`` ready for its vendors, or leave it as it stands once it has left draft.
    Returns its phase.

    A market whose vendors apply on its page opens applications. A Google Form market is left a
    draft, planned and with its questions: its first import is its way into Review (E38/F04/S01),
    and an import is the operator's to make.
    """
    context = _seeded_market(test_market, organization_id, owner)
    market_id = context.document["id"]
    if context.market.phase != MarketPhase.DRAFT:
        return context.market.phase.value
    # The move is the table's phase row, as on the rail. The owner may; the endpoint asks, so this
    # does too.
    if not Actions.may(Actions.MOVE_PHASE, owner.email, context.market, context.organization):
        raise SeedError(f"{owner.email} may not move {test_market.name!r}.")

    MarketsApi.save_plan(market_id, {
        "setupObject": test_plan(today),
        "intakeMode": test_market.intake_mode.value,
    }, owner.email)
    MarketsApi.save_application_form(market_id, {"fields": TEST_FORM_FIELDS}, owner.email)
    if test_market.intake_mode is IntakeMode.CSV:
        return MarketPhase.DRAFT.value
    blockers = MarketsApi.take_move(
        MarketsApi.load_market_context(market_id), MarketPhase.APPLICATIONS.value,
        by=owner.email,
    )
    if blockers:
        raise SeedError(
            f"{test_market.name!r} could not open: " + " ".join(b.message for b in blockers)
        )
    return MarketPhase.APPLICATIONS.value


def seed_test_markets(owner_email: str, today: Optional[date] = None) -> List[str]:
    """Seed every test market for the account ``owner_email``. Returns a line per market."""
    owner = UsersApi.get_user(owner_email)
    if owner is None:
        raise SeedError(f"No account for {owner_email}. Make one with create_account.py first.")
    organization_id = _test_organization(owner)
    lines = []
    for test_market in TEST_MARKETS:
        phase = seed_test_market(test_market, organization_id, owner, today or date.today())
        # A path, not an address: the script cannot know which site the database it was given
        # serves, and a production market printed under localhost would be wrong.
        path = f"/{market_name_slug(test_market.name)}"
        lines.append(f"{test_market.name} ({test_market.intake_mode.value}): {phase}, {path}")
    return lines


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--owner", required=True, help="the existing account that owns them")
    args = parser.parse_args(argv)
    try:
        for line in seed_test_markets(args.owner):
            print(line)
    # Every refusal the product's own writes can give, said as the operator's "Not done", never a
    # traceback: a plan or form the server refuses, a role, a race with someone else's move. Each is
    # a client error; anything else is a bug, and its traceback is what the operator needs.
    except (SeedError, ClientError) as e:
        print(f"Not done: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
