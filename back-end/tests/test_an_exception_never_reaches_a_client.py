"""An exception never reaches a client: what a client reads when a route refuses or fails.

A refusal meant for the client is a client error, answered with its own status and the copy our
code wrote. Anything else is the server's fault: logged once with its traceback, and answered
``{"error": "Internal server error"}``, 500, with nothing of the exception in it. Flask's own
answers (an unknown URL, a wrong method, Flask-Login's 401) pass through untouched.

Pinned through the test client against the real app, on the four assignment reads that used to
answer an exception's text, type, function and a timestamp.
"""
import logging
from types import SimpleNamespace

import pytest

from conftest import (
    COMPLETE_PLAN,
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi
from client_errors import (
    BadRequestError,
    ClientError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from datatypes import MarketPhase


OWNER_EMAIL = "owner@example.com"
OWNER_ID = "user-1"

# Shaped like what a failing library writes into its message: a host and a password. A client must
# never read it, and the log must.
SECRET = "authentication failed on db-primary.test:27017 with password hunter2-s3cr3t"

ASSIGNMENT_READS = [
    ("/markets/market-123/assignment", "get_assigned_market"),
    ("/markets/market-123/assignment-statistics", "get_assignment_statistics"),
    ("/markets/market-123/assignment-csv", "get_assignment_csv"),
    ("/markets/market-123/tables", "get_market_tables"),
]


@pytest.fixture
def client(monkeypatch):
    """Signed in as the market's owner, through the session as in production."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=OWNER_ID, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email == OWNER_EMAIL else None,
    )
    monkeypatch.setattr(
        MarketsApi, "markets_collection",
        FakeMarketsCollection(
            stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=COMPLETE_PLAN)
        ),
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client


def fail_with(exception):
    def _raise(*_args, **_kwargs):
        raise exception
    return _raise


class TestTheTypes:
    """What a raise site gets to say, and which builtin refusals the unmigrated routes still catch."""

    def test_each_type_carries_its_status_and_its_copy(self):
        for error_type, status in (
            (BadRequestError, 400), (ForbiddenError, 403), (NotFoundError, 404), (ConflictError, 409),
        ):
            error = error_type("Organization name required")
            assert isinstance(error, ClientError)
            assert error.status == status
            assert error.message == "Organization name required"
            assert error.body() == {"error": "Organization name required"}

    def test_the_expand_keeps_the_builtin_bases_the_raise_sites_had(self):
        assert issubclass(BadRequestError, ValueError)
        assert issubclass(NotFoundError, ValueError)
        assert issubclass(ForbiddenError, PermissionError)
        assert not issubclass(ConflictError, (ValueError, PermissionError))


class TestAClientError:
    def test_is_answered_with_its_status_and_copy(self, client, monkeypatch):
        monkeypatch.setattr(
            MarketsApi, "get_assignment_statistics",
            fail_with(ConflictError("Someone else moved this market on")),
        )

        response = client.get("/markets/market-123/assignment-statistics")

        assert response.status_code == 409
        assert response.get_json() == {"error": "Someone else moved this market on"}

    def test_with_a_structured_body_is_answered_as_given(self, client, monkeypatch):
        class Blocked(ConflictError):
            def body(self):
                return {"error": self.message, "blockers": [{"id": "form-locked"}]}

        monkeypatch.setattr(
            MarketsApi, "get_market_tables", fail_with(Blocked("The form is locked")),
        )

        response = client.get("/markets/market-123/tables")

        assert response.status_code == 409
        assert response.get_json() == {
            "error": "The form is locked", "blockers": [{"id": "form-locked"}],
        }

    def test_is_not_logged_as_a_failure(self, client, monkeypatch, caplog):
        monkeypatch.setattr(
            MarketsApi, "get_assignment_csv", fail_with(NotFoundError("Market not found")),
        )

        with caplog.at_level(logging.INFO, logger="client_errors"):
            response = client.get("/markets/market-123/assignment-csv")

        assert response.status_code == 404
        assert [r for r in caplog.records if r.name == "client_errors"] == []


class TestAnUnexpectedFailure:
    @pytest.mark.parametrize("path, function", ASSIGNMENT_READS)
    def test_answers_only_internal_server_error(self, client, monkeypatch, path, function):
        monkeypatch.setattr(MarketsApi, function, fail_with(RuntimeError(SECRET)))

        response = client.get(path)

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)
        assert "RuntimeError" not in response.get_data(as_text=True)

    @pytest.mark.parametrize("path, function", ASSIGNMENT_READS)
    def test_is_logged_once_with_its_traceback_and_the_market(
        self, client, monkeypatch, caplog, path, function,
    ):
        monkeypatch.setattr(MarketsApi, function, fail_with(RuntimeError(SECRET)))

        with caplog.at_level(logging.ERROR):
            client.get(path)

        records = [r for r in caplog.records if r.name == "client_errors"]
        assert len(records) == 1
        record = records[0]
        assert record.exc_info is not None and record.exc_info[0] is RuntimeError
        assert SECRET in caplog.text  # the traceback, for whoever is on call
        assert "GET" in record.getMessage()
        assert function in record.getMessage()
        assert "market-123" in record.getMessage()
        assert OWNER_EMAIL not in caplog.text

    def test_inside_the_api_function_answers_the_same(self, client, monkeypatch, caplog):
        """What the four API functions caught and echoed now reaches the handler unanswered."""
        monkeypatch.setattr(MarketsApi, "solver_vendors_for", fail_with(KeyError(SECRET)))

        with caplog.at_level(logging.ERROR):
            responses = [client.get(path) for path, _function in ASSIGNMENT_READS]

        for response in responses:
            assert response.status_code == 500
            assert response.get_json() == {"error": "Internal server error"}
            assert SECRET not in response.get_data(as_text=True)
        assert len([r for r in caplog.records if r.name == "client_errors"]) == len(responses)

    def test_in_the_csv_writer_is_not_echoed(self, client, monkeypatch):
        monkeypatch.setattr(MarketsApi, "solver_vendors_for", lambda _market: [])
        monkeypatch.setattr(
            MarketsApi, "market_csv_to_string", fail_with(ValueError(SECRET)),
        )

        response = client.get("/markets/market-123/assignment-csv")

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        assert SECRET not in response.get_data(as_text=True)

    def test_never_logs_a_vendors_address_the_path_or_the_body(self, client, monkeypatch, caplog):
        monkeypatch.setattr(MarketsApi, "save_vendor_note", fail_with(RuntimeError("boom")))

        with caplog.at_level(logging.ERROR):
            response = client.put(
                "/markets/market-123/vendor-notes/ana.vendor@example.com?ref=ana.vendor@example.com",
                json={"note": "Ana asked for a corner table"},
            )

        assert response.status_code == 500
        assert response.get_json() == {"error": "Internal server error"}
        [record] = [r for r in caplog.records if r.name == "client_errors"]
        assert "market-123" in record.getMessage()
        assert "ana.vendor@example.com" not in caplog.text
        assert "vendor-notes" not in record.getMessage()
        assert "corner table" not in caplog.text


class TestFlasksOwnAnswers:
    def test_an_unknown_url_is_still_flasks_404(self, client):
        response = client.get("/no-such-route")

        assert response.status_code == 404
        assert response.get_json() is None
        assert "Not Found" in response.get_data(as_text=True)

    def test_a_wrong_method_is_still_flasks_405(self, client):
        response = client.delete("/markets/market-123/assignment-statistics")

        assert response.status_code == 405
        assert response.get_json() is None
        assert "Method Not Allowed" in response.get_data(as_text=True)

    def test_a_signed_out_call_is_still_flask_logins_401(self, monkeypatch):
        called = []
        monkeypatch.setattr(
            MarketsApi, "get_assignment_statistics", lambda *args: called.append(args),
        )

        response = app_module.app.test_client().get("/markets/market-123/assignment-statistics")

        assert response.status_code == 401
        assert response.get_json() is None
        assert "Unauthorized" in response.get_data(as_text=True)
        assert called == []
