"""A form save lands only on the form it was judged on, and never erases what it does not write.

The form write reads the market, judges the form against it, and then writes the questions. Each
test lands a second change between that read and the write (``interleave``): Open applications,
which stamps the form published, the first application, which freezes what the essential questions
offer, or another save of the form. Each asserts what a person and a later reader see: the 409 and
its sentence, and the stored form as the other change left it. The last tests run the other way
round: a form save landing inside Open applications' window refuses the move.
"""
import api.markets as MarketsApi
import essential_fields as EssentialFields
from datatypes import MarketPhase
from market_write import MARKET_CHANGED
from real_mongo.test_a_judged_write_lands_only_on_the_market_it_judged import (
    _history, _move, _stored,
)
from test_csv_proposal_api import CSV as START_CSV

ORGANIZER = "fixture-organizer@example.com"
CHANGED = {"error": MARKET_CHANGED, "code": "market_changed"}
SHOP = {"key": "shop_name", "label": "Shop name", "type": "text", "required": False,
        "options": [], "order": 0}
WEBSITE = {"key": "website", "label": "Website", "type": "text", "required": False,
           "options": [], "order": 1}
INSTAGRAM = {"key": "instagram", "label": "Instagram", "type": "text", "required": False,
             "options": [], "order": 1}
#: A form market a draft may open applications on: a form, and the review setup decided.
OPENABLE = {"intakeMode": "form", "nothingLeadsTheCard": True, "noAutomaticRejections": True}


def _a_form_market(market_in, **overrides):
    return market_in(MarketPhase.DRAFT, **{
        **OPENABLE,
        "applicationForm": {"fields": [SHOP], "publishedAt": None, "essentialOptions": None,
                            "unaskedEssentials": []},
        **overrides,
    })


def _first_application_freezes(real_db, market):
    """The freeze the first application makes before its answers are stored: what the essential
    questions offer, as the market stands then."""
    def freeze():
        stored = _stored(real_db, market)
        EssentialFields.freeze_and_effective_essential_options(
            real_db["markets"], market["id"], EssentialFields.effective_essential_options(stored))
    return freeze


def _keys(form):
    return [field["key"] for field in (form or {}).get("fields") or []]


class TestAFormSaveCrossingOpenApplications:
    def test_is_refused_and_leaves_the_published_stamp(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)
        interleave("api.markets._load_market_to_change", _move(market, MarketPhase.APPLICATIONS))

        response = client.put(f"/markets/{market['id']}/application-form",
                              json={"fields": [SHOP, WEBSITE], "formRevision": 0})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.APPLICATIONS.value
        assert stored["applicationForm"]["publishedAt"]
        assert _keys(stored["applicationForm"]) == ["shop_name"]
        assert _history(market_records, market) == []


class TestAFormSaveCrossingTheFirstApplication:
    def test_on_a_market_taking_applications_is_refused_and_leaves_the_frozen_offering(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)
        opened = _move(market, MarketPhase.APPLICATIONS)
        freeze = _first_application_freezes(real_db, market)
        interleave("api.markets._load_market_to_change", lambda: (opened(), freeze()))

        response = client.put(f"/markets/{market['id']}/application-form",
                              json={"fields": [SHOP, WEBSITE], "formRevision": 0})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.APPLICATIONS.value
        assert stored["applicationForm"]["essentialOptions"]
        assert stored["applicationForm"]["publishedAt"]
        assert _keys(stored["applicationForm"]) == ["shop_name"]
        assert _history(market_records, market) == []

    def test_on_a_draft_whose_first_row_was_imported_is_refused_and_leaves_the_frozen_offering(
            self, signed_in, market_in, interleave, real_db, market_records):
        """A market whose vendors arrive by import takes its first row in draft, so only the
        frozen offering tells the save it crossed it: the phase never moved."""
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in, intakeMode="csv")
        interleave("api.markets._load_market_to_change", _first_application_freezes(real_db, market))

        response = client.put(f"/markets/{market['id']}/application-form",
                              json={"fields": [SHOP, WEBSITE], "formRevision": 0})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.DRAFT.value
        assert stored["applicationForm"]["essentialOptions"]
        assert _keys(stored["applicationForm"]) == ["shop_name"]
        assert _history(market_records, market) == []


