"""A floorplan template is its creator's, and one filed under an organization is filed by someone in it.

Creating or updating a template reads ``organizationId`` as a string: any other type is refused,
an organization nobody has answers 404, and one the caller is not in (as owner, admin or member)
answers 403, as listing an organization's templates does. A template whose stored ``organizationId``
is not a string is treated as filed under no organization, so only its creator reaches it.
"""
from types import SimpleNamespace

import pytest

from conftest import sessions_load_through_get_user, skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
import api.floorplans_templates as TemplatesApi
import api.users as UsersApi

ACCOUNTS = {
    "creator@example.com": "user-creator",
    "org-owner@example.com": "user-org-owner",
    "org-admin@example.com": "user-org-admin",
    "org-member@example.com": "user-org-member",
    "outsider@example.com": "user-outsider",
}
ORG_ID = "org-123"
ORGANIZATION = {
    "id": ORG_ID,
    "name": "Hall Collective",
    "owner": "user-org-owner",
    "admins": ["user-org-admin"],
    "members": ["user-creator", "user-org-member"],
}
TEMPLATE_ID = "template-123"

NOT_STRINGS = [{"$ne": None}, [ORG_ID], 42, True]


class FakeTemplates:
    """The templates collection, matching a filter's fields by equality."""

    def __init__(self, *docs):
        self.docs = [dict(doc) for doc in docs]

    def _matches(self, doc, query):
        return all(doc.get(key) == value for key, value in query.items())

    def find_one(self, query):
        return next((dict(doc) for doc in self.docs if self._matches(doc, query)), None)

    def find(self, query):
        return [dict(doc) for doc in self.docs if self._matches(doc, query)]

    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id="inserted")

    def update_one(self, query, update):
        for doc in self.docs:
            if self._matches(doc, query):
                doc.update(update["$set"])
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    def delete_one(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]
        return SimpleNamespace(deleted_count=before - len(self.docs))


class FakeOrganizations:
    """The organizations collection, recording every filter it is asked with."""

    def __init__(self, *docs):
        self.docs = [dict(doc) for doc in docs]
        self.queries = []

    def find_one(self, query):
        self.queries.append(query)
        return next(
            (dict(doc) for doc in self.docs if all(doc.get(k) == v for k, v in query.items())),
            None,
        )


def _stored_template(**fields):
    return {
        "_id": "stored-1",
        "id": TEMPLATE_ID,
        "name": "Main hall",
        "ownerUserId": "user-creator",
        "organizationId": None,
        "tableTypes": [],
        "aisles": {},
        **fields,
    }


@pytest.fixture
def organizations(monkeypatch):
    store = FakeOrganizations(ORGANIZATION)
    monkeypatch.setattr(TemplatesApi, "organizations_collection", store)
    return store


@pytest.fixture
def templates(monkeypatch):
    store = FakeTemplates()
    monkeypatch.setattr(TemplatesApi, "templates_collection", store)
    return store


