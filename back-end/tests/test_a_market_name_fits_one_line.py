"""A market's name is at most 100 characters, on one line (T273, R14).

The name is the market's heading on every screen and its words in the vendor's sign-in code mail.
It had no rule: reproduced on a worktree stack through the routes, a create with a 300-character
name answered 201 and a rename to "Spring\\nFair" answered 200, and both were stored.
Only a create or a rename is judged; a name stored before the rule keeps loading and listing.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeSlugMarketsCollection, skip_without_real_dependencies, stored_market

skip_without_real_dependencies()

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import history as History
from test_an_exception_never_reaches_a_client import NEW_MARKET, client, organization  # noqa: F401
from test_the_market_list_shows_what_the_read_serves import (  # noqa: F401
    MEMBER, READABLE_BY_ORGANIZATION, listed, signed_in, world,
)

TOO_LONG = "A market's name can be at most 100 characters."
NOT_ONE_LINE = "A market's name must be on one line."
BLANK = "A market needs a name."


class CapturingMarkets(FakeSlugMarketsCollection):
    """The markets collection, keeping each document a create inserts."""

    def __init__(self, docs):
        super().__init__(docs)
        self.inserted = []

    def insert_one(self, document):
        self.inserted.append(document)
        return SimpleNamespace(inserted_id="fake-id")


@pytest.fixture
def markets(client, organization, monkeypatch):  # noqa: F811
    """A signed-in owner's organization and its one draft market, "Spring Market"."""
    organization()
    collection = CapturingMarkets([stored_market(name="Spring Market", id="market-123")])
    monkeypatch.setattr(MarketsApi, "markets_collection", collection)
    monkeypatch.setattr(MarketsApi, "db", {"organizations": SimpleNamespace(
        update_one=lambda *_args, **_kwargs: None)})
    monkeypatch.setattr(MarketsApi, "_organization_default_rows", lambda _org: {})
    monkeypatch.setattr(History, "record_for_organization", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(History, "record", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)
    return collection


def create(client, name):  # noqa: F811
    return client.post("/markets", json={**NEW_MARKET, "name": name})


def rename(client, name):  # noqa: F811
    return client.put("/markets/market-123/name", json={"name": name})


REFUSED = [
    pytest.param("L" * 101, TOO_LONG, id="101 characters"),
    pytest.param("Spring\nFair", NOT_ONE_LINE, id="a line break"),
    pytest.param("Spring\r\nFair", NOT_ONE_LINE, id="a CRLF"),
    pytest.param("Spring\tFair", NOT_ONE_LINE, id="a tab"),
    pytest.param("Spring Fair\n", NOT_ONE_LINE, id="a line break at the end"),
    pytest.param("Spring\x00Fair", NOT_ONE_LINE, id="a NUL"),
    pytest.param("", BLANK, id="empty"),
    pytest.param("   ", BLANK, id="blank"),
]


class TestCreating:
    def test_a_hundred_characters_are_a_name(self, client, markets):  # noqa: F811
        response = create(client, "L" * 100)

        assert response.status_code == 201, response.get_json()
        [document] = markets.inserted
        assert document["name"] == "L" * 100

    @pytest.mark.parametrize("name, refusal", REFUSED)
    def test_a_name_that_breaks_the_rule_is_refused_in_words(self, client, markets, name, refusal):  # noqa: F811
        response = create(client, name)

        assert response.status_code == 400
        assert response.get_json() == {"error": refusal}
        assert markets.inserted == []

    def test_the_length_is_judged_without_the_ends_and_the_name_kept_as_given(self, client, markets):  # noqa: F811
        response = create(client, "  " + "L" * 100 + "  ")

        assert response.status_code == 201, response.get_json()
        [document] = markets.inserted
        assert document["name"] == "  " + "L" * 100 + "  "

    def test_characters_are_counted_not_bytes(self, client, markets):  # noqa: F811
        response = create(client, "é" * 100)

        assert response.status_code == 201, response.get_json()

    def test_the_name_rule_is_asked_before_the_address_rule(self, client, markets):  # noqa: F811
        response = create(client, "Spring Market" + "!" * 100)

        assert response.get_json() == {"error": TOO_LONG}

    def test_a_taken_address_is_still_refused(self, client, markets):  # noqa: F811
        response = create(client, "Spring Market")

        assert response.status_code == 400
        assert "web address" in response.get_json()["error"]


class TestRenaming:
    def test_a_hundred_characters_are_a_name_stored_trimmed(self, client, markets):  # noqa: F811
        response = rename(client, "  " + "L" * 100 + "  ")

        assert response.status_code == 200, response.get_json()
        assert markets.last_update["$set"]["name"] == "L" * 100

    @pytest.mark.parametrize("name, refusal", REFUSED)
    def test_a_name_that_breaks_the_rule_is_refused_in_words(self, client, markets, name, refusal):  # noqa: F811
        response = rename(client, name)

        assert response.status_code == 400
        assert response.get_json() == {"error": refusal}
        assert markets.last_update is None

    def test_the_name_rule_is_asked_before_the_address_rule(self, client, markets):  # noqa: F811
        markets.docs.append(stored_market(name="Autumn Market", id="market-autumn"))

        response = rename(client, "Autumn\tMarket")

        assert response.get_json() == {"error": NOT_ONE_LINE}


def test_a_name_stored_before_the_rule_still_loads_and_lists(world):  # noqa: F811
    long_name = "L" * 150
    [document] = [d for d in world.markets.docs if d["id"] == READABLE_BY_ORGANIZATION]
    document["name"] = long_name
    client = signed_in(MEMBER)

    response = client.get(f"/markets/{READABLE_BY_ORGANIZATION}")

    assert response.status_code == 200
    assert response.get_json()["market"]["name"] == long_name
    assert listed(client)[READABLE_BY_ORGANIZATION]["name"] == long_name
