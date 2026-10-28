"""An organization's owner and admins run every market it holds (T15, decision/2026-10-20).

Membership alone gave Viewer on an organization's markets, even to its owner and admins, so an
admin of the organization running the market saw the seats and could not swap one. A member still
reads; a role on the market itself still counts, and the higher of the two is the one held.
"""
from types import SimpleNamespace

import pytest

from conftest import stored_market
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi
from client_errors import BadRequestError, ForbiddenError
from datatypes import MarketPhase, MarketRole, Organization

ORG_ID = "org-1"
MARKET_OWNER = "user-1"
ORG_OWNER = "org-owner"
ORG_ADMIN = "org-admin"
ORG_MEMBER = "org-member"
OUTSIDER = "outsider"


def organization(org_id=ORG_ID):
    return Organization(
        id=org_id, name="Test Org", owner=ORG_OWNER, admins=[ORG_ADMIN], members=[ORG_MEMBER],
        markets=["market-123"],
    )


def market(roles=None, phase=MarketPhase.MARKET_DAYS):
    return MarketsApi.market_from_document(stored_market(
        phase, organizationId=ORG_ID, roles={MARKET_OWNER: "owner", **(roles or {})},
    ))


@pytest.fixture(autouse=True)
def users(monkeypatch):
    """Every address is the user id it names, so a test reads as who is asking."""
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(id=email, email=email))


@pytest.mark.parametrize("who,held", [
    (ORG_OWNER, MarketRole.ADMIN),
    (ORG_ADMIN, MarketRole.ADMIN),
    (ORG_MEMBER, MarketRole.VIEWER),
    (OUTSIDER, None),
])
def test_what_an_organization_role_gives_on_its_markets(who, held):
    assert PermissionsApi.get_user_market_role(who, market(), organization()) == held


@pytest.mark.parametrize("who,on_the_market,held", [
    # An organization admin once given Viewer on the market is not held to it.
    (ORG_ADMIN, "viewer", MarketRole.ADMIN),
    # A member given Editor on one market edits that market.
    (ORG_MEMBER, "editor", MarketRole.EDITOR),
    # An outsider given Editor holds Editor, and nothing more.
    (OUTSIDER, "editor", MarketRole.EDITOR),
])
def test_the_higher_of_the_two_roles_is_the_one_held(who, on_the_market, held):
    roles = {who: on_the_market}

    assert PermissionsApi.get_user_market_role(who, market(roles), organization()) == held


def test_the_market_owner_is_still_its_owner_when_also_an_organization_admin():
    org = organization()
    org.admins.append(MARKET_OWNER)

    assert PermissionsApi.get_user_market_role(MARKET_OWNER, market(), org) == MarketRole.OWNER


def test_an_admin_of_another_organization_gets_nothing_here():
    other = organization("org-2")

    assert PermissionsApi.get_user_market_role(ORG_ADMIN, market(), other) is None


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN])
def test_an_organization_admin_may_change_the_market_and_take_its_admin_actions(who):
    assert MarketsApi.change_refusal(who, market(), organization()) is None
    assert MarketsApi.admin_actions_refusal(who, market(), organization()) is None


def test_an_organization_member_still_only_reads():
    assert MarketsApi.change_refusal(ORG_MEMBER, market(), organization()) == (
        MarketsApi.VIEWER_REFUSAL
    )


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN])
def test_an_organization_admin_is_not_the_market_owner(who):
    """Deleting the market and handing over its ownership stay with the one person who owns it."""
    assert not PermissionsApi.user_has_permission(
        who, market(), MarketRole.OWNER, organization()
    )


class FakeMarkets:
    def __init__(self, docs):
        self.docs = docs
        self.reads = 0

    def find(self, query):
        self.reads += 1
        (key, condition), = query.items()
        if key.startswith("roles."):
            uid = key.split(".", 1)[1]
            return [doc for doc in self.docs if uid in doc.get("roles", {})]
        return [doc for doc in self.docs if doc.get(key) in condition["$in"]]


@pytest.fixture
def listing(monkeypatch):
    """The Markets list for one person, over one market of the organization."""
    org = {**organization().model_dump(), "_id": "mongo-org-1"}
    docs = []
    markets = FakeMarkets(docs)
    organization_reads = []
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda uid: SimpleNamespace(id=uid, email=uid))
    monkeypatch.setattr(
        OrgsApi, "get_organizations_for_user",
        lambda email: [org] if email in (ORG_OWNER, ORG_ADMIN, ORG_MEMBER) else [],
    )
    monkeypatch.setattr(
        OrgsApi, "get_organization",
        lambda oid: organization_reads.append(oid) or (org if oid == ORG_ID else None),
    )

    def listed(who, roles=None):
        roles = {MARKET_OWNER: "owner", **(roles or {})}
        docs[:] = [{**stored_market(organizationId=ORG_ID, roles=roles), "_id": "mongo-market-123"}]
        (entry,) = MarketsApi.get_markets_for_user(who)
        return entry["user_role"]

    listed.markets = markets
    listed.organization_reads = organization_reads
    return listed