def _account(email):
    if email not in ACCOUNTS:
        return None
    return SimpleNamespace(
        id=ACCOUNTS[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def sign_in(monkeypatch):
    """A client signed in as one of the accounts."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _account)
    monkeypatch.setattr(
        UsersApi, "get_user_raw",
        lambda email: {"id": ACCOUNTS[email], "email": email} if email in ACCOUNTS else None,
    )

    def signed_in(email):
        client = app_module.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = email
            session["_fresh"] = True
        return client

    return signed_in


def _create(client, **fields):
    return client.post("/floorplans/templates", json={"name": "Main hall", **fields})


def _update(client, **fields):
    return client.put(f"/floorplans/templates/{TEMPLATE_ID}", json={"name": "Renamed", **fields})


class TestCreatingATemplate:

    @pytest.mark.parametrize("org_id", NOT_STRINGS)
    def test_an_organization_that_is_not_a_string_is_refused(
        self, sign_in, templates, organizations, org_id,
    ):
        response = _create(sign_in("creator@example.com"), organizationId=org_id)

        assert response.status_code == 400
        assert response.get_json() == {"error": "organizationId must be a string"}
        assert templates.docs == []
        assert organizations.queries == []

    def test_an_organization_the_caller_is_not_in_is_refused(
        self, sign_in, templates, organizations,
    ):
        response = _create(sign_in("outsider@example.com"), organizationId=ORG_ID)

        assert response.status_code == 403
        assert response.get_json() == {"error": "User does not belong to this organization"}
        assert templates.docs == []

    def test_an_organization_nobody_has_is_not_found(self, sign_in, templates, organizations):
        response = _create(sign_in("creator@example.com"), organizationId="org-unknown")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Organization not found"}
        assert templates.docs == []

    @pytest.mark.parametrize(
        "email", ["org-owner@example.com", "org-admin@example.com", "org-member@example.com"],
    )
    def test_someone_in_the_organization_files_a_template_under_it(
        self, sign_in, templates, organizations, email,
    ):
        response = _create(sign_in(email), organizationId=ORG_ID)

        assert response.status_code == 201
        assert response.get_json()["template"]["organizationId"] == ORG_ID
        [stored] = templates.docs
        assert stored["organizationId"] == ORG_ID
        assert stored["ownerUserId"] == ACCOUNTS[email]

    @pytest.mark.parametrize("fields", [{}, {"organizationId": None}])
    def test_a_template_with_no_organization_is_its_creators(
        self, sign_in, templates, organizations, fields,
    ):
        response = _create(sign_in("outsider@example.com"), **fields)

        assert response.status_code == 201
        [stored] = templates.docs
        assert stored["organizationId"] is None
        assert stored["ownerUserId"] == "user-outsider"
        assert organizations.queries == []


class TestUpdatingATemplate:

    @pytest.fixture
    def template(self, templates):
        templates.docs.append(_stored_template())
        return templates

    @pytest.mark.parametrize("org_id", NOT_STRINGS)
    def test_an_organization_that_is_not_a_string_is_refused(
        self, sign_in, template, organizations, org_id,
    ):
        response = _update(sign_in("creator@example.com"), organizationId=org_id)

        assert response.status_code == 400
        assert response.get_json() == {"error": "organizationId must be a string"}
        assert template.docs == [_stored_template()]
        assert organizations.queries == []

    def test_an_organization_the_caller_is_not_in_is_refused(self, sign_in, templates, organizations):
        templates.docs.append(_stored_template(ownerUserId="user-outsider"))

        response = _update(sign_in("outsider@example.com"), organizationId=ORG_ID)

        assert response.status_code == 403
        assert response.get_json() == {"error": "User does not belong to this organization"}
        assert templates.docs == [_stored_template(ownerUserId="user-outsider")]

    def test_an_organization_nobody_has_is_not_found(self, sign_in, template, organizations):
        response = _update(sign_in("creator@example.com"), organizationId="org-unknown")

        assert response.status_code == 404
        assert template.docs == [_stored_template()]

    def test_the_creator_files_it_under_an_organization_they_are_in(
        self, sign_in, template, organizations,
    ):
        response = _update(sign_in("creator@example.com"), organizationId=ORG_ID)

        assert response.status_code == 200
        [stored] = template.docs
        assert stored["organizationId"] == ORG_ID
        assert stored["name"] == "Renamed"

    def test_an_update_with_no_organization_leaves_it_as_it_is(
        self, sign_in, templates, organizations,
    ):
        templates.docs.append(_stored_template(organizationId=ORG_ID))

        response = _update(sign_in("creator@example.com"))

        assert response.status_code == 200
        [stored] = templates.docs
        assert stored["organizationId"] == ORG_ID
        assert stored["name"] == "Renamed"


class TestAStoredOrganizationThatIsNotAString:

    @pytest.fixture(params=NOT_STRINGS, ids=["object", "list", "number", "boolean"])
    def template(self, request, templates):
        templates.docs.append(_stored_template(organizationId=request.param))
        return templates

    @pytest.mark.parametrize("send", [
        lambda client: client.get(f"/floorplans/templates/{TEMPLATE_ID}"),
        lambda client: client.put(f"/floorplans/templates/{TEMPLATE_ID}", json={"name": "Renamed"}),
        lambda client: client.delete(f"/floorplans/templates/{TEMPLATE_ID}"),
    ], ids=["get", "update", "delete"])
    def test_another_account_is_refused_and_no_organization_is_looked_up(
        self, sign_in, template, organizations, send,
    ):
        before = [dict(doc) for doc in template.docs]

        response = send(sign_in("org-owner@example.com"))

        assert response.status_code == 403
        assert template.docs == before
        assert organizations.queries == []

    def test_its_creator_still_reaches_it(self, sign_in, template, organizations):
        response = sign_in("creator@example.com").get(f"/floorplans/templates/{TEMPLATE_ID}")

        assert response.status_code == 200
        assert organizations.queries == []


class TestAStoredOrganization:

    def test_the_organization_owner_reaches_a_template_filed_under_it(
        self, sign_in, templates, organizations,
    ):
        templates.docs.append(_stored_template(organizationId=ORG_ID))

        response = sign_in("org-owner@example.com").get(f"/floorplans/templates/{TEMPLATE_ID}")

        assert response.status_code == 200


class TestListingAnOrganizationsTemplates:

    def test_someone_in_the_organization_lists_its_templates(
        self, sign_in, templates, organizations,
    ):
        templates.docs.append(_stored_template(organizationId=ORG_ID))

        response = sign_in("org-member@example.com").get(
            f"/floorplans/templates?organizationId={ORG_ID}",
        )

        assert response.status_code == 200
        assert [t["id"] for t in response.get_json()["templates"]] == [TEMPLATE_ID]

    def test_an_account_outside_it_is_refused(self, sign_in, templates, organizations):
        response = sign_in("outsider@example.com").get(
            f"/floorplans/templates?organizationId={ORG_ID}",
        )

        assert response.status_code == 403

    def test_an_organization_nobody_has_is_not_found(self, sign_in, templates, organizations):
        response = sign_in("outsider@example.com").get(
            "/floorplans/templates?organizationId=org-unknown",
        )

        assert response.status_code == 404


class TestAnOrganizationsTemplateIsInItsHistory:
    """A template filed under an organization is the organization's: adding, changing and removing
    it record into its history (E40/F02/S01); a template of no organization records nothing."""

    @pytest.fixture
    def history(self, market_records):
        import history as History

        def entries():
            return [doc for doc in market_records.history.documents
                    if doc.get(History.ORGANIZATION_ID_FIELD) == ORG_ID]

        return entries

    def test_adding_one_is_recorded(self, sign_in, templates, organizations, history):
        import history as History

        _create(sign_in("org-member@example.com"), organizationId=ORG_ID)

        [entry] = history()
        [stored] = templates.docs
        assert entry["actor"] == "org-member@example.com"
        assert entry["action"] == History.MANAGE_FLOORPLAN_TEMPLATES
        assert entry["kind"] == History.TEMPLATE_ADDED
        assert entry["subject"] == {"template_id": stored["id"], "name": "Main hall"}
        assert entry["detail"] == {"before": {"name": None}, "after": {"name": "Main hall"}}

    def test_changing_one_records_the_fields_it_changed(
        self, sign_in, templates, organizations, history,
    ):
        import history as History

        templates.docs.append(_stored_template(organizationId=ORG_ID))

        _update(sign_in("creator@example.com"), aisles={"wallBufferMm": 900.0})

        [entry] = history()
        assert entry["kind"] == History.TEMPLATE_CHANGED
        assert entry["subject"] == {"template_id": TEMPLATE_ID, "name": "Renamed"}
        assert entry["detail"] == {
            "before": {"name": "Main hall", "aisles": {}},
            "after": {"name": "Renamed", "aisles": {"wallBufferMm": 900.0}},
        }

    def test_removing_one_is_recorded(self, sign_in, templates, organizations, history):
        import history as History

        templates.docs.append(_stored_template(organizationId=ORG_ID))

        sign_in("org-owner@example.com").delete(f"/floorplans/templates/{TEMPLATE_ID}")

        [entry] = history()
        assert entry["actor"] == "org-owner@example.com"
        assert entry["kind"] == History.TEMPLATE_REMOVED
        assert entry["subject"] == {"template_id": TEMPLATE_ID, "name": "Main hall"}
        assert entry["detail"] == {"before": {"name": "Main hall"}, "after": {"name": None}}

    def test_one_of_no_organization_records_nothing(
        self, sign_in, templates, organizations, market_records,
    ):
        _create(sign_in("creator@example.com"))
        _update(sign_in("creator@example.com"))
        sign_in("creator@example.com").delete(f"/floorplans/templates/{TEMPLATE_ID}")

        assert market_records.history.documents == []
