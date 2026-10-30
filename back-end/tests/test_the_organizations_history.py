"""The organization's history (E40/F02/S01).

An organization's own changes - its people, its name, ownership handed on, a market created in it,
and (E39/F02/S01) its default rows - are recorded in the one history every market change records
into, keyed by the organization, and read in Manage organization by its owner, admins and members.
Deleting the organization deletes its history; the deletion trail still records the deletion.
"""
from types import SimpleNamespace

import pytest

from conftest import mongo_matches, skip_without_real_dependencies, sessions_load_through_get_user
from test_reading_the_history import PagedHistory, _matches

import api.market_actions as Actions
import api.markets as MarketsApi
import api.organizations as OrgsApi
import history as History
from client_errors import ForbiddenError, NotFoundError
from lookup_indexes import LOOKUP_INDEXES

ORG = "org-1"
OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")
ADMIN = SimpleNamespace(id="user-admin", email="admin@example.com")
MEMBER = SimpleNamespace(id="user-member", email="member@example.com")
NEWCOMER = SimpleNamespace(id="user-new", email="new@example.com")
OUTSIDER = SimpleNamespace(id="user-out", email="outsider@example.com")
PEOPLE = (OWNER, ADMIN, MEMBER, NEWCOMER, OUTSIDER)


class Organizations:
    """The ``organizations`` collection: one document, written by Mongo's set operators."""

    def __init__(self, doc):
        self.doc = doc

    def find_one(self, query, projection=None):
        if self.doc is None or not mongo_matches(self.doc, query):
            return None
        return {key: list(value) if isinstance(value, list) else value
                for key, value in self.doc.items()}

    def update_one(self, _query, update):
        modified = 0
        for key, value in (update.get("$set") or {}).items():
            modified += self.doc.get(key) != value
            self.doc[key] = value
        for key, value in (update.get("$addToSet") or {}).items():
            if value not in self.doc.setdefault(key, []):
                self.doc[key].append(value)
                modified = 1
        for key, value in (update.get("$pull") or {}).items():
            if value in self.doc.get(key, []):
                self.doc[key].remove(value)
                modified = 1
        return SimpleNamespace(matched_count=1, modified_count=1 if modified else 0)

    def delete_one(self, _query):
        gone = self.doc is not None
        self.doc = None
        return SimpleNamespace(deleted_count=1 if gone else 0)


class History_(PagedHistory):
    """The ``history`` collection, read a page at a time and deleted by a filter."""

    def delete_many(self, query):
        gone = [doc for doc in self.docs if _matches(doc, query)]
        self.docs = [doc for doc in self.docs if doc not in gone]
        return SimpleNamespace(deleted_count=len(gone))


@pytest.fixture
def history(monkeypatch):
    fake = History_()
    monkeypatch.setattr(History, "history_collection", fake)
    return fake


@pytest.fixture
def org(monkeypatch, history):
    organizations = Organizations({
        "id": ORG, "name": "Ember Markets", "owner": OWNER.id, "admins": [ADMIN.id],
        "members": [MEMBER.id], "markets": [], "theme": None,
    })
    monkeypatch.setattr(OrgsApi, "organizations_collection", organizations)
    monkeypatch.setattr(
        OrgsApi, "users_collection",
        SimpleNamespace(update_one=lambda *_a, **_k: None, update_many=lambda *_a, **_k: None))
    by_email = {person.email: person for person in PEOPLE}
    by_id = {person.id: person for person in PEOPLE}
    monkeypatch.setattr(OrgsApi.UsersApi, "get_user", lambda email: by_email.get(email))
    monkeypatch.setattr(OrgsApi.UsersApi, "get_user_by_id", lambda user_id: by_id.get(user_id))
    return organizations


def entries(history):
    return [doc for doc in history.docs if doc.get("organization_id") == ORG]


def only(history):
    [entry] = entries(history)
    return entry