@pytest.mark.parametrize("who,roles,held", [
    (ORG_ADMIN, None, "admin"),
    (ORG_OWNER, None, "admin"),
    (ORG_MEMBER, None, "viewer"),
    (ORG_ADMIN, {ORG_ADMIN: "viewer"}, "admin"),
    (ORG_MEMBER, {ORG_MEMBER: "editor"}, "editor"),
    (MARKET_OWNER, None, "owner"),
    (OUTSIDER, {OUTSIDER: "editor"}, "editor"),
])
def test_the_markets_list_names_the_role_the_market_itself_serves(listing, who, roles, held):
    """The card offers Manage to an admin; it must not call an organization admin a viewer."""
    assert listing(who, roles) == held


@pytest.mark.parametrize("who,roles", [
    (ORG_ADMIN, None),
    (ORG_ADMIN, {ORG_ADMIN: "viewer"}),
])
def test_naming_the_role_costs_the_list_no_extra_read(listing, who, roles):
    """The organization comes from the list's own memo, seeded by the person's organizations."""
    listing(who, roles)

    assert listing.organization_reads == []
    assert listing.markets.reads == 2


MARKET_ADMIN = "market-admin"
EDITOR = "market-editor"
VIEWER = "market-viewer"


@pytest.fixture
def roles_on_the_market(monkeypatch):
    """One market of the organization with an Owner, an Admin, an Editor and a Viewer on it.

    Returns the roles as the last write left them.
    """
    doc = stored_market(
        MarketPhase.MARKET_DAYS, organizationId=ORG_ID,
        roles={MARKET_OWNER: "owner", MARKET_ADMIN: "admin", EDITOR: "editor", VIEWER: "viewer"},
    )

    def load(_market_id):
        return MarketsApi.MarketContext(
            doc, MarketsApi.market_from_document(doc), organization(), organization().model_dump(),
        )

    class Markets:
        def update_one(self, _query, update):
            doc["roles"] = dict(update["$set"]["roles"])
            return SimpleNamespace(modified_count=1)

    monkeypatch.setattr(MarketsApi, "load_market_context", load)
    monkeypatch.setattr(MarketsApi, "markets_collection", Markets())
    return lambda: dict(doc["roles"])


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN, MARKET_ADMIN])
@pytest.mark.parametrize("target", [MARKET_OWNER, MARKET_ADMIN, EDITOR, VIEWER])
def test_adding_someone_already_on_the_market_changes_nothing(roles_on_the_market, who, target):
    """"Add user" with an address already on the market would overwrite its role, the Owner's too.

    Changing a role is the role change's, where the Owner and the market's Admins are guarded.
    """
    before = roles_on_the_market()

    with pytest.raises(BadRequestError, match="already has a role on this market"):
        MarketsApi.add_market_role("market-123", target, MarketRole.VIEWER, who)

    assert roles_on_the_market() == before


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN])
@pytest.mark.parametrize("role", [MarketRole.EDITOR, MarketRole.VIEWER])
def test_an_organization_admin_adds_an_editor_or_a_viewer(roles_on_the_market, who, role):
    MarketsApi.add_market_role("market-123", "newcomer", role, who)

    assert roles_on_the_market()["newcomer"] == role.value


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN])
def test_an_organization_admin_does_not_add_a_market_admin(roles_on_the_market, who):
    """Raising someone to Admin stays the market owner's, as it is for the market's own Admins."""
    with pytest.raises(ForbiddenError):
        MarketsApi.add_market_role("market-123", "newcomer", MarketRole.ADMIN, who)

    assert "newcomer" not in roles_on_the_market()


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN])
@pytest.mark.parametrize("target,new_role", [(EDITOR, MarketRole.VIEWER), (VIEWER, MarketRole.EDITOR)])
def test_an_organization_admin_changes_an_editor_or_a_viewer(roles_on_the_market, who, target, new_role):
    MarketsApi.update_market_role("market-123", target, new_role, who)

    assert roles_on_the_market()[target] == new_role.value


@pytest.mark.parametrize("who", [ORG_OWNER, ORG_ADMIN, MARKET_ADMIN])
@pytest.mark.parametrize("target", [MARKET_OWNER, MARKET_ADMIN])
def test_only_the_owner_changes_the_owner_or_an_admin(roles_on_the_market, who, target):
    with pytest.raises(ForbiddenError):
        MarketsApi.update_market_role("market-123", target, MarketRole.VIEWER, who)

    assert roles_on_the_market()[target] == ("owner" if target == MARKET_OWNER else "admin")
