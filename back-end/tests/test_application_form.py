"""Tests for ApplicationForm CRUD, phase-gating, and D9 locking.

``save_application_form`` is the only writer of the form; ``update_market`` preserves whatever
is stored. Both halves of that contract are exercised here.
"""
import pytest

from conftest import FakeMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import (
    Application, ApplicationForm, ApplicationStatus, FormField, MarketPhase,
)


VALID_FORM = {
    "fields": [
        {"key": "business_name", "label": "Business Name", "type": "text", "required": True,
         "help_text": "As it appears on your permit", "order": 0},
        {"key": "size", "label": "Booth Size", "type": "select", "options": ["S", "M"], "order": 1},
    ]
}

STORED_FORM = {"fields": [{"key": "shop_name", "label": "Shop name", "type": "text"}]}


@pytest.fixture
def markets(monkeypatch):
    fake = FakeMarketsCollection(stored_market())
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
    return fake


@pytest.fixture
def markets_with_stored_form(monkeypatch):
    fake = FakeMarketsCollection(stored_market(applicationForm=STORED_FORM))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
    return fake


def _submitted_application(market_id: str) -> dict:
    """An application document exactly as ``api.applications`` contracts to store it."""
    return Application(
        market_id=market_id,
        applicant_email="vendor@example.com",
        form_data={"business_name": "Acme"},
        status=ApplicationStatus.OPEN,
    ).model_dump()


class TestSaveApplicationForm:
    def test_saves_form_to_market_in_camel_case(self, markets, applications):
        MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        written = markets.last_update["$set"]["applicationForm"]
        assert written["fields"][0]["key"] == "business_name"
        assert written["fields"][0]["helpText"] == "As it appears on your permit"
        assert "help_text" not in written["fields"][0]
        assert written["publishedAt"] is None

    def test_returns_camel_case_matching_the_front_end_contract(self, markets, applications):
        result = MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        assert result["fields"][0]["helpText"] == "As it appears on your permit"
        assert "publishedAt" in result
        assert "help_text" not in result["fields"][0]
        assert "published_at" not in result

    def test_missing_market_raises_not_found(self, monkeypatch, applications):
        monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(None))

        with pytest.raises(MarketsApi.MarketNotFoundError, match="Market not found"):
            MarketsApi.save_application_form("nope", VALID_FORM, "user-1")

    def test_requires_editor_permission(self, markets, applications, monkeypatch):
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: False)

        with pytest.raises(PermissionError):
            MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")


class TestPhaseGate:
    def test_non_draft_phase_is_refused(self, monkeypatch, applications):
        monkeypatch.setattr(
            MarketsApi, "markets_collection",
            FakeMarketsCollection(stored_market(phase=MarketPhase.APPLICATIONS_OPEN)),
        )
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

        with pytest.raises(MarketsApi.ApplicationFormLockedError, match="draft phase"):
            MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

    def test_every_non_draft_phase_is_refused(self, monkeypatch, applications):
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        for phase in MarketPhase:
            if phase == MarketPhase.DRAFT:
                continue
            monkeypatch.setattr(
                MarketsApi, "markets_collection",
                FakeMarketsCollection(stored_market(phase=phase)),
            )
            with pytest.raises(MarketsApi.ApplicationFormLockedError):
                MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")


class TestD9Lock:
    def test_a_stored_application_document_engages_the_lock(self, markets, applications):
        """Pins the storage contract: the lock counts by the snake_case ``market_id`` key
        an ``Application`` dump actually carries. A writer that stored ``marketId`` instead
        would leave the lock counting zero and the D9 invariant silently dead."""
        applications.insert_one(_submitted_application("market-123"))

        with pytest.raises(MarketsApi.ApplicationFormLockedError, match="1 application"):
            MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        assert markets.last_update is None

    def test_another_markets_application_does_not_engage_the_lock(self, markets, applications):
        applications.insert_one(_submitted_application("other-market"))

        MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        assert markets.last_update is not None

    def test_form_is_frozen_once_an_application_exists(self, markets, applications):
        applications.count = 3

        with pytest.raises(MarketsApi.ApplicationFormLockedError, match="3 application"):
            MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        assert markets.last_update is None

    def test_form_is_editable_while_no_application_exists(self, markets, applications):
        applications.count = 0

        MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        assert markets.last_update is not None

    def test_the_lock_is_not_signalled_with_a_bare_runtime_error(self, markets, applications):
        """A RuntimeError from anywhere else in an update is a bug, not a 409 conflict."""
        applications.count = 1

        with pytest.raises(MarketsApi.ApplicationFormLockedError) as excinfo:
            MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")

        assert not isinstance(excinfo.value, RuntimeError)


