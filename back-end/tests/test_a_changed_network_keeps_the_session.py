"""An organizer's sign-in is held to their browser, not their network address (T318, ADR 0030).

At a market's door the organizer's phone moves from the venue's wifi to mobile data, and every
request after it comes from another address. The session protection holds a session to the browser
string that signed in, so the phone stays signed in, while a session cookie replayed with another
browser string is refused at every request and ends no sign-in (T177).

A session signed in before this change carries Flask-Login's identifier, the hash of the address
and the browser together. Until T318 has been live for the 30 days a remembered sign-in lasts, it
is still taken from that address and browser, and stamped with the browser's own identifier in the
same answer, so the deploy signs nobody out.
"""
import os
import sys

import pytest
from flask_login.utils import _create_identifier

from conftest import skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
from test_the_remember_cookie import (  # noqa: F401  (the fixture)
    REMEMBER_COOKIE,
    _reopened,
    _sign_in,
    _signed_in,
    users,
)

PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Mobile/15E148 Safari/604.1"
ANOTHER_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0"
VENUE_WIFI = "198.51.100.7"
MOBILE_DATA = "203.0.113.42"


def _on(client, address, browser=PHONE):
    """Send the client's next requests from ``address`` with ``browser``'s string, as a proxy in
    front of the app names a caller: the peer address and ``X-Forwarded-For`` alike."""
    client.environ_base.update(
        REMOTE_ADDR=address, HTTP_X_FORWARDED_FOR=address, HTTP_USER_AGENT=browser)
    return client


@pytest.fixture
def phone():
    return _on(app_module.app.test_client(), VENUE_WIFI)


def _stamp(client):
    """The client identifier the browser's session holds."""
    with client.session_transaction() as held:
        return held.get("_id")


def _stamp_of(address, browser=PHONE):
    """The identifier the app stamps on a session that signs in from ``address`` with
    ``browser``."""
    signed_in = _on(app_module.app.test_client(), address, browser)
    _sign_in(signed_in)
    return _stamp(signed_in)


def _flask_logins_stamp(address, browser=PHONE):
    """Flask-Login's own identifier for a request from ``address`` with ``browser``: what a session
    signed in before T318 holds."""
    with app_module.app.test_request_context(
        environ_base={"REMOTE_ADDR": address, "HTTP_X_FORWARDED_FOR": address,
                      "HTTP_USER_AGENT": browser},
    ):
        return _create_identifier()


def _stamped_before_the_change(client):
    """Put on the client's session the identifier a sign-in before T318 stamped, as a session
    that outlived the deploy carries it."""
    address = client.environ_base["REMOTE_ADDR"]
    browser = client.environ_base["HTTP_USER_AGENT"]
    with client.session_transaction() as held:
        held["_id"] = _flask_logins_stamp(address, browser)


# The phone changes network.

@pytest.mark.parametrize("remember", [False, True])
def test_a_phone_that_moves_to_mobile_data_stays_signed_in(phone, users, remember):
    _sign_in(phone, remember=remember)
    assert _signed_in(phone)

    _on(phone, MOBILE_DATA)

    assert [_signed_in(phone) for _ in range(3)] == [True, True, True]
    assert _signed_in(_on(phone, VENUE_WIFI))


def test_a_phone_signed_in_on_mobile_data_stays_signed_in_on_the_venues_wifi(users):
    phone = _on(app_module.app.test_client(), MOBILE_DATA)
    _sign_in(phone)

    assert _signed_in(_on(phone, VENUE_WIFI))


def test_the_stamp_names_the_browser_alone(users):
    # Two sign-ins from two addresses with one browser string hold one identifier, and another
    # browser string holds another: nothing of the address is in it.
    assert _stamp_of(VENUE_WIFI) == _stamp_of(MOBILE_DATA)
    assert _stamp_of(VENUE_WIFI) != _stamp_of(VENUE_WIFI, ANOTHER_BROWSER)


