"""The health check the Deploy workflow and the uptime check read."""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
from api import markets as MarketsApi

A_COMMIT = "0123456789abcdef0123456789abcdef01234567"


class _Database:
    def __init__(self, error=None):
        self.error = error

    def command(self, name):
        if self.error:
            raise self.error
        return {"ok": 1}


class _Collection:
    def __init__(self, database):
        self.database = database


@pytest.fixture
def client():
    return app_module.app.test_client()


@pytest.fixture
def database_answers(monkeypatch):
    monkeypatch.setattr(MarketsApi, "markets_collection", _Collection(_Database()))


@pytest.fixture
def database_does_not_answer(monkeypatch):
    monkeypatch.setattr(
        MarketsApi, "markets_collection", _Collection(_Database(TimeoutError("no server")))
    )


def test_a_deployment_whose_database_answers_is_healthy(client, monkeypatch, database_answers):
    monkeypatch.setenv("BUILD_COMMIT", A_COMMIT)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok", "commit": A_COMMIT}


def test_a_deployment_whose_database_does_not_answer_is_unavailable(
    client, monkeypatch, database_does_not_answer
):
    monkeypatch.setenv("BUILD_COMMIT", A_COMMIT)

    response = client.get("/healthz")

    assert response.status_code == 503
    assert response.get_json() == {"status": "unavailable", "commit": A_COMMIT}


def test_a_build_with_no_commit_says_null(client, monkeypatch, database_answers):
    monkeypatch.delenv("BUILD_COMMIT", raising=False)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok", "commit": None}


def test_an_unavailable_build_with_no_commit_says_null(
    client, monkeypatch, database_does_not_answer
):
    monkeypatch.delenv("BUILD_COMMIT", raising=False)

    response = client.get("/healthz")

    assert response.status_code == 503
    assert response.get_json() == {"status": "unavailable", "commit": None}


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_a_blank_commit_says_null(client, monkeypatch, database_answers, blank):
    monkeypatch.setenv("BUILD_COMMIT", blank)

    response = client.get("/healthz")

    assert response.get_json() == {"status": "ok", "commit": None}


def test_a_commit_is_reported_exactly_as_given(client, monkeypatch, database_answers):
    monkeypatch.setenv("BUILD_COMMIT", " not-a-sha ")

    response = client.get("/healthz")

    assert response.get_json() == {"status": "ok", "commit": " not-a-sha "}


def test_the_commit_is_read_at_each_answer(client, monkeypatch, database_answers):
    monkeypatch.setenv("BUILD_COMMIT", A_COMMIT)
    client.get("/healthz")
    monkeypatch.setenv("BUILD_COMMIT", "fedcba9876543210fedcba9876543210fedcba98")

    response = client.get("/healthz")

    assert response.get_json()["commit"] == "fedcba9876543210fedcba9876543210fedcba98"