class TestMarketPutDoesNotWriteTheForm:
    """The form has one writer. A market body carries the whole document, so a client holding a
    stale copy would otherwise revert a saved form - permanently, if the revert lands at publish
    time. The server keeps its own form on every market PUT, locked or not."""

    def test_market_put_cannot_rewrite_the_form(self, markets_with_stored_form, applications):
        rewritten = ApplicationForm(fields=[FormField(key="gotcha", label="Gotcha", type="text")])

        MarketsApi.update_market("market-123", client_market(application_form=rewritten), "user-1")

        written = markets_with_stored_form.last_update["$set"]["applicationForm"]
        assert written["fields"][0]["key"] == "shop_name"

    def test_market_put_cannot_null_the_form(self, markets_with_stored_form, applications):
        MarketsApi.update_market("market-123", client_market(application_form=None), "user-1")

        written = markets_with_stored_form.last_update["$set"]["applicationForm"]
        assert written["fields"][0]["key"] == "shop_name"

    def test_a_stale_client_copy_cannot_revert_a_saved_form(self, markets_with_stored_form, applications):
        """The publish path PUTs a market read from localStorage, which may predate a form save."""
        stale = ApplicationForm(fields=[FormField(key="old_field", label="Old", type="text")])

        MarketsApi.update_market(
            "market-123", client_market(application_form=stale, is_draft=False), "user-1"
        )

        written = markets_with_stored_form.last_update["$set"]["applicationForm"]
        assert written["fields"][0]["key"] == "shop_name"

    def test_market_put_cannot_rewrite_a_locked_form(self, markets_with_stored_form, applications):
        applications.count = 1
        rewritten = ApplicationForm(fields=[FormField(key="gotcha", label="Gotcha", type="text")])

        MarketsApi.update_market("market-123", client_market(application_form=rewritten), "user-1")

        written = markets_with_stored_form.last_update["$set"]["applicationForm"]
        assert written["fields"][0]["key"] == "shop_name"

    def test_market_put_ignores_an_invalid_form_rather_than_rejecting_the_update(
        self, markets_with_stored_form, applications
    ):
        """The body's form is not a write, so it is not a validation surface either: the rest of
        the market still updates and the stored form is untouched."""
        bad = ApplicationForm(fields=[
            FormField(key="dupe", label="One", type="text"),
            FormField(key="dupe", label="Two", type="text"),
        ])

        MarketsApi.update_market(
            "market-123", client_market(name="Renamed", application_form=bad), "user-1"
        )

        written = markets_with_stored_form.last_update["$set"]
        assert written["name"] == "Renamed"
        assert written["applicationForm"]["fields"][0]["key"] == "shop_name"

    def test_market_put_leaves_a_formless_market_formless(self, markets, applications):
        form = ApplicationForm(fields=[FormField(key="website", label="Website", type="text")])

        MarketsApi.update_market("market-123", client_market(application_form=form), "user-1")

        assert markets.last_update["$set"]["applicationForm"] is None