def test_the_stamp_is_never_flask_logins_own(users):
    # The browser's identifier is a scheme of its own, so a session stamped before the change can
    # never pass for one stamped after it, whatever the address.
    assert _stamp_of(VENUE_WIFI) != _flask_logins_stamp(VENUE_WIFI)
    assert _stamp_of(VENUE_WIFI) != _flask_logins_stamp("")


# Another browser is still refused (T177).

@pytest.mark.parametrize("address", [VENUE_WIFI, MOBILE_DATA], ids=["same-address", "another"])
@pytest.mark.parametrize("remember", [False, True])
def test_another_browser_string_is_refused_and_ends_no_sign_in(phone, users, remember, address):
    _sign_in(phone, remember=remember)

    odd = phone.get("/check-session", environ_base={
        "REMOTE_ADDR": address, "HTTP_X_FORWARDED_FOR": address,
        "HTTP_USER_AGENT": ANOTHER_BROWSER})

    assert odd.status_code == 401
    assert [_signed_in(phone) for _ in range(2)] == [True, True]
    assert _signed_in(_on(phone, MOBILE_DATA))


@pytest.mark.parametrize("address", [VENUE_WIFI, MOBILE_DATA], ids=["same-address", "another"])
def test_a_copied_session_cookie_in_another_browser_is_refused_at_every_request(
    phone, users, address
):
    _sign_in(phone)
    copied = _on(app_module.app.test_client(), address, ANOTHER_BROWSER)
    copied.set_cookie("session", phone.get_cookie("session").value)

    assert [copied.get("/check-session").status_code for _ in range(3)] == [401, 401, 401]
    assert _signed_in(_on(phone, MOBILE_DATA))


# A remembered sign-in.

def test_a_remembered_sign_in_restored_on_another_network_is_stamped_with_the_browser(
    phone, users
):
    _sign_in(phone, remember=True)
    reopened = _on(_reopened(phone), MOBILE_DATA)

    assert _signed_in(reopened)
    assert _stamp(reopened) == _stamp_of(VENUE_WIFI)
    assert [_signed_in(_on(reopened, VENUE_WIFI)) for _ in range(2)] == [True, True]
    assert reopened.get_cookie(REMEMBER_COOKIE) is not None


def test_a_remembered_sign_in_restored_is_refused_in_another_browser(phone, users):
    _sign_in(phone, remember=True)
    reopened = _on(_reopened(phone), MOBILE_DATA)
    assert _signed_in(reopened)

    elsewhere = reopened.get("/check-session", headers={"User-Agent": ANOTHER_BROWSER})

    assert elsewhere.status_code == 401
    assert _signed_in(reopened)


# A session signed in before the change carries over the deploy.

def test_a_session_stamped_before_the_change_is_taken_and_stamped_anew(phone, users):
    _sign_in(phone)
    _stamped_before_the_change(phone)
    assert _stamp(phone) == _flask_logins_stamp(VENUE_WIFI)

    answer = phone.get("/check-session")

    assert answer.status_code == 200
    assert _stamp(phone) == _stamp_of(VENUE_WIFI)
    # Stamped anew, it is the browser's own from here: the phone may change network.
    assert _signed_in(_on(phone, MOBILE_DATA))


def test_a_session_stamped_before_the_change_is_refused_from_another_address(phone, users):
    _sign_in(phone)
    _stamped_before_the_change(phone)
    before = _stamp(phone)

    # The old identifier names the address too, so it holds only where it was stamped: nothing it
    # did not hold before the change is let in by the carry-over.
    assert _on(phone, MOBILE_DATA).get("/check-session").status_code == 401
    assert _stamp(phone) == before
    assert _signed_in(_on(phone, VENUE_WIFI))


def test_a_session_stamped_before_the_change_is_refused_in_another_browser(phone, users):
    _sign_in(phone)
    _stamped_before_the_change(phone)

    odd = phone.get("/check-session", headers={"User-Agent": ANOTHER_BROWSER})

    assert odd.status_code == 401
    assert _signed_in(phone)