class TestWhatIsRecorded:
    def test_a_rename_says_who_when_and_the_name_before_and_after(self, org, history):
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")

        entry = only(history)
        assert entry["actor"] == OWNER.email
        assert entry["at"]
        assert entry["action"] == History.CHANGE_ORGANIZATION
        assert entry["kind"] == History.RENAMED
        assert entry["detail"] == {
            "before": {"name": "Ember Markets"}, "after": {"name": "Ember Collective"},
        }

    def test_an_entry_is_the_organizations_and_no_markets(self, org, history):
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")

        entry = only(history)
        assert entry["organization_id"] == ORG
        assert History.MARKET_ID_FIELD not in entry
        page, _next = History.entries_page(ORG)
        assert page == [], "an organization's entry is read as no market's"

    def test_a_rename_to_the_same_name_records_nothing(self, org, history):
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Markets")

        assert entries(history) == []

    def test_an_admin_added_is_a_role_given(self, org, history):
        OrgsApi.add_org_admin(ORG, NEWCOMER.email, OWNER.email)

        entry = only(history)
        assert entry["action"] == History.MANAGE_ORGANIZATION_ADMINS
        assert entry["kind"] == History.ROLE_GIVEN
        assert entry["subject"] == {"user_id": NEWCOMER.id, "email": NEWCOMER.email}
        assert entry["detail"] == {"before": {"role": None}, "after": {"role": "admin"}}

    def test_a_member_made_an_admin_is_a_role_changed(self, org, history):
        OrgsApi.add_org_admin(ORG, MEMBER.email, OWNER.email)

        entry = only(history)
        assert entry["action"] == History.MANAGE_ORGANIZATION_ADMINS
        assert entry["kind"] == History.ROLE_CHANGED
        assert entry["detail"] == {"before": {"role": "member"}, "after": {"role": "admin"}}

    def test_an_admin_added_again_records_nothing(self, org, history):
        OrgsApi.add_org_admin(ORG, ADMIN.email, OWNER.email)

        assert entries(history) == []

    def test_a_member_added_is_a_role_given(self, org, history):
        OrgsApi.add_org_member(ORG, NEWCOMER.email, ADMIN.email)

        entry = only(history)
        assert entry["actor"] == ADMIN.email
        assert entry["action"] == History.MANAGE_ORGANIZATION_MEMBERS
        assert entry["kind"] == History.ROLE_GIVEN
        assert entry["detail"] == {"before": {"role": None}, "after": {"role": "member"}}

    @pytest.mark.parametrize("person,role,action", [
        (ADMIN, "admin", History.MANAGE_ORGANIZATION_ADMINS),
        (MEMBER, "member", History.MANAGE_ORGANIZATION_MEMBERS),
    ], ids=["an admin", "a member"])
    def test_a_person_removed_is_a_role_taken(self, org, history, person, role, action):
        OrgsApi.remove_org_user(ORG, person.id, OWNER.email)

        entry = only(history)
        assert entry["action"] == action
        assert entry["kind"] == History.ROLE_TAKEN
        assert entry["subject"] == {"user_id": person.id, "email": person.email}
        assert entry["detail"] == {"before": {"role": role}, "after": {"role": None}}

    def test_ownership_handed_on_names_the_owner_before_and_after(self, org, history):
        OrgsApi.transfer_org_ownership(ORG, OWNER.email, ADMIN.email)

        entry = only(history)
        assert entry["action"] == History.TRANSFER_ORGANIZATION
        assert entry["kind"] is None
        assert entry["subject"] == {"user_id": ADMIN.id, "email": ADMIN.email}
        assert entry["detail"] == {
            "before": {"owner": OWNER.email}, "after": {"owner": ADMIN.email},
        }

    def test_ownership_handed_to_its_own_owner_is_refused_before_anything_changes(
        self, org, history,
    ):
        from client_errors import BadRequestError

        with pytest.raises(BadRequestError):
            OrgsApi.transfer_org_ownership(ORG, OWNER.email, OWNER.email)

        assert org.doc["owner"] == OWNER.id
        assert org.doc["admins"] == [ADMIN.id], "the owner was added to its own admins"
        assert entries(history) == []

    def test_a_market_created_in_it_is_recorded_with_its_name(self, org, history, monkeypatch):
        monkeypatch.setattr(MarketsApi, "organization_refusal", lambda *_a: None)
        monkeypatch.setattr(MarketsApi, "create_market", lambda market, _email: (None, "m-9"))

        market_id = MarketsApi.create_owned_market(MEMBER, {
            "name": "Winter Fair", "organization_id": ORG,
            "creation_date": "2026-10-30T00:00:00Z", "modification_list": [],
            "assignment_object": {},
        })

        entry = only(history)
        assert market_id == "m-9"
        assert entry["actor"] == MEMBER.email
        assert entry["action"] == History.CREATE_MARKET
        assert entry["subject"] == {"market_id": "m-9"}
        assert entry["detail"] == {"before": {"name": None}, "after": {"name": "Winter Fair"}}

    def test_a_refused_change_records_nothing(self, org, history):
        with pytest.raises(ForbiddenError):
            OrgsApi.update_organization(ORG, MEMBER.email, "Taken Over")

        assert entries(history) == []

    def test_a_store_that_fails_never_fails_the_change(self, org, history, monkeypatch):
        def refuse(_document):
            raise RuntimeError("the store is down")

        monkeypatch.setattr(history, "insert_one", refuse)

        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")

        assert org.doc["name"] == "Ember Collective"