class TestFieldValidation:
    def _save(self, fields):
        return MarketsApi.save_application_form("market-123", {"fields": fields}, "user-1")

    def test_empty_form_is_refused(self, markets, applications):
        with pytest.raises(ValueError, match="at least one field"):
            self._save([])

    def test_unrecognized_type_is_refused(self, markets, applications):
        with pytest.raises(ValueError, match="Unrecognized field type"):
            self._save([{"key": "bad", "label": "Bad", "type": "invalid_type"}])

    @pytest.mark.parametrize("field_type", ["select", "multi_select"])
    def test_select_without_options_is_refused(self, markets, applications, field_type):
        with pytest.raises(ValueError, match="no options defined"):
            self._save([{"key": "size", "label": "Size", "type": field_type}])

    @pytest.mark.parametrize("field_type", ["select", "multi_select"])
    def test_blank_option_is_refused(self, markets, applications, field_type):
        """A blank option renders as an unselectable empty row in the applicant's form."""
        with pytest.raises(ValueError, match="blank option"):
            self._save([
                {"key": "size", "label": "Size", "type": field_type, "options": ["Small", "  "]}
            ])

    @pytest.mark.parametrize("field_type", ["select", "multi_select"])
    def test_duplicate_option_is_refused(self, markets, applications, field_type):
        """Options are the persisted answer values, so a duplicate is an ambiguous answer."""
        with pytest.raises(ValueError, match="Duplicate option 'Small'"):
            self._save([
                {
                    "key": "size", "label": "Size", "type": field_type,
                    "options": ["Small", "Large", "Small"],
                }
            ])

    def test_every_supported_type_is_accepted(self, markets, applications):
        fields = [
            {"key": "a", "label": "A", "type": "text"},
            {"key": "b", "label": "B", "type": "number"},
            {"key": "c", "label": "C", "type": "select", "options": ["x"]},
            {"key": "d", "label": "D", "type": "multi_select", "options": ["x"]},
            {"key": "e", "label": "E", "type": "checkbox"},
            {"key": "f", "label": "F", "type": "date"},
            {"key": "g", "label": "G", "type": "email"},
        ]
        self._save(fields)

        assert len(markets.last_update["$set"]["applicationForm"]["fields"]) == 7

    def test_duplicate_keys_are_refused(self, markets, applications):
        """Duplicate keys would collide in Application.form_data and lose an answer."""
        with pytest.raises(ValueError, match="Duplicate field key 'field_2'"):
            self._save([
                {"key": "field_2", "label": "One", "type": "text"},
                {"key": "field_2", "label": "Two", "type": "text"},
            ])

    def test_keys_differing_only_in_whitespace_are_duplicates(self, markets, applications):
        with pytest.raises(ValueError, match="Duplicate field key 'name'"):
            self._save([
                {"key": "name", "label": "One", "type": "text"},
                {"key": " name ", "label": "Two", "type": "text"},
            ])

    def test_blank_key_is_refused(self, markets, applications):
        with pytest.raises(ValueError, match="non-empty key"):
            self._save([{"key": "   ", "label": "Nameless", "type": "text"}])

    def test_blank_label_is_refused(self, markets, applications):
        with pytest.raises(ValueError, match="non-empty label"):
            self._save([{"key": "x", "label": "", "type": "text"}])

    @pytest.mark.parametrize("key", ["a.b", "$where", "Name", "shop name", "shop-name", "aéb"])
    def test_keys_outside_the_slug_charset_are_refused(self, markets, applications, key):
        """Keys become document keys inside Application.form_data; a dot or a leading '$' is
        exactly what Mongo update operators cannot address."""
        with pytest.raises(ValueError, match="Invalid field key"):
            self._save([{"key": key, "label": "Label", "type": "text"}])


class TestNormalization:
    """Validation runs on the normalized value, so the persisted value must be that same one."""

    def _saved_fields(self, markets, fields):
        MarketsApi.save_application_form("market-123", {"fields": fields}, "user-1")
        return markets.last_update["$set"]["applicationForm"]["fields"]

    def test_keys_and_labels_are_persisted_stripped(self, markets, applications):
        fields = self._saved_fields(
            markets, [{"key": " name ", "label": "  Your Name  ", "type": "text"}]
        )

        assert fields[0]["key"] == "name"
        assert fields[0]["label"] == "Your Name"

    def test_options_are_persisted_stripped(self, markets, applications):
        fields = self._saved_fields(markets, [
            {"key": "size", "label": "Size", "type": "select", "options": [" Small", "Large "]},
        ])

        assert fields[0]["options"] == ["Small", "Large"]

    def test_order_is_renormalized_to_the_array_position(self, markets, applications):
        """Array position is the display order; the builder and the preview must not disagree."""
        fields = self._saved_fields(markets, [
            {"key": "a", "label": "A", "type": "text", "order": 7},
            {"key": "b", "label": "B", "type": "text", "order": 7},
            {"key": "c", "label": "C", "type": "text", "order": 2},
        ])

        assert [f["order"] for f in fields] == [0, 1, 2]
        assert [f["key"] for f in fields] == ["a", "b", "c"]

    def test_non_select_fields_are_persisted_without_options(self, markets, applications):
        fields = self._saved_fields(
            markets, [{"key": "a", "label": "A", "type": "text", "options": ["stray"]}]
        )

        assert fields[0]["options"] == []


