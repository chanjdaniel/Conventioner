"""Where the organizer's session is kept, and why no default can be right.

A container keeps sessions on disk. A serverless function has no disk that outlives a request and has
to keep the session in the signed cookie. Whichever of those two you make the default is silently
wrong on the other host - and the one this app had was derived from ``FLASK_ENV``, which the
Dockerfile pins to ``development``, so the derivation answered "disk" on exactly the deployments that
have none.

So it is configuration now, and an unset value is a refusal that names itself rather than an
``OSError`` on a read-only filesystem at import.
"""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

from flask import Flask

from utils.deployment import INSECURE_LOCAL_DEV_VAR
from utils.session_storage import (
    IN_COOKIE,
    ON_DISK,
    SESSION_TYPE_VAR,
    SessionStorageNotConfiguredError,
    install_session_storage,
    session_backend,
)


@pytest.fixture
def local_dev(monkeypatch):
    monkeypatch.setenv(INSECURE_LOCAL_DEV_VAR, "true")


@pytest.fixture
def deployed(monkeypatch):
    """Anything that has not opted in -- which is every deployment, and the default."""
    monkeypatch.delenv(INSECURE_LOCAL_DEV_VAR, raising=False)


class TestADeploymentThatHasNotSaid:
    def test_refuses_to_start(self, monkeypatch, deployed):
        monkeypatch.delenv(SESSION_TYPE_VAR, raising=False)

        with pytest.raises(SessionStorageNotConfiguredError) as exc:
            session_backend()

        assert SESSION_TYPE_VAR in str(exc.value), "the refusal has to name the variable"
        assert IN_COOKIE in str(exc.value), "and the value a serverless deployment needs"

    @pytest.mark.parametrize("flask_env", ["development", "production", ""])
    def test_the_refusal_does_not_depend_on_flask_env(self, monkeypatch, deployed, flask_env):
        """The image ships FLASK_ENV=development and nothing overrides it. Deriving the backend from
        it handed every deployment built from that image the on-disk store, which is the one a
        serverless deployment cannot have."""
        monkeypatch.setenv("FLASK_ENV", flask_env)
        monkeypatch.delenv(SESSION_TYPE_VAR, raising=False)

        with pytest.raises(SessionStorageNotConfiguredError):
            session_backend()

    @pytest.mark.parametrize("backend", [ON_DISK, IN_COOKIE])
    def test_a_backend_this_app_serves_is_taken(self, monkeypatch, deployed, backend):
        monkeypatch.setenv(SESSION_TYPE_VAR, backend)

        assert session_backend() == backend

    def test_a_backend_this_app_does_not_serve_is_refused(self, monkeypatch, deployed):
        """flask-session raises on a backend it does not recognize, so the alternative to refusing
        here is the same refusal with a worse message and a stack trace."""
        monkeypatch.setenv(SESSION_TYPE_VAR, "redis")

        with pytest.raises(SessionStorageNotConfiguredError) as exc:
            session_backend()

        assert "redis" in str(exc.value)


class TestAnOptedInLocalDevMachine:
    def test_keeps_sessions_on_the_disk_it_has(self, monkeypatch, local_dev):
        monkeypatch.delenv(SESSION_TYPE_VAR, raising=False)

        assert session_backend() == ON_DISK

    def test_it_says_so(self, monkeypatch, local_dev, caplog):
        monkeypatch.delenv(SESSION_TYPE_VAR, raising=False)

        with caplog.at_level("WARNING"):
            session_backend()

        assert SESSION_TYPE_VAR in caplog.text


class TestInstallingIt:
    def test_the_on_disk_store_is_a_server_side_one(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        app = Flask(__name__)
        app.config["SECRET_KEY"] = "a-secret-the-signer-can-be-built-against"

        install_session_storage(app, ON_DISK)

        assert app.config["SESSION_TYPE"] == ON_DISK
        assert app.config["SESSION_FILE_DIR"]
        assert type(app.session_interface).__name__ == "FileSystemSessionInterface"

    def test_the_cookie_only_store_installs_nothing(self, tmp_path, monkeypatch):
        """flask-session has no `null` backend: handing it one raises `ValueError` at import, which
        is what the deployment guide's `SESSION_TYPE=null` would have done. Flask's own session
        interface already signs the session into the cookie, which is the whole of what a serverless
        function can keep - so the right move is not to install a store at all."""
        monkeypatch.chdir(tmp_path)
        app = Flask(__name__)
        app.config["SECRET_KEY"] = "a-secret-the-signer-can-be-built-against"
        default_interface = app.session_interface

        install_session_storage(app, IN_COOKIE)

        assert app.session_interface is default_interface
        assert app.config["SESSION_TYPE"] == IN_COOKIE
        assert "SESSION_FILE_DIR" not in app.config

    def test_the_cookie_only_store_touches_no_disk(self, tmp_path, monkeypatch):
        """The failure this closes: `os.makedirs` on a read-only serverless filesystem, at import,
        turning every request into a 500 that names nothing."""
        monkeypatch.chdir(tmp_path)
        app = Flask(__name__)
        app.config["SECRET_KEY"] = "a-secret-the-signer-can-be-built-against"

        install_session_storage(app, IN_COOKIE)

        assert list(tmp_path.iterdir()) == []
