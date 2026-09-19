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
from typing import Any, Dict, List, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from datatypes import Application, ApplicationStatus, ApplicationType
from db_config import get_database
import essential_fields as EssentialFields

logger = logging.getLogger(__name__)

APPLICATIONS_COLLECTION = "applications"
MARKET_ID_FIELD = "market_id"
APPLICANT_EMAIL_FIELD = "applicant_email"
APPLICATION_TYPE_FIELD = "application_type"
STATUS_FIELD = "status"
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


def _newest_first(query: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every application matching a query, newest first, with the driver's key stripped.

    The ``_id`` Mongo adds is not part of the storage contract this module owns, and a caller
    that saw it would be able to depend on it.
    """
    ensure_application_indexes()
    documents = []
    for doc in applications_collection.find(query).sort("submitted_at", -1):
        doc.pop("_id", None)
        documents.append(doc)
    return documents


def list_applications_for_market(market_id: str) -> List[Dict[str, Any]]:
    """Return every application belonging to one market, newest first."""
    return _newest_first(market_filter(market_id))


def vendor_names_for_market(market_id: str) -> Dict[str, str]:
    """Every applicant's name in one market, keyed by the address that identifies them.

    ``{email: name}``, and only for applications that stored one - an application written before
    ``essential_full_name`` existed simply has no entry, which is what lets every surface fall
    back to the email and render exactly as the product did before.

    Lowercased keys, because that is the form every other reader matches on: ``record_attendance``
    normalizes, the importer lowercases on the way in, and a map whose keys did not would miss
    the one vendor whose form capitalized their address.

    A projection, not the whole application: the surfaces that need this - the tables grid, the
    payoff screen - want a name against an address and nothing else, and 232 applications' worth
    of ``form_data`` is not a thing to ship in order to read one key from each.
    """
    ensure_application_indexes()
    projection = {
        "_id": 0,
        APPLICANT_EMAIL_FIELD: 1,
        f"form_data.{EssentialFields.FULL_NAME_KEY}": 1,
    }
    names: Dict[str, str] = {}
    for doc in applications_collection.find(market_filter(market_id), projection):
        email = str(doc.get(APPLICANT_EMAIL_FIELD) or "").strip().lower()
        name = str((doc.get("form_data") or {}).get(EssentialFields.FULL_NAME_KEY) or "").strip()
        if email and name:
            names[email] = name
    return names


def find_application_by_id(app_id: str) -> Optional[Dict[str, Any]]:
    """Find one application by its ``id`` field."""
    ensure_application_indexes()
    doc = applications_collection.find_one({"id": app_id})
    if doc:
        doc.pop("_id", None)
    return doc


def find_application_by_email(market_id: str, email: str) -> Optional[Dict[str, Any]]:
    """Find one application by its market + email identity."""
    ensure_application_indexes()
    doc = applications_collection.find_one(
        applicant_filter(market_id, email, ApplicationType.MAIN.value)
    )
    if doc:
        doc.pop("_id", None)
    return doc


def update_application_status(app_id: str, status: ApplicationStatus) -> bool:
    """Set a new status on an application. Returns whether any document was matched."""
    ensure_application_indexes()
    result = applications_collection.update_one(
        {"id": app_id},
        {"$set": {"status": status.value}},
    )
    return result.matched_count > 0


def update_application_form_data(
    app_id: str, form_data: Dict[str, Any], submitted_at: str, updated_at: str,
) -> bool:
    """Write form answers and timestamps for an application."""
    ensure_application_indexes()
    result = applications_collection.update_one(
        {"id": app_id},
        {"$set": {
            "form_data": form_data,
            "submitted_at": submitted_at,
            "updated_at": updated_at,
        }},
    )
    return result.matched_count > 0


def list_applications_with_status(
    market_id: str, status: str, application_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Every application for a market holding one status, newest first.

    The counting functions below answer "how many", which is all the phase guards ever needed.
    The solver needs the applications themselves: assignment reads the approved ones and nothing
    else. ``application_type`` narrows further, because an applicant's waitlist application is a
    second document for the same address and a caller that wants one vendor per person must say
    so.
    """
    query: Dict[str, Any] = {**market_filter(market_id), STATUS_FIELD: status}
    if application_type is not None:
        query[APPLICATION_TYPE_FIELD] = application_type
    return _newest_first(query)


def count_applications_with_status(market_id: str, status: str) -> int:
    """How many applications for a market hold a specific status."""
    ensure_application_indexes()
    return applications_collection.count_documents({
        **market_filter(market_id),
        STATUS_FIELD: status,
    })


def count_applications_with_any_status(market_id: str, statuses: List[str]) -> int:
    """How many applications for a market hold any of the given statuses."""
    ensure_application_indexes()
    return applications_collection.count_documents({
        **market_filter(market_id),
        STATUS_FIELD: {"$in": list(statuses)},
    })


def sweep_unanswered_offers(market_id: str) -> int:
    """Mark every ``assignment_sent`` application for a market as ``vendor_refused``.

    This is the deadline mechanism: the admin holds the deadline, and this operation
    is what records it. Returns the number of applications swept.
    """
    ensure_application_indexes()
    result = applications_collection.update_many(
        {**market_filter(market_id), "status": ApplicationStatus.ASSIGNMENT_SENT.value},
        {"$set": {"status": ApplicationStatus.VENDOR_REFUSED.value}},
    )
    return result.modified_count
