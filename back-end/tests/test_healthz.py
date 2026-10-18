"""The health check the post-deploy smoke test and the uptime check read."""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
from api import markets as MarketsApi


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


def test_a_deployment_whose_database_answers_is_healthy(client, monkeypatch):
    monkeypatch.setattr(MarketsApi, "markets_collection", _Collection(_Database()))

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_a_deployment_whose_database_does_not_answer_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(
        MarketsApi, "markets_collection", _Collection(_Database(TimeoutError("no server")))
    )

    response = client.get("/healthz")

    assert response.status_code == 503
    assert response.get_json() == {"status": "unavailable"}