class TestPublishedAtIsServerOwned:
    """``published_at`` is lock-bearing lifecycle state (D9); a client must never write it."""

    def test_a_client_supplied_published_at_is_discarded(self, markets, applications):
        MarketsApi.save_application_form(
            "market-123", {**VALID_FORM, "published_at": "2026-01-01T00:00:00Z"}, "user-1"
        )

        assert markets.last_update["$set"]["applicationForm"]["publishedAt"] is None

    def test_the_stored_published_at_survives_a_save(self, monkeypatch, applications):
        fake = FakeMarketsCollection(
            stored_market(
                applicationForm={**STORED_FORM, "publishedAt": "2026-02-02T00:00:00Z"}
            )
        )
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

        MarketsApi.save_application_form(
            "market-123", {**VALID_FORM, "published_at": None}, "user-1"
        )

        assert fake.last_update["$set"]["applicationForm"]["publishedAt"] == "2026-02-02T00:00:00Z"


class TestCreateMarketWritesTheFormThroughTheSameContract:
    """A create body may carry a form, so it must pass the validation every other writer does."""

    @pytest.fixture
    def created(self, monkeypatch):
        fake = FakeMarketsCollection(None)
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        return fake

    def _create(self, form: ApplicationForm | None):
        MarketsApi.create_market(
            client_market(application_form=form), "user-1@example.com"
        )

    def test_a_valid_form_is_normalized_on_create(self, created, applications):
        self._create(ApplicationForm(fields=[
            FormField(key=" shop_name ", label="  Shop name  ", type="text", order=9),
        ]))

        written = created.inserted["applicationForm"]
        assert written["fields"] == [{
            "key": "shop_name", "label": "Shop name", "type": "text",
            "required": False, "options": [], "helpText": None, "order": 0,
        }]
        assert written["publishedAt"] is None

    def test_duplicate_keys_are_refused_on_create(self, created, applications):
        with pytest.raises(ValueError, match="Duplicate field key"):
            self._create(ApplicationForm(fields=[
                FormField(key="a", label="A", type="text"),
                FormField(key="a", label="Also A", type="text"),
            ]))

        assert created.inserted is None

    @pytest.mark.parametrize("key", ["a.b", "$where", "Shop Name"])
    def test_unaddressable_keys_are_refused_on_create(self, created, applications, key):
        with pytest.raises(ValueError, match="Invalid field key"):
            self._create(ApplicationForm(fields=[FormField(key=key, label="L", type="text")]))

        assert created.inserted is None

    def test_a_client_supplied_published_at_is_discarded_on_create(self, created, applications):
        self._create(ApplicationForm(
            fields=[FormField(key="a", label="A", type="text")],
            published_at="2026-01-01T00:00:00Z",
        ))

        assert created.inserted["applicationForm"]["publishedAt"] is None

    def test_a_market_created_without_a_form_has_none(self, created, applications):
        self._create(None)

        assert created.inserted["applicationForm"] is None


class TestGetApplicationForm:
    def test_returns_camel_case_form_and_editable_state(self, markets, applications):
        MarketsApi.save_application_form("market-123", VALID_FORM, "user-1")
        markets.doc = stored_market(
            applicationForm=markets.last_update["$set"]["applicationForm"]
        )

        result = MarketsApi.get_application_form("market-123", "user-1")

        assert result["application_form"]["fields"][0]["helpText"] == "As it appears on your permit"
        assert result["editable"] is True
        assert result["lock_reason"] is None

    def test_reports_no_form(self, markets, applications):
        result = MarketsApi.get_application_form("market-123", "user-1")

        assert result["application_form"] is None
        assert result["editable"] is True

    def test_reports_the_lock_reason_when_applications_exist(self, markets, applications):
        applications.count = 2

        result = MarketsApi.get_application_form("market-123", "user-1")

        assert result["editable"] is False
        assert "2 application(s)" in result["lock_reason"]

    def test_reports_the_lock_reason_out_of_draft(self, monkeypatch, applications):
        monkeypatch.setattr(
            MarketsApi, "markets_collection",
            FakeMarketsCollection(stored_market(phase=MarketPhase.ARCHIVED)),
        )
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

        result = MarketsApi.get_application_form("market-123", "user-1")

        assert result["editable"] is False
        assert "draft phase" in result["lock_reason"]

    def test_requires_viewer_permission(self, markets, applications, monkeypatch):
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: False)

        with pytest.raises(PermissionError):
            MarketsApi.get_application_form("market-123", "user-1")