class TestTwoSavesOfOneForm:
    def test_the_save_from_the_older_copy_is_refused_and_the_first_stands(
            self, signed_in, market_in, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)
        read = client.get(f"/markets/{market['id']}/application-form").get_json()
        assert read["formRevision"] == 0

        first = client.put(f"/markets/{market['id']}/application-form",
                           json={"fields": [SHOP, WEBSITE], "formRevision": 0})
        second = client.put(f"/markets/{market['id']}/application-form",
                            json={"fields": [SHOP, INSTAGRAM], "formRevision": 0})

        assert first.status_code == 200, first.get_json()
        assert first.get_json()["formRevision"] == 1
        assert second.status_code == 409, second.get_json()
        assert second.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert _keys(stored["applicationForm"]) == ["shop_name", "website"]
        assert stored["formRevision"] == 1
        assert [entry["kind"] for entry in _history(market_records, market)] == ["form"]
        assert client.get(f"/markets/{market['id']}/application-form").get_json()[
            "formRevision"] == 1

    def test_a_save_from_the_revision_it_answered_lands(self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)

        first = client.put(f"/markets/{market['id']}/application-form",
                           json={"fields": [SHOP, WEBSITE], "formRevision": 0})
        second = client.put(f"/markets/{market['id']}/application-form", json={
            "fields": [SHOP, WEBSITE, {**INSTAGRAM, "order": 2}],
            "formRevision": first.get_json()["formRevision"]})

        assert second.status_code == 200, second.get_json()
        assert second.get_json()["formRevision"] == 2
        assert _keys(_stored(real_db, market)["applicationForm"]) == [
            "shop_name", "website", "instagram"]

    def test_a_save_writes_the_questions_and_never_the_published_stamp_or_the_offering(
            self, signed_in, market_in, real_db):
        """The save writes only what it carries: a stamp and an offering it was never sent stay as
        stored, whatever the body says of them."""
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in, intakeMode="csv")
        _first_application_freezes(real_db, market)()
        offering = _stored(real_db, market)["applicationForm"]["essentialOptions"]
        assert offering

        response = client.put(f"/markets/{market['id']}/application-form", json={
            "fields": [SHOP, WEBSITE], "publishedAt": "2026-01-01T00:00:00Z",
            "essentialOptions": None, "unaskedEssentials": [], "formRevision": 0})

        assert response.status_code == 200, response.get_json()
        stored = _stored(real_db, market)["applicationForm"]
        assert stored["publishedAt"] is None
        assert stored["essentialOptions"] == offering

    def test_a_first_save_on_a_market_with_no_form_writes_it_whole(
            self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, **OPENABLE)

        response = client.put(f"/markets/{market['id']}/application-form",
                              json={"fields": [SHOP], "formRevision": 0})

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["formRevision"] == 1
        stored = _stored(real_db, market)
        assert _keys(stored["applicationForm"]) == ["shop_name"]
        assert stored["applicationForm"]["publishedAt"] is None
        assert stored["applicationForm"]["essentialOptions"] is None
        assert stored["formRevision"] == 1


class TestTheCsvStart:
    def test_counts_the_revision_so_a_form_tab_open_from_before_is_refused(
            self, signed_in, market_in, real_db, market_records):
        """The start writes the questions from its file, and no page sent it a revision: a form
        tab read before it is told the form changed rather than storing its copy over them."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, applicationForm={"fields": []})
        read = client.get(f"/markets/{market['id']}/application-form").get_json()

        started = client.post(f"/markets/{market['id']}/csv-proposal/confirm",
                              json={"csvContent": START_CSV, "year": 2026})
        saved = client.put(f"/markets/{market['id']}/application-form",
                           json={"fields": [SHOP], "formRevision": read["formRevision"]})

        assert started.status_code == 200, started.get_json()
        assert saved.status_code == 409, saved.get_json()
        assert saved.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["formRevision"] == 1
        assert "shop_name" not in _keys(stored["applicationForm"])
        assert client.get(f"/markets/{market['id']}/application-form").get_json()[
            "formRevision"] == 1


class TestWhatDoesNotCountTheRevision:
    def test_neither_open_applications_nor_the_first_application_counts_it(
            self, signed_in, market_in, real_db):
        """Neither changes a question, so neither counts the revision."""
        signed_in(ORGANIZER)
        market = _a_form_market(market_in, formRevision=3)

        _move(market, MarketPhase.APPLICATIONS)()
        _first_application_freezes(real_db, market)()

        stored = _stored(real_db, market)
        assert stored["applicationForm"]["publishedAt"]
        assert stored["applicationForm"]["essentialOptions"]
        assert stored["formRevision"] == 3


class TestTheRevisionTheBodyCarries:
    def test_a_save_carrying_none_is_told_the_market_changed(
            self, signed_in, market_in, real_db, market_records):
        """The page from before the revision existed, still open after a deploy, is told to
        reload rather than storing its copy over whatever was saved since."""
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)

        response = client.put(f"/markets/{market['id']}/application-form",
                              json={"fields": [SHOP, WEBSITE]})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _keys(_stored(real_db, market)["applicationForm"]) == ["shop_name"]
        assert _history(market_records, market) == []

    def test_a_save_carrying_something_else_is_refused_in_words(
            self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)

        for revision in (-1, 1.5, "1", True, None):
            response = client.put(f"/markets/{market['id']}/application-form",
                                  json={"fields": [SHOP, WEBSITE], "formRevision": revision})

            assert response.status_code == 400, (revision, response.get_json())
            assert response.get_json()["error"] == "formRevision must be a whole number."
        assert _keys(_stored(real_db, market)["applicationForm"]) == ["shop_name"]


class TestOpenApplicationsCrossingAFormSave:
    def test_is_refused_with_the_market_changed_and_the_market_stays_a_draft(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)
        interleave("api.markets.evaluate_transition", lambda: MarketsApi.save_application_form(
            market["id"], {"fields": [SHOP, WEBSITE], "form_revision": 0}, ORGANIZER))

        response = client.post(f"/markets/{market['id']}/transition",
                               json={"toPhase": MarketPhase.APPLICATIONS.value})

        assert response.status_code == 409, response.get_json()
        body = response.get_json()
        assert (body["currentPhase"], body["targetPhase"]) == (
            MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS.value)
        assert [(b["id"], b["message"]) for b in body["blockers"]] == [
            ("market_changed", MARKET_CHANGED)]
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.DRAFT.value
        assert stored["applicationForm"]["publishedAt"] is None
        assert _keys(stored["applicationForm"]) == ["shop_name", "website"]
        assert [entry["kind"] for entry in _history(market_records, market)] == ["form"]

    def test_lands_when_nothing_was_saved_in_its_window(self, signed_in, market_in, real_db):
        client = signed_in(ORGANIZER)
        market = _a_form_market(market_in)

        response = client.post(f"/markets/{market['id']}/transition",
                               json={"toPhase": MarketPhase.APPLICATIONS.value})

        assert response.status_code == 200, response.get_json()
        assert _stored(real_db, market)["phase"] == MarketPhase.APPLICATIONS.value
