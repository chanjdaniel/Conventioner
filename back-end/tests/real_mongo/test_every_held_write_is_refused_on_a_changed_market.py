"""Each market write a phase rule or a read fact judged is refused when what it read moved.

Publish results, Stop or take applications, the door code, the Discord check, run, decline and
card, the saved import mapping, the CSV start and the four permission-row writes each read the
market, judge, and then write. Each test lands a second change between that read and the write
(``interleave``), made through its own module function, and asserts what a person and a later
reader see: the 409 and its sentence, the stored market as the other change left it, and only the
other change's history.
"""
from urllib.parse import parse_qs, urlparse

import pytest

import api.discord_connection as DiscordConnection
import api.markets as MarketsApi
import api.organizations as OrgsApi
import assignment.lifecycle as Lifecycle
import csv_import as CsvImport
import csv_start as CsvStart
import discord_client as Discord
import history as History
from datatypes import MarketPhase, VendorAssignmentResult
from market_documents import market_from_document
from market_write import MARKET_CHANGED
from real_mongo.test_a_judged_write_lands_only_on_the_market_it_judged import (
    _history, _move, _stored,
)
from test_csv_import import FORM_FIELDS, GOOD_ROW, MAPPING, SETUP_CAMEL, _csv
from test_csv_proposal_api import CSV as START_CSV

ORGANIZER = "fixture-organizer@example.com"
CHANGED = {"error": MARKET_CHANGED, "code": "market_changed"}
ROW = "stop-applications"
#: What a run records it was made from, in its shape; the values are no real fingerprints.
MADE_FROM = {"rules": "r", "plan": "p", "applications": "a", "review": "1"}


def _kinds(market_records, market):
    return [entry["kind"] for entry in _history(market_records, market)]


def _allocated(email):
    return {"email": email, "date": "2026-12-05", "tableCode": "A1", "tableChoice": "Full Table",
            "section": "Main Hall", "tier": "Gold", "location": "Hall", "handPlaced": False}


class TestPublishResults:
    def test_is_refused_when_another_allocation_was_stored_after_it_judged_the_one_it_read(
            self, signed_in, market_in, allocated, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.ASSIGNMENT, intakeMode="form")
        allocated(market, [_allocated("vendor-1@example.com")])
        rerun = [VendorAssignmentResult(
            email="vendor-2@example.com", date="2026-12-05", table_code="A1",
            table_choice="Full Table", section="Main Hall", tier="Gold", location="Hall")]
        interleave("api.applicants.publish_results_refusal",
                   lambda: Lifecycle.store(
                       market_from_document(_stored(real_db, market)), Lifecycle.Event.RUN, rerun,
                       assignment_date="2026-11-11T09:00:00Z", made_from=MADE_FROM))

        response = client.post(f"/markets/{market['id']}/publish-results")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored.get("resultsPublished") is not True
        assert stored["assignmentObject"]["revision"] == 2
        assert [row["email"] for row in stored["assignmentObject"]["vendorAssignments"]] == [
            "vendor-2@example.com"]
        assert _history(market_records, market) == []


class TestStopTakingApplications:
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS, intakeMode="form")
        interleave("api.applicants.applications_stop_refusal",
                   _move(market, MarketPhase.ARCHIVED))

        response = client.post(f"/markets/{market['id']}/applications-stopped",
                               json={"stopped": True})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ARCHIVED.value
        assert "applicationsStopped" not in stored
        assert _history(market_records, market) == []


class TestTheDoorCode:
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.MARKET_DAYS)
        interleave("api.door._market_on_its_days", _move(market, MarketPhase.ARCHIVED))

        response = client.post(f"/markets/{market['id']}/door-code")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ARCHIVED.value
        assert "doorCode" not in stored
        assert _history(market_records, market) == []


GUILD = "2909267986263572999"
DISCORD_QUESTION = {"key": "discord_username", "label": "Discord Username", "type": "text"}
VENDOR_ROLE = Discord.Role("r-vendor", "Vendor Test", below_bot=True)
OTHER_ROLE = Discord.Role("r-other", "Other Role", below_bot=True)
OTHER_GUILD = Discord.Server("2909267986263573111", "Other Vendors")
#: The server each connection in flight is told it was added to, the latest first.
_servers = []
CONNECTED = {"guildId": GUILD, "guildName": "Market Vendors", "roleId": VENDOR_ROLE.id,
             "roleName": VENDOR_ROLE.name, "usernameQuestion": DISCORD_QUESTION["key"]}


