import os
import sys
import types

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.captcha import verify_recaptcha


class TestCaptchaBypass:
    def test_bypass_when_disable_captcha_enabled(self, monkeypatch):
        monkeypatch.setenv("DISABLE_CAPTCHA", "true")
        monkeypatch.setenv("FLASK_ENV", "development")
        monkeypatch.delenv("RECAPTCHA_SECRET_KEY", raising=False)

        success, score = verify_recaptcha("dummy-token")

        assert success is True
        assert score == 1.0

    def test_bypass_when_disable_captcha_is_1(self, monkeypatch):
        monkeypatch.setenv("DISABLE_CAPTCHA", "1")
        monkeypatch.setenv("FLASK_ENV", "development")
        monkeypatch.delenv("RECAPTCHA_SECRET_KEY", raising=False)

        success, score = verify_recaptcha("dummy-token")

        assert success is True
        assert score == 1.0

    def test_disable_captcha_ignored_in_production(self, monkeypatch):
        monkeypatch.setenv("DISABLE_CAPTCHA", "true")
        monkeypatch.setenv("FLASK_ENV", "production")

        class FakeResponse:
            def json(self):
                return {"success": False, "score": 0.1}

        def fake_post(url, data, timeout):
            return FakeResponse()

        monkeypatch.setattr("utils.captcha.requests.post", fake_post)

        import utils.captcha as captcha_mod
        monkeypatch.setattr(captcha_mod, "RECAPTCHA_SECRET_KEY", "prod-secret-key")

        success, score = verify_recaptcha("dummy-token")

        assert success is False
        assert score == 0.1

    def test_dev_bypass_when_no_secret_key(self, monkeypatch):
        monkeypatch.delenv("DISABLE_CAPTCHA", raising=False)
        monkeypatch.delenv("RECAPTCHA_SECRET_KEY", raising=False)
        monkeypatch.setenv("FLASK_ENV", "development")

        success, score = verify_recaptcha("dummy-token")

        assert success is True
        assert score == 1.0

    def test_enforced_when_secret_key_set_and_no_bypass(self, monkeypatch):
        monkeypatch.delenv("DISABLE_CAPTCHA", raising=False)
        monkeypatch.setenv("FLASK_ENV", "development")

        class FakeResponse:
            def json(self):
                return {"success": False, "score": 0.1}

        def fake_post(url, data, timeout):
            return FakeResponse()

        monkeypatch.setattr("utils.captcha.requests.post", fake_post)

        import utils.captcha as captcha_mod
        monkeypatch.setattr(captcha_mod, "RECAPTCHA_SECRET_KEY", "test-secret-key")

        success, score = verify_recaptcha("bad-token")

        assert success is False
        assert score == 0.1

    def test_enforced_rejects_empty_token_with_secret_key(self, monkeypatch):
        monkeypatch.delenv("DISABLE_CAPTCHA", raising=False)
        monkeypatch.setenv("FLASK_ENV", "development")

        import utils.captcha as captcha_mod
        monkeypatch.setattr(captcha_mod, "RECAPTCHA_SECRET_KEY", "test-secret-key")

        success, score = verify_recaptcha("", ip_address=None)

        assert success is False
        assert score == 0.0
