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
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from datatypes import (
    AnswerUpdate, Application, ApplicationStatus, ApplicationType, FormField, MarketPerson, VerdictGiver,
)
from db_config import get_database
import essential_fields as EssentialFields

logger = logging.getLogger(__name__)

APPLICATIONS_COLLECTION = "applications"
MARKET_ID_FIELD = "market_id"
APPLICANT_EMAIL_FIELD = "applicant_email"
APPLICATION_TYPE_FIELD = "application_type"
STATUS_FIELD = "status"
ANSWER_UPDATES_FIELD = "answer_updates"
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

    # Named by its market and never its address: this escapes to the 500 log, which holds none.
    raise PyMongoError(
        f"Could not store an application for market {app.market_id}: a concurrent write for the "
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

    The name is the one the vendor CHOSE where they gave one; see ``display_name``.

    Lowercased keys, because that is the form every other reader matches on: ``record_attendance``
    normalizes, the importer lowercases on the way in, and a map whose keys did not would miss
    the one vendor whose form capitalized their address.

    A projection, not the whole application: the surfaces that need this - the tables grid, the
    payoff screen - want a name against an address and nothing else, and 232 applications' worth
    of ``form_data`` is not a thing to ship in order to read one key from each.
    """
    # The name they CHOSE, falling back to the one on their identification - stated once, in the
    # module that owns both keys (E19/F02/S01).
    return _names_by_address(market_id, EssentialFields.display_name)


def vendor_full_names_for_market(market_id: str) -> Dict[str, str]:
    """Every applicant's full name, the one on their identification, keyed as
    ``vendor_names_for_market`` is: the download carries it beside the name they chose
    (E35/F03/S02)."""
    return _names_by_address(
        market_id,
        lambda form_data: str(form_data.get(EssentialFields.FULL_NAME_KEY) or "").strip(),
    )


#: The questions whose answers identify a vendor rather than describe them: a business name, a
#: business email, a handle. A choice, a number or a date is shared by many and finds nobody.
SEARCHED_ANSWER_TYPES = ("text", "email")

#: The longest answer that still names someone rather than describes their work. A business name,
#: an address or a handle is short; "what do you sell" is a paragraph, and matching it would find
#: every vendor who mentions a word rather than the one the organizer is looking for.
SEARCHED_ANSWER_LENGTH = 80


def vendor_search_terms_for_market(
    market_id: str, fields: List[FormField], placed: Iterable[str],
) -> Dict[str, List[str]]:
    """What a search on the results finds a vendor by (E35/F02/S01), keyed as
    ``vendor_names_for_market`` is: the name they chose, the one on their identification, then
    their short answers to the form's text and email questions, in the form's order.

    Only the vendors in ``placed`` - the ones at a table - are read, since the search finds tables.
    Blank and long answers are left out, and so is a vendor with nothing to search; the page matches
    the address itself. ``fields`` is the market's own form: which questions are text is its to say.
    """
    asked = [field.key for field in fields if field.type in SEARCHED_ANSWER_TYPES]
    keys = [EssentialFields.PREFERRED_NAME_KEY, EssentialFields.FULL_NAME_KEY, *asked]
    at_a_table = {str(email).strip().lower() for email in placed}
    terms: Dict[str, List[str]] = {}
    for email, answers in _answers_by_address(market_id, keys).items():
        if email not in at_a_table:
            continue
        found = [str(answers[key]).strip() for key in keys if isinstance(answers.get(key), str)]
        found = [term for term in found if term and len(term) <= SEARCHED_ANSWER_LENGTH]
        if found:
            terms[email] = found
    return terms


def vendor_answers_for_market(market_id: str, keys: List[str]) -> Dict[str, Dict[str, Any]]:
    """Every applicant's answers to ``keys``, as the organizer reads them (``effective_answers``),
    keyed as ``vendor_names_for_market`` is: what the price groups read (E43/F01/S02)."""
    return _answers_by_address(market_id, keys)


def _names_by_address(market_id: str, name_of) -> Dict[str, str]:
    """``{lowercased address: name}`` for the applications that stored one, read off a projection
    of the two name keys alone."""
    keys = [EssentialFields.FULL_NAME_KEY, EssentialFields.PREFERRED_NAME_KEY]
    names = {
        email: name_of(answers) for email, answers in _answers_by_address(market_id, keys).items()
    }
    return {email: name for email, name in names.items() if name}


def _answers_by_address(market_id: str, keys: List[str]) -> Dict[str, Dict[str, Any]]:
    """The named answers of every application in a market, keyed by lowercased address: a
    projection of those keys alone, since 232 applications' worth of ``form_data`` is not a thing to
    read in order to show a name."""
    ensure_application_indexes()
    projection = {"_id": 0, APPLICANT_EMAIL_FIELD: 1, **{
        f"{field}.{key}": 1 for key in keys for field in ("form_data", ANSWER_UPDATES_FIELD)}}
    answers: Dict[str, Dict[str, Any]] = {}
    for doc in applications_collection.find(market_filter(market_id), projection):
        email = str(doc.get(APPLICANT_EMAIL_FIELD) or "").strip().lower()
        if email:
            answers[email] = effective_answers(doc)
    return answers


def effective_answers(application: Any) -> Dict[str, Any]:
    """An application's answers as the organizer reads them (E41/F01/S01): what the vendor gave,
    each updated answer read in its place. The one reader of them, for a stored document or an
    ``Application`` alike, so the organizer's views, the search, the export, the Stats tab and the
    automatic rejections read an update by construction, as does any reader added later that calls it.

    ``form_data`` itself is never written over by an update; only the vendor (their own edit) and
    an import write it.
    """
    if isinstance(application, Application):
        answers, updates = application.form_data, application.answer_updates
    else:
        answers = application.get("form_data")
        updates = application.get(ANSWER_UPDATES_FIELD)
    effective = dict(answers or {})
    for key, update in (updates or {}).items():
        effective[key] = update.value if isinstance(update, AnswerUpdate) else update.get("value")
    return effective


def write_answer_updates(
    app_id: str, updates: Dict[str, AnswerUpdate], cleared: Iterable[str],
) -> bool:
    """Store these updates of an application's answers, and take the ``cleared`` ones away, each by
    its own question's path, so two organizers updating different answers at once both land."""
    ensure_application_indexes()
    update: Dict[str, Any] = {}
    if updates:
        update["$set"] = {
            f"{ANSWER_UPDATES_FIELD}.{key}": value.model_dump() for key, value in updates.items()}
    gone = {f"{ANSWER_UPDATES_FIELD}.{key}": "" for key in cleared}
    if gone:
        update["$unset"] = gone
    if not update:
        return True
    return applications_collection.update_one({"id": app_id}, update).matched_count > 0


def find_application_by_id(app_id: str) -> Optional[Dict[str, Any]]:
    """Find one application by its ``id`` field."""
    ensure_application_indexes()
    doc = applications_collection.find_one({"id": app_id})
    if doc:
        doc.pop("_id", None)
    return doc


def main_applications_from(market_id: str, addresses: Iterable[str]) -> List[Dict[str, Any]]:
    """The main applications these addresses hold at this market, whatever their status."""
    wanted = sorted(set(addresses))
    if not wanted:
        return []
    return _newest_first({
        **market_filter(market_id),
        APPLICANT_EMAIL_FIELD: {"$in": wanted},
        APPLICATION_TYPE_FIELD: ApplicationType.MAIN.value,
    })


def find_application_by_email(market_id: str, email: str) -> Optional[Dict[str, Any]]:
    """Find one application by its market + email identity."""
    ensure_application_indexes()
    doc = applications_collection.find_one(
        applicant_filter(market_id, email, ApplicationType.MAIN.value)
    )
    if doc:
        doc.pop("_id", None)
    return doc


#: Statuses nobody has decided yet.
UNDECIDED_STATUSES = (ApplicationStatus.OPEN.value, ApplicationStatus.UNDER_REVIEW.value)
#: The statuses a reviewer gives, each with who gave it: a verdict, or a follow-up (E34).
MARKED_STATUSES = (ApplicationStatus.REVIEWER_APPROVED, ApplicationStatus.REVIEWER_REJECTED,
                   ApplicationStatus.NEEDS_FOLLOW_UP)
#: The verdicts: an application at one is decided, and a reviewer's write over it changes a verdict
#: (E38/F06/S01). A follow-up is marked, not decided: deciding one is giving a verdict.
VERDICT_STATUSES = (ApplicationStatus.REVIEWER_APPROVED.value,
                    ApplicationStatus.REVIEWER_REJECTED.value)


def is_decided(doc: Dict[str, Any]) -> bool:
    """Whether an application, as stored or as a reviewer saw it, carries a verdict."""
    return doc.get("status") in VERDICT_STATUSES


def update_application_status(
    app_id: str, status: ApplicationStatus, by: Optional[VerdictGiver] = None,
    reason: Optional[str] = None, if_unchanged_since: Optional[Dict[str, Any]] = None,
    owner: Optional[MarketPerson] = None, unless_decided: bool = False,
) -> bool:
    """Set a new status on an application. Returns whether it was written.

    A verdict is written with its giver and time in the same update (E34/F01/S01), and a rule's
    with its reason (E33/F03/S02); one without a giver is refused, so no application claims a
    verdict nobody gave. Any other status clears all three, and a person's verdict over a rule's
    leaves no rule's reason behind.

    ``if_unchanged_since`` is the application as the caller read it: the write lands only if its
    status, its verdict's time and its answers' time (``updated_at``) are still those, so neither a
    verdict given in between nor answers changed in between - an applicant's edit, a re-import - is
    written over (E33/F03/S02, E34/F03/S01).

    A follow-up is marked like a verdict, by someone, and has an ``owner``: the marker unless named
    (E34/F01/S02). Any other status clears the owner.

    ``unless_decided`` writes only on an application that carries no verdict, for a reviewer who
    gives verdicts but may not change one (E38/F06/S01): asked in the write itself, so a verdict
    landing between the caller's read and this is never written over.
    """
    if status in MARKED_STATUSES and by is None:
        raise ValueError("A verdict is written with the person or rule that gave it.")
    ensure_application_indexes()
    update: Dict[str, Any] = {"$set": {"status": status.value}}
    if by is None:
        update["$unset"] = {"verdict_by": "", "verdict_at": "", "verdict_reason": ""}
    else:
        update["$set"]["verdict_by"] = by.model_dump()
        update["$set"]["verdict_at"] = datetime.now(timezone.utc).isoformat()
        if reason:
            update["$set"]["verdict_reason"] = reason
        else:
            update["$unset"] = {"verdict_reason": ""}
    if status is ApplicationStatus.NEEDS_FOLLOW_UP:
        named = owner or MarketPerson(user_id=by.user_id, email=by.email or "")  # the marker
        update["$set"]["follow_up_owner"] = named.model_dump()
    else:
        update.setdefault("$unset", {})["follow_up_owner"] = ""
    # A new status releases whoever held it (E34/F03/S02): the card it was open on is done with.
    update.setdefault("$unset", {}).update(_CLAIM_UNSET)
    query: Dict[str, Any] = {"id": app_id}
    if if_unchanged_since is not None:
        query["status"] = if_unchanged_since.get("status")
        # Null or absent alike: an application is stored with ``verdict_at: null`` until a verdict.
        query["verdict_at"] = if_unchanged_since.get("verdict_at") or {"$in": [None]}
        if if_unchanged_since.get("updated_at"):
            query["updated_at"] = if_unchanged_since["updated_at"]
    if unless_decided:
        query["$nor"] = [{"status": {"$in": list(VERDICT_STATUSES)}}]
    result = applications_collection.update_one(query, update)
    return result.matched_count > 0


def reassign_follow_up_owner(app_id: str, owner: MarketPerson) -> bool:
    """Hand a follow-up to someone else (E34/F02/S01). Written only while it still needs one."""
    ensure_application_indexes()
    result = applications_collection.update_one(
        {"id": app_id, "status": ApplicationStatus.NEEDS_FOLLOW_UP.value},
        {"$set": {"follow_up_owner": owner.model_dump()}},
    )
    return result.matched_count > 0


# --- Whose share it is (E38/F07/S02, ADR 0020) -----------------------------------------------------

def undecided_in_arrival_order(
    market_id: str, follow_ups_of: Iterable[str] = (),
) -> List[Dict[str, Any]]:
    """A market's open applications, the ones a deal hands out, earliest arrival first; and with
    them the follow-ups owned by any of the addresses ``follow_ups_of`` (a removed reviewer's)."""
    owners = {str(address).strip().lower() for address in follow_ups_of}

    def dealable(doc: Dict[str, Any]) -> bool:
        if doc.get(STATUS_FIELD) in UNDECIDED_STATUSES:
            return True
        owner = str((doc.get("follow_up_owner") or {}).get("email") or "").strip().lower()
        return doc.get(STATUS_FIELD) == ApplicationStatus.NEEDS_FOLLOW_UP.value and owner in owners

    return _in_arrival_order([doc for doc in list_applications_for_market(market_id)
                              if dealable(doc)])


def deal(app_id: str, reviewer: Optional[MarketPerson], was: Optional[Dict[str, Any]]) -> bool:
    """Deal an application to ``reviewer``, or back to first come, first served with None.

    Written only while it is still open and still dealt to whom the caller read (``was``), so a
    verdict landing mid-deal is never touched and no other deal is written over. Only
    ``review_team.py`` calls it.
    """
    ensure_application_indexes()
    # Dealt, it is no longer an arrival waiting for a deal (``mark_arriving``).
    update: Dict[str, Any] = (
        {"$set": {"reviewer": reviewer.model_dump()}, "$unset": {ARRIVING_FIELD: ""}} if reviewer
        else {"$unset": {"reviewer": ""}}
    )
    result = applications_collection.update_one(
        {"id": app_id, STATUS_FIELD: {"$in": list(UNDECIDED_STATUSES)},
         # Null or absent alike, as a verdict's condition reads them.
         "reviewer": was if was else {"$in": [None]}},
        update,
    )
    return result.matched_count > 0


#: An application waiting to be dealt as it arrived (E38/F07/S03): ``{actor, action}``, the write it
#: arrived by, for the deal's history entry. Set by ``mark_arriving``, cleared as it is dealt.
ARRIVING_FIELD = "arriving"


def mark_arriving(app_id: str, actor: Optional[str], action: str) -> bool:
    """Mark an open, undealt application as waiting to be dealt as it arrived, by ``action`` of
    ``actor``; one already waiting keeps the write it first arrived by. Only ``review_team.py``
    calls it, and whichever deal next holds the market deals it."""
    ensure_application_indexes()
    result = applications_collection.update_one(
        {"id": app_id, STATUS_FIELD: {"$in": list(UNDECIDED_STATUSES)},
         "reviewer": {"$in": [None]}, ARRIVING_FIELD: {"$exists": False}},
        {"$set": {ARRIVING_FIELD: {"actor": actor, "action": action}}},
    )
    return result.matched_count > 0


def arriving_in_arrival_order(market_id: str) -> List[Dict[str, Any]]:
    """The market's applications waiting to be dealt as they arrived, earliest arrival first."""
    return _in_arrival_order([doc for doc in list_applications_for_market(market_id)
                              if doc.get(ARRIVING_FIELD)])


def deal_arrival(app_id: str, reviewer: Optional[MarketPerson]) -> bool:
    """Deal an application waiting as it arrived to ``reviewer``, or with None let it go undealt:
    either way it waits no longer. The reviewer is written only while it is still open and undealt,
    so one decided meanwhile is let go with its verdict alone."""
    ensure_application_indexes()
    if reviewer is not None:
        result = applications_collection.update_one(
            {"id": app_id, STATUS_FIELD: {"$in": list(UNDECIDED_STATUSES)},
             "reviewer": {"$in": [None]}, ARRIVING_FIELD: {"$exists": True}},
            {"$set": {"reviewer": reviewer.model_dump()}, "$unset": {ARRIVING_FIELD: ""}},
        )
        if result.matched_count > 0:
            return True
    applications_collection.update_one({"id": app_id}, {"$unset": {ARRIVING_FIELD: ""}})
    return False


def deal_follow_up(app_id: str, reviewer: MarketPerson, owner_was: Dict[str, Any]) -> bool:
    """Hand a removed reviewer's follow-up to the reviewer it is dealt to: its owner and its
    reviewer both become them, and it keeps its status. Written only while it still needs a
    follow-up from ``owner_was``, so one taken on or decided meanwhile is left as it is. Only
    ``review_team.py`` calls it."""
    ensure_application_indexes()
    result = applications_collection.update_one(
        {"id": app_id, STATUS_FIELD: ApplicationStatus.NEEDS_FOLLOW_UP.value,
         "follow_up_owner": owner_was},
        {"$set": {"follow_up_owner": reviewer.model_dump(), "reviewer": reviewer.model_dump()}},
    )
    return result.matched_count > 0


# --- Who is looking at it (E34/F03/S02) ------------------------------------------------------------

#: How long a claim holds without being renewed.
CLAIM_LEASE = timedelta(minutes=5)
_CLAIM_UNSET = {"held_by": "", "held_until": ""}


def _now(now: Optional[datetime]) -> datetime:
    return now or datetime.now(timezone.utc)


def _submitted(doc: Dict[str, Any]) -> Optional[datetime]:
    raw = doc.get("submitted_at")
    if not raw:
        return None
    try:
        at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def _in_arrival_order(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Earliest submission first, those with none last, as the review shows them (``inArrivalOrder``
    in ``front-end/src/utils/reviewQueue.ts``)."""
    keyed = [(_submitted(doc), index, doc) for index, doc in enumerate(docs)]
    keyed.sort(key=lambda k: (k[0] is None, k[0] or datetime.min.replace(tzinfo=timezone.utc), k[1]))
    return [doc for _, _, doc in keyed]


def holds(
    held_by: Optional[Dict[str, Any]], held_until: Optional[str], now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """Who holds an application right now, or None once the claim has lapsed."""
    if not held_by or not held_until:
        return None
    try:
        until = datetime.fromisoformat(held_until)
    except ValueError:
        return None
    return held_by if until > _now(now) else None


def holder_of(doc: Dict[str, Any], now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """``holds`` for a stored application."""
    return holds(doc.get("held_by"), doc.get("held_until"), now)


def claim_next_for_review(
    market_id: str, person: MarketPerson, after: Optional[str], include_follow_ups: bool,
    now: Optional[datetime] = None, want: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Hand ``person`` the next card to review, claimed for them, or None when every one left is
    held by someone else (E34/F03/S02).

    The next undecided application in arrival order after ``after`` - the one they move on from,
    which comes round last - that nobody else holds. ``want`` is one they asked for by name (a link
    to it), tried first. Taking it is conditioned on the claim it read, so two reviewers asking at
    once are handed different cards. Their other claims are let go.
    """
    now = _now(now)
    statuses = UNDECIDED_STATUSES + (
        (ApplicationStatus.NEEDS_FOLLOW_UP.value,) if include_follow_ups else ())
    docs = list_applications_for_market(market_id)
    queue = _in_arrival_order([doc for doc in docs if doc.get("status") in statuses])
    ids = [doc["id"] for doc in queue]
    start = ids.index(after) + 1 if after in ids else 0
    order = queue[start:] + queue[:start]
    if want in ids:
        order = [queue[ids.index(want)]] + [doc for doc in order if doc["id"] != want]
    mine = person.model_dump()
    for doc in order:
        holder = holder_of(doc, now)
        if holder is not None and holder != mine:
            continue
        taken = applications_collection.update_one(
            {"id": doc["id"], "held_until": {"$in": [doc.get("held_until")]}},
            {"$set": {"held_by": mine,
                      "held_until": (now + CLAIM_LEASE).isoformat()}},
        )
        if taken.matched_count == 0:
            continue
        for other in docs:
            if other["id"] != doc["id"] and other.get("held_by") == mine:
                release_claim(other["id"], person)
        return find_application_by_id(doc["id"])
    return None


def renew_claim(app_id: str, person: MarketPerson, now: Optional[datetime] = None) -> bool:
    """Keep holding the open card for another lease. False once someone else has taken it."""
    result = applications_collection.update_one(
        {"id": app_id, "held_by": person.model_dump()},
        {"$set": {"held_until": (_now(now) + CLAIM_LEASE).isoformat()}},
    )
    return result.matched_count > 0


def release_claim(app_id: str, person: MarketPerson) -> bool:
    """Let go of a card on moving on or leaving. Only one's own claim is released."""
    result = applications_collection.update_one(
        {"id": app_id, "held_by": person.model_dump()}, {"$unset": dict(_CLAIM_UNSET)},
    )
    return result.matched_count > 0


def judgeable_applications(
    market_id: str, application_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """The applications a market's automatic rejections may judge (E33/F03/S02): the undecided,
    and those a rule rejected. Never one a person decided. ``application_id`` narrows it to one."""
    if application_id is not None:
        doc = find_application_by_id(application_id)
        docs = [doc] if doc and doc.get("market_id") == market_id else []
    else:
        docs = list_applications_for_market(market_id)
    return [doc for doc in docs if is_judgeable(doc)]


def is_judgeable(application: Dict[str, Any]) -> bool:
    """Whether a market's automatic rejections may judge this stored application: an undecided
    one, or one a rule rejected; never one a person decided. The import's preview asks it of an
    application as the import would leave it (E38/F03/S02)."""
    status = application.get("status")
    return status in UNDECIDED_STATUSES or (
        status == ApplicationStatus.REVIEWER_REJECTED.value
        and (application.get("verdict_by") or {}).get("kind") == "rule")


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


def delete_applications_for_market(market_id: str) -> int:
    """Take a market's applications with the market (``market_deletion``). Returns how many went."""
    return applications_collection.delete_many(market_filter(market_id)).deleted_count


def delete_application(app_id: str) -> bool:
    """Remove one application. Only for undoing a create whose answers were then refused, so a
    write that failed leaves nothing behind: nothing an applicant or organizer did is ever deleted
    through here."""
    ensure_application_indexes()
    return applications_collection.delete_one({"id": app_id}).deleted_count > 0


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
