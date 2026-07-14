"""Single owner of the ``applications`` collection.

Every reader and writer of an application document goes through this module so the
storage contract lives in exactly one place.

Storage contract: application documents are persisted **snake_case**, matching the
``Application`` model in ``datatypes.py``. In particular the market foreign key is
``market_id``, not ``marketId`` - markets are camelCased on write, applications are not.
The D9 form lock counts applications by that key, so a writer that stored the market
reference under any other name would silently disable the lock.

Identity contract: (``market_id``, ``applicant_email``, ``application_type``) identifies an
application, and the database is what enforces that -- see ``ensure_application_indexes``.
"""
import logging
from typing import Any, Dict

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from datatypes import Application
from db_config import get_database

logger = logging.getLogger(__name__)

APPLICATIONS_COLLECTION = "applications"
MARKET_ID_FIELD = "market_id"
APPLICANT_EMAIL_FIELD = "applicant_email"
APPLICATION_TYPE_FIELD = "application_type"
APPLICANT_IDENTITY_INDEX = "market_applicant_type_unique"

db = get_database()
applications_collection = db[APPLICATIONS_COLLECTION]

_indexes_ready = False


class ApplicationIndexError(RuntimeError):
    """The index that makes an applicant one applicant is not in place."""


def ensure_application_indexes() -> None:
    """The identity of an application, enforced where it can actually hold.

    An applicant is one applicant: one main application per (market, address), and one waitlist
    application beside it. Nothing in application code can promise that, because the write that
    creates the document is a read-then-insert on a public endpoint -- two concurrent requests for
    the same new address both find nothing and both insert, and the market is then left with two
    main applications for one person. Only one of them is reachable (every read of an applicant's
    application finds one document and takes it), so the other is an orphan that sits on the
    organizer's applicant list, double-counts the applicant through review and assignment, and
    double-counts the D9 form lock. It is reachable on purpose by racing the endpoint, and by
    accident through a double-click or a retried request.

    So uniqueness is the database's, and creation is written against it -- see
    ``find_or_create_application``.

    A build that fails raises, and the caller fails with it. This index is not a decoration on a
    guarantee the code keeps anyway: it *is* the guarantee, the whole of it, and a process that
    cannot build it is a process where ``find_or_create_application`` is a read-then-insert with
    nothing behind it. Logging that and serving anyway is the one thing this product does not do
    with a defense it cannot confirm - the market-key migration and the public-endpoint
    configuration both fail closed, and for the same reason: an unknown state is not a safe one.
    The likeliest cause is duplicates already in the collection, which is precisely the corruption
    the index exists to prevent, and which serving on would only deepen. ``app.py`` asserts this at
    boot, so a deployment that cannot hold it says so before it takes a request rather than in the
    middle of one.

    Built lazily rather than at import: an index build is a network call, and this module is
    imported by tooling and tests that never reach the database.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        applications_collection.create_index(
            [(MARKET_ID_FIELD, 1), (APPLICANT_EMAIL_FIELD, 1), (APPLICATION_TYPE_FIELD, 1)],
            unique=True,
            name=APPLICANT_IDENTITY_INDEX,
        )
    except PyMongoError as exc:
        message = (
            f"The unique index {APPLICANT_IDENTITY_INDEX} on "
            f"({MARKET_ID_FIELD}, {APPLICANT_EMAIL_FIELD}, {APPLICATION_TYPE_FIELD}) could not be "
            f"built, so nothing is stopping one applicant from holding two applications at one "
            f"market. If the collection already holds duplicates, that is what is blocking the "
            f"build, and they have to be merged or removed before applications can be served: "
            f"{exc}"
        )
        logger.critical("%s", message)
        raise ApplicationIndexError(message) from exc
    _indexes_ready = True


def market_filter(market_id: str) -> Dict[str, Any]:
    """The canonical query for every application belonging to one market."""
    return {MARKET_ID_FIELD: market_id}


def applicant_filter(market_id: str, email: str, application_type: str) -> Dict[str, Any]:
    """The canonical query for the one application an applicant has of this type at this market."""
    return {
        MARKET_ID_FIELD: market_id,
        APPLICANT_EMAIL_FIELD: email,
        APPLICATION_TYPE_FIELD: application_type,
    }


def count_applications_for_market(market_id: str) -> int:
    """How many applications exist for a market. Drives the D9 application-form lock."""
    return applications_collection.count_documents(market_filter(market_id))


def find_or_create_application(app: Application) -> Application:
    """Store this application, unless one already exists for the applicant it belongs to.

    A single conditional upsert, so that a request which loses the race to another one for the same
    address does not leave a second document behind: the identity fields are the filter, the rest of
    the document is written only on insert, and the unique index in ``ensure_application_indexes`` is
    what makes the losing insert fail rather than duplicate.

    That failure is a ``DuplicateKeyError``, which an upsert can raise even though it matched
    nothing -- the winner's insert lands between this one's read and its own write -- so it is caught
    and the winner's document is returned. Either way the caller gets the one application that
    exists, which is what it asked for.
    """
    ensure_application_indexes()
    identity = applicant_filter(
        app.market_id, app.applicant_email, app.application_type.value,
    )
    # The identity fields come from the filter, which is where an upsert takes them from; repeating
    # them in the insert body would only be a second chance to disagree with it.
    body = {key: value for key, value in app.model_dump().items() if key not in identity}

    for _attempt in range(2):
        try:
            stored = applications_collection.find_one_and_update(
                identity,
                {"$setOnInsert": body},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            if stored:
                return Application(**stored)
        except DuplicateKeyError:
            pass
        existing = applications_collection.find_one(identity)
        if existing:
            return Application(**existing)

    raise PyMongoError(
        f"Could not store the application for {app.applicant_email}: a concurrent write for the "
        f"same applicant keeps winning, and no document for them can be read back."
    )