@pytest.fixture
def discord(monkeypatch):
    """Discord's API as fakes of ``discord_client``'s calls: a server with two roles and no
    members, whose grants give nothing."""
    monkeypatch.setenv("DISCORD_CLIENT_ID", "1565000000000000001")
    monkeypatch.setenv("DISCORD_CLIENT_SECRET", "a-client-secret-of-the-deployments")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "a-bot-token-of-the-deployments")
    monkeypatch.setattr(Discord, "server_roles", lambda _values, _guild: [VENDOR_ROLE, OTHER_ROLE])
    monkeypatch.setattr(Discord, "server_members", lambda _values, _guild, deadline=None: [])

    class RoleGrants:
        def __init__(self, *_args, **_kwargs):
            pass

        def give(self, _member_id):
            raise AssertionError("no member to give the role to")

    monkeypatch.setattr(Discord, "RoleGrants", RoleGrants)
    _servers.clear()
    monkeypatch.setattr(Discord, "connected_server", lambda *_args: _servers.pop())


def _connected_market(market_in, phase=MarketPhase.APPLICATIONS, **discord):
    return market_in(phase, intakeMode="form", applicationForm={
        "fields": [DISCORD_QUESTION], "essentialOptions": None},
        discord={**CONNECTED, **discord})


class TestTheDiscordCheck:
    def test_is_refused_when_the_market_was_archived_while_the_members_were_read(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _connected_market(market_in)
        interleave("api.discord_connection._server_members", _move(market, MarketPhase.ARCHIVED))

        response = client.post(f"/markets/{market['id']}/discord/check")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ARCHIVED.value
        assert stored["discord"] == CONNECTED
        assert _history(market_records, market) == []

    def test_is_refused_when_the_card_changed_its_role_while_the_members_were_read(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _connected_market(market_in)
        interleave("api.discord_connection._server_members", lambda: DiscordConnection.save(
            market["id"], {"roleId": OTHER_ROLE.id}, ORGANIZER))

        response = client.post(f"/markets/{market['id']}/discord/check")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)["discord"]
        assert (stored["roleId"], "checkedAt" in stored) == (OTHER_ROLE.id, False)
        assert _kinds(market_records, market) == [History.DISCORD_SETTINGS]


class TestTheDiscordRun:
    def test_is_refused_in_its_own_words_when_the_market_was_archived_while_it_ran(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _connected_market(market_in, MarketPhase.ASSIGNMENT)
        interleave("api.discord_connection._server_members", _move(market, MarketPhase.ARCHIVED))

        response = client.post(f"/markets/{market['id']}/discord/role-run")

        # Any roles it gave are in Discord whatever the market took, so it says so, not "not saved".
        assert response.status_code == 409, response.get_json()
        assert response.get_json() == {"error": DiscordConnection.CHANGED_WHILE_GIVING,
                                       "code": "market_changed"}
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ARCHIVED.value
        assert stored["discord"] == CONNECTED
        assert _kinds(market_records, market) == [History.DISCORD_ROLES_GIVEN]


class TestDecliningAPossibleMatch:
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        offered = {"applicationId": "app-1", "state": "not_found", "answer": "wren",
                   "possibleMatches": [{"username": "wren.okafor"}]}
        market = _connected_market(market_in, vendorStates=[offered])
        interleave("api.markets._load_market_to_change", _move(market, MarketPhase.ARCHIVED))

        response = client.post(
            f"/markets/{market['id']}/discord/possible-matches/app-1/declined",
            json={"username": "wren.okafor"})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["phase"] == MarketPhase.ARCHIVED.value
        assert "declinedMatches" not in stored["discord"]
        assert _history(market_records, market) == []


class TestTheDiscordCard:
    def test_is_refused_when_another_save_changed_the_same_field_before_it_landed(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _connected_market(market_in)
        theirs = "https://discord.gg/theirs"
        interleave("api.markets._load_market_to_change", lambda: DiscordConnection.save(
            market["id"], {"inviteLink": theirs}, ORGANIZER))

        response = client.put(f"/markets/{market['id']}/discord",
                              json={"inviteLink": "https://discord.gg/mine"})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["discord"]["inviteLink"] == theirs
        assert _kinds(market_records, market) == [History.DISCORD_SETTINGS]

    def test_lands_beside_another_save_of_a_field_it_did_not_change(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = _connected_market(market_in)
        interleave("api.markets._load_market_to_change", lambda: DiscordConnection.save(
            market["id"], {"roleId": OTHER_ROLE.id}, ORGANIZER))

        response = client.put(f"/markets/{market['id']}/discord",
                              json={"inviteLink": "https://discord.gg/mine"})

        assert response.status_code == 200, response.get_json()
        stored = _stored(real_db, market)["discord"]
        assert (stored["roleId"], stored["inviteLink"]) == (OTHER_ROLE.id, "https://discord.gg/mine")
        assert _kinds(market_records, market) == [History.DISCORD_SETTINGS] * 2

    def test_a_first_connection_is_refused_over_one_made_since_in_another_tab(
            self, discord, signed_in, market_in, interleave, real_db, market_records):
        """A market never connected stores ``discord: null``, and its first connection writes the
        sub-document whole: it holds the null it read."""
        client = signed_in(ORGANIZER)
        other_tab = _signed_in_again(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS, intakeMode="form", applicationForm={
            "fields": [DISCORD_QUESTION], "essentialOptions": None}, discord=None)
        state = _started(client, market)
        interleave("api.markets._load_market_to_change", lambda: _connect(
            other_tab, market, _started(other_tab, market), guild=OTHER_GUILD))

        response = _connect(client, market, state)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["discord"]["guildId"] == OTHER_GUILD.id
        assert _kinds(market_records, market) == [History.DISCORD_CONNECTED]


def _signed_in_again(email):
    """A second client of an account ``signed_in`` made: the same person in another tab."""
    import app as app_module
    from real_mongo.conftest import FIXTURE_PASSWORD

    client = app_module.app.test_client()
    response = client.post("/login", json={"email": email, "password": FIXTURE_PASSWORD})
    assert response.status_code == 200, response.get_json()
    return client


def _started(client, market):
    """The state Discord's approval screen hands back, from starting to connect in ``client``."""
    response = client.post(f"/markets/{market['id']}/discord/authorization")
    assert response.status_code == 200, response.get_json()
    return parse_qs(urlparse(response.get_json()["url"]).query)["state"][0]


def _connect(client, market, state, guild=None):
    """Finish connecting, as the page Discord sent the person back to does; Discord says the bot
    was added to ``guild`` (the fixture's server by default)."""
    _servers.append(guild or Discord.Server(GUILD, "Market Vendors"))
    return client.post(f"/markets/{market['id']}/discord/connection",
                       json={"code": "a-code", "state": state})


def _google_form_market(market_in, phase=MarketPhase.APPLICATIONS):
    return market_in(phase, setupObject=SETUP_CAMEL, applicationForm={
        "fields": FORM_FIELDS, "essentialOptions": None})


class TestTheImport:
    def test_is_refused_and_writes_no_application_when_another_import_saved_its_mapping_first(
            self, signed_in, market_in, interleave, real_db, market_records, applications):
        client = signed_in(ORGANIZER)
        market = _google_form_market(market_in)
        theirs = GOOD_ROW.replace("nadia@ember.test", "kai@ember.test")

        def another_import():
            body, status = CsvImport.import_applications(
                MarketsApi.markets_collection, _stored(real_db, market), _csv(theirs), MAPPING,
                by=ORGANIZER)
            assert status == 200, body

        interleave("app._importing_market_document", another_import)

        response = client.post(f"/markets/{market['id']}/applications/import",
                               json={"csvContent": _csv(GOOD_ROW), "mapping": MAPPING})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert [doc["applicant_email"] for doc in applications.find(
            {"market_id": market["id"]})] == ["kai@ember.test"]
        assert _stored(real_db, market)["importMapping"]["targets"]["applicant_email"] == [
            "Email Address"]
        assert _history(market_records, market) == []


class TestTheCsvStart:
    def test_is_refused_when_another_start_wrote_the_form_first(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.DRAFT, applicationForm={"fields": []})
        body = {"csvContent": START_CSV, "year": 2026}
        other = START_CSV.replace("Full Name", "Business Name")
        landed = []

        def another_start():
            landed.append(CsvStart.confirm(
                _stored(real_db, market), {**body, "csvContent": other}, ORGANIZER, None))

        interleave("app._importing_market_document", another_start)

        response = client.post(f"/markets/{market['id']}/csv-proposal/confirm", json=body)

        assert landed == [({"written": True}, 200)]
        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        stored = _stored(real_db, market)
        assert stored["importMapping"]["headers"] == ["Timestamp", "Email Address",
                                                      "Business Name"]
        assert _kinds(market_records, market) == [History.STARTED]


def _owners_row(role):
    return {"role": role, "source": "market"}


class TestAPermissionRow:
    def test_set_is_refused_when_the_owner_set_the_same_row_in_another_tab_first(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS)
        interleave("api.markets._row_to_change", lambda: MarketsApi.set_permission(
            market["id"], ROW, "editor", ORGANIZER))

        response = client.put(f"/markets/{market['id']}/permissions/{ROW}", json={"role": "owner"})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["permissions"] == {ROW: _owners_row("editor")}
        entries = _history(market_records, market)
        assert [entry["kind"] for entry in entries] == [History.PERMISSION_SET]
        assert entries[0]["detail"]["after"] == {"role": "editor", "source": "market"}

    def test_set_is_refused_when_the_stored_rows_were_not_a_map_and_a_row_was_set_since(
            self, signed_in, market_in, interleave, real_db, market_records):
        """A ``permissions`` stored as null is replaced whole by a set, so it is held whole."""
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS, permissions=None)
        interleave("api.markets._row_to_change", lambda: MarketsApi.set_permission(
            market["id"], "publish-results", "editor", ORGANIZER))

        response = client.put(f"/markets/{market['id']}/permissions/{ROW}", json={"role": "owner"})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["permissions"] == {
            "publish-results": _owners_row("editor")}
        assert _kinds(market_records, market) == [History.PERMISSION_SET]

    def test_set_lands_beside_another_row_set_since(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS)
        interleave("api.markets._row_to_change", lambda: MarketsApi.set_permission(
            market["id"], "publish-results", "editor", ORGANIZER))

        response = client.put(f"/markets/{market['id']}/permissions/{ROW}", json={"role": "owner"})

        assert response.status_code == 200, response.get_json()
        assert _stored(real_db, market)["permissions"] == {
            "publish-results": _owners_row("editor"), ROW: _owners_row("owner")}
        assert _kinds(market_records, market) == [History.PERMISSION_SET] * 2

    def test_reset_is_refused_when_the_row_was_set_again_since(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS, permissions={ROW: _owners_row("owner")})
        interleave("api.markets._row_to_change", lambda: MarketsApi.set_permission(
            market["id"], ROW, "editor", ORGANIZER))

        response = client.delete(f"/markets/{market['id']}/permissions/{ROW}")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["permissions"] == {ROW: _owners_row("editor")}
        assert _kinds(market_records, market) == [History.PERMISSION_SET]

    def test_resetting_the_table_is_refused_when_a_row_it_holds_was_set_again_since(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS, permissions={ROW: _owners_row("owner")})
        interleave("api.markets._load_market_to_change", lambda: MarketsApi.set_permission(
            market["id"], ROW, "editor", ORGANIZER))

        response = client.delete(f"/markets/{market['id']}/permissions")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["permissions"] == {ROW: _owners_row("editor")}
        assert _kinds(market_records, market) == [History.PERMISSION_SET]

    def test_copying_the_organizations_default_is_refused_when_a_row_it_copies_was_set_since(
            self, signed_in, market_in, interleave, real_db, market_records):
        client = signed_in(ORGANIZER)
        org_id = OrgsApi.create_organization(ORGANIZER, "Fixture Organization")
        OrgsApi.set_default_permission(org_id, ROW, "editor", ORGANIZER)
        market = market_in(MarketPhase.APPLICATIONS, organizationId=org_id)
        interleave("api.markets._load_market_to_change", lambda: MarketsApi.set_permission(
            market["id"], ROW, "owner", ORGANIZER))

        response = client.post(f"/markets/{market['id']}/permissions/organization-default")

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["permissions"] == {ROW: _owners_row("owner")}
        assert _kinds(market_records, market) == [History.PERMISSION_SET]