class TestReadingIt:
    @pytest.mark.parametrize("reader", [OWNER, ADMIN, MEMBER], ids=["owner", "admin", "member"])
    def test_its_people_read_it_newest_first(self, org, history, reader):
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")
        OrgsApi.add_org_admin(ORG, NEWCOMER.email, OWNER.email)

        body = OrgsApi.get_history(ORG, reader.email)

        assert [entry["kind"] for entry in body["entries"]] == [
            History.ROLE_GIVEN, History.RENAMED]
        assert body["next"] is None
        assert set(body["entries"][0]) == {
            "id", "actor", "at", "action", "kind", "vendors", "subject", "detail"}

    def test_a_person_outside_the_organization_cannot_read_it(self, org, history):
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")

        with pytest.raises(ForbiddenError):
            OrgsApi.get_history(ORG, OUTSIDER.email)

    def test_a_missing_organization_is_not_found(self, org, history):
        with pytest.raises(NotFoundError):
            OrgsApi.get_history("org-gone", OWNER.email)

    def test_it_is_read_a_page_at_a_time(self, org, history):
        for n in range(History.PAGE_SIZE + 3):
            OrgsApi.update_organization(ORG, OWNER.email, f"Ember {n}")

        first = OrgsApi.get_history(ORG, OWNER.email)
        second = OrgsApi.get_history(ORG, OWNER.email, first["next"])

        assert len(first["entries"]) == History.PAGE_SIZE
        assert [entry["detail"]["after"]["name"] for entry in second["entries"]] == [
            "Ember 2", "Ember 1", "Ember 0"]
        assert second["next"] is None

    def test_a_cursor_that_is_not_one_is_refused(self, org, history):
        from client_errors import BadRequestError

        with pytest.raises(BadRequestError):
            OrgsApi.get_history(ORG, OWNER.email, "not a cursor")

    def test_the_first_page_names_the_tables_rows_for_the_default(self, org, history):
        body = OrgsApi.get_history(ORG, MEMBER.email)

        assert body["rowLabels"][Actions.CHECK_IN.id] == Actions.CHECK_IN.label

    def test_it_reads_one_organization_only(self, org, history):
        History.record_for_organization(
            "org-2", OWNER.email, History.CHANGE_ORGANIZATION, kind=History.RENAMED,
            detail={"before": {"name": "A"}, "after": {"name": "B"}})

        assert OrgsApi.get_history(ORG, OWNER.email)["entries"] == []

    def test_its_pages_walk_an_index(self):
        assert ("organization_id", "at", "id") in LOOKUP_INDEXES[History.HISTORY_COLLECTION]


class TestDeletingIt:
    def test_deleting_the_organization_deletes_its_history_and_still_writes_the_trail(
        self, org, history, monkeypatch,
    ):
        trail = []
        monkeypatch.setattr(OrgsApi, "markets_collection", SimpleNamespace(find=lambda _q: iter([])))
        monkeypatch.setattr(
            OrgsApi.DeletionTrail, "record_organization_deletion",
            lambda organization, doomed, actor: trail.append((organization["id"], actor)))
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")
        History.record_for_organization(
            "org-2", OWNER.email, History.CHANGE_ORGANIZATION, kind=History.RENAMED,
            detail={"before": {"name": "A"}, "after": {"name": "B"}})

        OrgsApi.delete_organization(ORG, OWNER.email)

        assert entries(history) == []
        assert [doc["organization_id"] for doc in history.docs] == ["org-2"], \
            "another organization's history is its own"
        assert trail == [(ORG, OWNER.email)]


