"""Who the caller is.

One module, one answer, so that a route added later cannot get a different one by copying a
neighbour. Every organizer route used to take the caller's identity from an ``X-Owner-Email``
request header, which is a value the *caller* sets: ``@login_required`` proves someone is signed in,
never that they are who the header says. A second account with no relationship to a market could
therefore read and write it by naming its owner in that header (E07/F01/S02).

This lives in ``utils`` rather than in ``app.py`` because the blueprints need it too, and they
cannot import from ``app``. That split is exactly how two of these survived the first pass: the fix
was applied to ``app.py``'s 33 routes, and ``api/floorplans_save.py`` and
``api/floorplans_templates.py`` kept reading the header until the client stopped sending it and the
floorplan e2e spec went red.
"""
from flask_login import current_user


def authenticated_email() -> str:
    """The signed-in user's email, as the session proves it.

    Only call this from a route carrying ``@login_required``. Under that decorator ``current_user``
    is always a real user, so this never returns None and callers need no "identity missing" branch.
    """
    return current_user.email
