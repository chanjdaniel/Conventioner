"""The slug is stored, derived, and server-owned - because it is a market's public identifier.

Every public URL a market appears on names it by the slug of its name, and every endpoint behind
those URLs is unauthenticated: public check-in, the application form, applicant sign-in. The slug
is persisted so that lookup is one indexed query (``published_market_by_slug``) instead of a decode
of every market in the database that any stranger could drive by typing a URL.

Persisting a derived value is only safe while nothing can leave it disagreeing with what it was
derived from. That is what these pin: it is a computed field, so every write recomputes it from the
name, and no request body can name it.
"""
import pytest

from conftest import FakeMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import Market, MarketPhase, market_name_slug
from market_documents import market_from_document, published_market_by_slug


@pytest.fixture
def collection(monkeypatch):
    fake = FakeMarketsCollection(stored_market(phase=MarketPhase.ARCHIVED))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)
    return fake


def _market(**overrides) -> Market:
    kwargs = {
        "name": "Spring Market",
        "creation_date": "2026-01-01T00:00:00Z",
        "roles": {"user-1": "owner"},
        "modification_list": [],
        "assignment_object": {"vendorAssignments": [], "assignmentStatistics": None},
    }
    kwargs.update(overrides)
    return Market(**kwargs)


class TestTheSlugIsDerivedFromTheName:
    def test_it_is_the_fold_the_front_end_links_with(self):
        assert _market(name="Café Market").slug == "cafe-market"

    def test_a_market_with_no_usable_name_slugs_to_nothing(self):
        """No lookup can ask for the empty slug, so such a market is on no public URL - which is
        the honest answer, not a URL that collides with every other unnameable market."""
        assert _market(name="!!!").slug == ""

    def test_it_cannot_be_set_from_a_request_body(self):
        """A writable slug is a market that can be put on somebody else's URL."""
        market = _market(name="Spring Market", slug="someone-elses-market")

        assert market.slug == "spring-market"

    def test_parsing_a_stored_market_recomputes_it(self):
        """The stored value is a cache of the rule, never an authority over it."""
        doc = stored_market(phase=MarketPhase.ARCHIVED, name="Spring Market", slug="stale-slug")

        assert market_from_document(doc).slug == "spring-market"


class TestEveryWritePersistsIt:
    """The lookup queries the stored slug, so a write that did not stamp one would create a market
    with no public URL - and nothing would say so until an applicant followed a link and got a 404.
    """

    def test_create_stores_the_slug(self, collection):
        collection.doc = None  # no market by this name exists yet

        MarketsApi.create_market(_market(name="Café Market"), "owner@example.com")

        assert collection.inserted["slug"] == "cafe-market"

    def test_renaming_a_market_moves_its_public_url(self, collection):
        MarketsApi.update_market("market-123", client_market(name="Renamed Market"), "user-1")

        written = collection.last_update["$set"]
        assert written["name"] == "Renamed Market"
        assert written["slug"] == "renamed-market"

    def test_an_update_body_cannot_name_the_slug(self, collection):
        MarketsApi.update_market(
            "market-123",
            client_market(name="Spring Market", slug="someone-elses-market"),
            "user-1",
        )

        assert collection.last_update["$set"]["slug"] == "spring-market"


class TestTheLookupUsesTheStoredSlug:
    """The stored slug narrows the query; the name still decides. See
    ``market_documents.published_market_by_slug``."""

    class _Collection:
        def __init__(self, docs):
            self.docs = docs
            self.queries = []
            self.projections = []

        def find(self, query, projection=None):
            from conftest import mongo_matches
            self.queries.append(query)
            self.projections.append(projection)
            matched = [dict(d) for d in self.docs if mongo_matches(d, query)]
            if projection is not None:
                matched = [
                    {k: v for k, v in d.items() if k in projection or k == "_id"} for d in matched
                ]
            return iter(matched)

    def test_the_market_is_found_by_its_stored_slug(self):
        collection = self._Collection([
            stored_market(phase=MarketPhase.ARCHIVED, name="Café Market"),
        ])

        found = published_market_by_slug(collection, "cafe-market")

        assert found["name"] == "Café Market"
        assert collection.queries[0]["slug"] == "cafe-market"

    def test_the_rule_the_query_uses_is_the_rule_the_links_use(self):
        """One rule, one function: a second copy that skipped the accent fold would store
        ``caf-market`` under a link that says ``cafe-market``, and every lookup behind it would
        404."""
        doc = stored_market(phase=MarketPhase.ARCHIVED, name="Café Market")

        assert doc["slug"] == market_name_slug("Café Market")


class TestThePublicLookupFetchesOnlyWhatItServes:
    """An indexed query bounds how many documents the lookup touches. It says nothing about how big
    one of them is, and a market carries the organizer's whole working state - which the applicant's
    unauthenticated, captcha-less form page has no use for and must not be made to decode."""

    def _collection(self):
        return TestTheLookupUsesTheStoredSlug._Collection([
            stored_market(phase=MarketPhase.ARCHIVED, name="Spring Market"),
        ])

    def test_a_caller_gets_the_fields_it_asked_for(self):
        collection = self._collection()

        found = published_market_by_slug(collection, "spring-market", ("id", "application_form"))

        assert found["id"]
        assert "assignmentObject" not in found
        assert "modificationList" not in found

    def test_the_fields_the_lookup_itself_reads_are_never_projected_away(self):
        """Without the phase in hand every market reads as a draft, and the lookup would answer 404
        for markets that are live. A caller cannot drop those by not asking for them."""
        collection = self._collection()

        found = published_market_by_slug(collection, "spring-market", ("id",))

        assert found is not None
        for field in ("name", "phase", "isDraft"):
            assert field in collection.projections[0]

    def test_a_caller_that_names_nothing_still_gets_the_whole_document(self):
        """Public check-in reads the assignment out of the market it resolves this way."""
        collection = self._collection()

        found = published_market_by_slug(collection, "spring-market")

        assert collection.projections[0] is None
        assert "assignmentObject" in found