class TestTheRoute:
    @pytest.fixture
    def client(self, monkeypatch, org):
        skip_without_real_dependencies()
        import app as app_module

        monkeypatch.setattr(app_module.login_manager, "session_protection", None)
        sessions_load_through_get_user(monkeypatch)
        client = app_module.app.test_client()

        def as_person(person):
            with client.session_transaction() as session:
                session["_user_id"] = person.email
                session["_fresh"] = True
            return client

        # A signed-in account, as the session loads it by its address.
        accounts = {person.email: SimpleNamespace(
            **vars(person), is_active=True, is_authenticated=True, is_anonymous=False,
            get_id=lambda email=person.email: email) for person in PEOPLE}
        monkeypatch.setattr(OrgsApi.UsersApi, "get_user", accounts.get)
        return as_person

    def test_a_member_reads_it(self, client, history):
        OrgsApi.update_organization(ORG, OWNER.email, "Ember Collective")

        response = client(MEMBER).get(f"/organizations/{ORG}/history")

        assert response.status_code == 200
        [entry] = response.get_json()["entries"]
        assert entry["actor"] == OWNER.email
        assert entry["detail"]["after"] == {"name": "Ember Collective"}

    def test_a_person_outside_is_refused(self, client, history):
        response = client(OUTSIDER).get(f"/organizations/{ORG}/history")

        assert response.status_code == 403

    def test_the_organization_itself_is_its_peoples_alone(self, client):
        """``GET /organizations/:id`` answered anyone signed in, whose id they had."""
        assert client(MEMBER).get(f"/organizations/{ORG}").status_code == 200
        assert client(OUTSIDER).get(f"/organizations/{ORG}").status_code == 403
        assert client(OWNER).get("/organizations/org-gone").status_code == 404


#: The organization's write routes that record nothing, and why.
NOT_RECORDED = {
    ("POST", "/organizations"): "creates the organization, whose history starts empty",
    ("DELETE", "/organizations/<org_id>"):
        "deletes the history with the organization; the deletion trail records it",
}

#: The organization's write routes that record, each the change ``TestWhatIsRecorded`` makes
#: through the function the route calls.
RECORDED = {
    ("PUT", "/organizations/<org_id>"): "a rename",
    ("POST", "/organizations/<org_id>/admins"): "an admin added",
    ("POST", "/organizations/<org_id>/members"): "a member added",
    ("DELETE", "/organizations/<org_id>/users/<user_id>"): "a person removed",
    ("POST", "/organizations/<org_id>/transfer"): "ownership handed on",
    # Sent in ``test_floorplan_template_access.py``; one of no organization records nothing.
    ("POST", "/floorplans/templates"): "a template added",
    ("PUT", "/floorplans/templates/<template_id>"): "a template changed",
    ("DELETE", "/floorplans/templates/<template_id>"): "a template removed",
}


def test_every_organization_write_route_records_or_says_why_not():
    """A write added to an organization or its templates fails here until it records, or this
    says why not."""
    skip_without_real_dependencies()
    import app as app_module

    routes = {
        (method, rule.rule)
        for rule in app_module.app.url_map.iter_rules()
        if rule.rule.startswith(("/organizations", "/floorplans/templates"))
        for method in rule.methods - {"GET", "HEAD", "OPTIONS"}
    }

    assert set(RECORDED).isdisjoint(NOT_RECORDED)
    assert routes == set(RECORDED) | set(NOT_RECORDED)


class TestAMarketDeleted:
    def test_deleting_a_market_is_recorded_in_its_organization(self, org, history, monkeypatch):
        market = SimpleNamespace(organization_id=ORG, name="Winter Fair")
        monkeypatch.setattr(MarketsApi, "load_market_context", lambda _id: SimpleNamespace(
            market=market, organization=None, document={}))
        monkeypatch.setattr(MarketsApi.Actions, "refusal", lambda *_a: None)
        monkeypatch.setattr(MarketsApi.MarketDeletion, "delete_market_and_records",
                            lambda _markets, _id: SimpleNamespace(deleted_count=1))
        monkeypatch.setattr(MarketsApi, "db", {"organizations": SimpleNamespace(
            update_one=lambda *_a, **_k: None)})

        MarketsApi.delete_market("m-9", ADMIN.email)
        monkeypatch.setattr(MarketsApi.MarketDeletion, "delete_market_and_records",
                            lambda _markets, _id: SimpleNamespace(deleted_count=0))
        MarketsApi.delete_market("m-9", ADMIN.email)

        entry = only(history)
        assert entry["actor"] == ADMIN.email
        assert entry["action"] == History.DELETE_MARKET
        assert entry["subject"] == {"market_id": "m-9"}
        assert entry["detail"] == {"before": {"name": "Winter Fair"}, "after": {"name": None}}


class TestReadingTheOrganization:
    @pytest.mark.parametrize("reader", [OWNER, ADMIN, MEMBER], ids=["owner", "admin", "member"])
    def test_its_people_read_it(self, org, reader):
        assert OrgsApi.read_organization(ORG, reader.email)["name"] == "Ember Markets"

    def test_a_person_outside_it_cannot(self, org):
        with pytest.raises(ForbiddenError):
            OrgsApi.read_organization(ORG, OUTSIDER.email)

    def test_a_missing_one_is_not_found(self, org):
        with pytest.raises(NotFoundError):
            OrgsApi.read_organization("org-gone", OWNER.email)
