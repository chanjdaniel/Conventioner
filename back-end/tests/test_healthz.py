"""The health check the Deploy workflow and the uptime check read."""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
from api import markets as MarketsApi
from utils.deployment import INSECURE_LOCAL_DEV_VAR, PLATFORM_SIGNALS

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
def client(monkeypatch):
    """The suite's own process: the hatch on, and no platform variable set."""
    for signal in PLATFORM_SIGNALS:
        monkeypatch.delenv(signal, raising=False)
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")
    return app_module.app.test_client()


def _local(body):
    """What this suite's process answers beside the given keys."""
    return {**body, "deployed": False, "localDev": True}


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
    assert response.get_json() == _local({"status": "ok", "commit": A_COMMIT})


def test_a_deployment_whose_database_does_not_answer_is_unavailable(
    client, monkeypatch, database_does_not_answer
):
    monkeypatch.setenv("BUILD_COMMIT", A_COMMIT)

    response = client.get("/healthz")

    assert response.status_code == 503
    assert response.get_json() == _local({"status": "unavailable", "commit": A_COMMIT})


def test_a_build_with_no_commit_says_null(client, monkeypatch, database_answers):
    monkeypatch.delenv("BUILD_COMMIT", raising=False)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.get_json() == _local({"status": "ok", "commit": None})


def test_an_unavailable_build_with_no_commit_says_null(
    client, monkeypatch, database_does_not_answer
):
    monkeypatch.delenv("BUILD_COMMIT", raising=False)

    response = client.get("/healthz")

    assert response.status_code == 503
    assert response.get_json() == _local({"status": "unavailable", "commit": None})


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_a_blank_commit_says_null(client, monkeypatch, database_answers, blank):
    monkeypatch.setenv("BUILD_COMMIT", blank)

    response = client.get("/healthz")

    assert response.get_json() == _local({"status": "ok", "commit": None})


def test_a_commit_is_reported_exactly_as_given(client, monkeypatch, database_answers):
    monkeypatch.setenv("BUILD_COMMIT", " not-a-sha ")

    response = client.get("/healthz")

    assert response.get_json() == _local({"status": "ok", "commit": " not-a-sha "})


def test_the_commit_is_read_at_each_answer(client, monkeypatch, database_answers):
    monkeypatch.setenv("BUILD_COMMIT", A_COMMIT)
    client.get("/healthz")
    monkeypatch.setenv("BUILD_COMMIT", "fedcba9876543210fedcba9876543210fedcba98")

    response = client.get("/healthz")

    assert response.get_json()["commit"] == "fedcba9876543210fedcba9876543210fedcba98"


@pytest.mark.parametrize("signal", PLATFORM_SIGNALS)
@pytest.mark.parametrize("database", ["database_answers", "database_does_not_answer"])
def test_a_deployed_host_says_so_with_the_hatch_off(client, monkeypatch, request, signal, database):
    """What production answers: `deployed` true by any platform variable, `localDev` false."""
    request.getfixturevalue(database)
    monkeypatch.setenv(signal, "1")
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR)

    body = client.get("/healthz").get_json()

    assert (body["deployed"], body["localDev"]) == (True, False)


@pytest.mark.parametrize("hatch", ["true", " 1 ", "TRUE"])
def test_local_dev_follows_the_hatch(client, monkeypatch, database_answers, hatch):
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, hatch)

    assert client.get("/healthz").get_json()["localDev"] is True


@pytest.mark.parametrize("off", ["false", "", "0"])
def test_local_dev_is_false_with_the_hatch_off(client, monkeypatch, database_answers, off):
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, off)

    assert client.get("/healthz").get_json()["localDev"] is False


def test_a_blank_platform_variable_is_not_deployed(client, monkeypatch, database_answers):
    monkeypatch.setenv("VERCEL", "  ")

    assert client.get("/healthz").get_json()["deployed"] is False
