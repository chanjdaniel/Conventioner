"""Every organization load in the markets API goes through one helper.

``_load_organization_context`` is the single "fetch org, drop ``_id``, parse, tolerate
failure" path. The inline copies it replaced swallowed a parse failure silently; the
helper logs a warning instead, so a market whose organization no longer parses is
servable *and* visible in the logs. These tests pin both halves of that contract, at
the helper and at the call sites that used to inline it.
"""
from types import SimpleNamespace

import api.markets as MarketsApi
from datatypes import Organization

ORG_ID = "org-123"


def _organization_doc(**overrides):
    doc = {
        "_id": "mongo-org-id",
        "id": ORG_ID,
        "name": "Test Org",
        "owner": "user-9",
        "admins": [],
        "members": ["user-1"],
        "markets": ["market-123"],
    }
    doc.update(overrides)
    return doc


def _unparseable_organization_doc():
    """Fails ``Organization`` validation: the owner may not also be an admin."""
    return _organization_doc(owner="user-9", admins=["user-9"])


def _market_doc():
    return {
        "_id": "mongo-market-id",
        "id": "market-123",
        "name": "Test Market",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {"user-1": "owner"},
        "modificationList": [],
        "assignmentObject": {
            "assignmentDate": "",
            "vendorAssignments": [],
            "assignmentStatistics": None,
        },
        "organizationId": ORG_ID,
    }


class TestLoadOrganizationContext:
    def test_returns_model_and_document_on_success(self, monkeypatch):
        monkeypatch.setattr(MarketsApi.OrgsApi, "get_organization", lambda _oid: _organization_doc())

        organization, org_dict = MarketsApi._load_organization_context(ORG_ID)

        assert isinstance(organization, Organization)
        assert organization.id == ORG_ID
        assert org_dict["name"] == "Test Org"
        assert "_id" not in org_dict

    def test_missing_organization_returns_nothing_without_warning(self, monkeypatch, caplog):
        monkeypatch.setattr(MarketsApi.OrgsApi, "get_organization", lambda _oid: None)

        with caplog.at_level("WARNING"):
            organization, org_dict = MarketsApi._load_organization_context(ORG_ID)

        assert organization is None
        assert org_dict is None
        assert caplog.text == ""

    def test_parse_failure_logs_a_warning_and_still_returns_the_document(self, monkeypatch, caplog):
        monkeypatch.setattr(
            MarketsApi.OrgsApi, "get_organization", lambda _oid: _unparseable_organization_doc()
        )

        with caplog.at_level("WARNING"):
            organization, org_dict = MarketsApi._load_organization_context(ORG_ID)

        assert organization is None
        assert org_dict["name"] == "Test Org"
        assert ORG_ID in caplog.text
        assert "Failed to parse organization" in caplog.text


class TestCallSitesAdoptTheHelpersFailurePath:
    """The sites that inlined this block used to swallow a parse failure silently."""

    def test_market_context_logs_the_org_parse_failure_and_still_serves_the_market(
        self, monkeypatch, caplog
    ):
        monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda _q: _market_doc())
        monkeypatch.setattr(
            MarketsApi.OrgsApi, "get_organization", lambda _oid: _unparseable_organization_doc()
        )

        with caplog.at_level("WARNING"):
            context = MarketsApi.load_market_context("market-123")

        assert context.market is not None
        assert context.organization is None
        assert context.organization_dict["name"] == "Test Org"
        assert ORG_ID in caplog.text

    def test_load_market_for_logs_the_org_parse_failure(self, monkeypatch, caplog):
        monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda _q: _market_doc())
        monkeypatch.setattr(
            MarketsApi.OrgsApi, "get_organization", lambda _oid: _unparseable_organization_doc()
        )
        monkeypatch.setattr(
            MarketsApi.PermissionsApi, "user_has_permission", lambda *_a, **_k: True
        )

        with caplog.at_level("WARNING"):
            market = MarketsApi._load_market_for(
                "market-123", "owner@test.com", MarketsApi.MarketRole.VIEWER, "view"
            )

        assert market.id == "market-123"
        assert ORG_ID in caplog.text
        assert "Failed to parse organization" in caplog.text


class TestGetAssignedMarketOrganizationName:
    """The last inlined fetch: it re-read the organization the context already loaded."""

    def _run(self, monkeypatch, org_doc):
        fetches = []

        def _get_organization(org_id):
            fetches.append(org_id)
            return org_doc

        monkeypatch.setattr(MarketsApi.markets_collection, "find_one", lambda _q: _market_doc())
        monkeypatch.setattr(MarketsApi.OrgsApi, "get_organization", _get_organization)
        monkeypatch.setattr(
            MarketsApi.SourceDataApi,
            "get_source_data",
            lambda _mid: ({"headers": [], "data": []}, 200),
        )
        monkeypatch.setattr(
            MarketsApi,
            "assign_market",
            lambda _market, _source_data: SimpleNamespace(model_dump=lambda: {}),
        )

        result, status = MarketsApi.get_assigned_market("market-123")
        return result, status, fetches

    def test_attaches_organization_name_from_the_single_context_load(self, monkeypatch):
        result, status, fetches = self._run(monkeypatch, _organization_doc())

        assert status == 200
        assert result["organizationName"] == "Test Org"
        assert fetches == [ORG_ID]

    def test_still_attaches_the_name_when_the_organization_fails_to_parse(
        self, monkeypatch, caplog
    ):
        with caplog.at_level("WARNING"):
            result, status, fetches = self._run(monkeypatch, _unparseable_organization_doc())

        assert status == 200
        assert result["organizationName"] == "Test Org"
        assert fetches == [ORG_ID]
        assert "Failed to parse organization" in caplog.text
