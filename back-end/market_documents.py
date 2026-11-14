"""The canonical form a raw market document is stored in, and the reads that name it.

Two things make a stored market document canonical, and one migration establishes both.

**The key convention.** Every market write camel-cases the whole document
(``convert_keys_to_camel_case`` in ``create_market`` and every named write), so
``organization_id`` is persisted as ``organizationId``. camelCase is the one canonical spelling:
documents written before that convention used snake_case, and ``migrations/migrate_market_keys.py``
rewrites them, so no stored document carries both spellings and no read has to guess.

**The stored slug.** A market's public URL names it by the slug of its name, and the public
lookup behind that URL is unauthenticated. Deriving the slug per document at read time makes that
lookup a decode of every published market in the database, driven by anyone who can type a URL, so
the slug is persisted (``Market.slug``, a computed field, so no write can leave it disagreeing
with the name) and indexed, and ``market_by_slug`` is one indexed query. The same
migration backfills it onto documents written before the field existed - which is why it is part
of what ``normalize_market_document`` means by canonical, and why the boot check below waits on it
too: a market with no stored slug is a market whose public URL 404s.

Tolerating both spellings at read time does not converge - a write only ever refreshes the
camelCase key, so a legacy snake_case key keeps its value forever and any filter that still
matches the legacy spelling acts on data no write has refreshed since. Every raw Mongo filter and
every raw key handed to ``$set`` must therefore name the canonical key, and anyone writing one
should not have to think about which spelling that is. The helpers below are the only thing that
think about this. Code that touches a raw document or writes a Mongo filter does so through
these helpers rather than a string literal, so the spelling is decided in exactly one place.

Reading one key only means the data has to be normalized first, and nothing auto-runs the
migration: rewriting stored documents is a deliberate operator action. The migration records its
marker documents in ``schema_migrations`` when it completes, and the app refuses to boot unless
they are there (``assert_market_key_migration_recorded``, called from ``app.py``).
Serving unmigrated data would hide markets from the vendor page, from the applicant's public
URL, and from org-scoped lists with no error anywhere; a loud refusal at startup is the only
failure mode that cannot be deployed by accident. Each marker is a single document read by
``_id``, so the check is a couple of indexed lookups rather than a scan over every market - cheap
enough to fail closed on, which is what it does: an unknown migration state is not a migrated one.

There are several markers rather than one because the canonical form grew: the first says the keys
were rewritten, the second that the slugs were backfilled, the third that the slug index is unique
and no two markets share a public address. One run of the one migration records them all, so the
operator still has one command to paste - but a database migrated by an older build carries only
the earlier ones, which is precisely the state that has to be caught, and a build rolled *back*
still finds the markers it knows.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from assignment.utils import (
    convert_keys_to_camel_case,
    convert_keys_to_snake_case,
    snake_to_camel,
)
from datatypes import (
    IntakeMode,
    Market,
    MarketPhase,
    applications_stopped_from_market_document,
    intake_mode_from_market_document,
    market_name_slug,
    phase_from_market_document,
)
from tombstone import live

MONGO_ID_KEY = "_id"

MARKETS_COLLECTION = "markets"
SCHEMA_COLLECTION = "schema_migrations"
MARKET_KEY_MIGRATION_ID = "market_document_keys"
MARKET_SLUG_MIGRATION_ID = "market_slugs"
# The slug index is UNIQUE (E21/F03/S03). A database migrated before that carries the two markers
# above over a non-unique index, and possibly over two markets sharing one public address - so it
# needs its own marker, or an older database would boot without ever being checked for a clash.
MARKET_SLUG_UNIQUE_MIGRATION_ID = "market_slugs_unique"

# Every marker the current canonical form rests on. A database is migrated when it carries all of
# them, and the one migration below records all of them.
MARKET_MIGRATION_IDS = (
    MARKET_KEY_MIGRATION_ID,
    MARKET_SLUG_MIGRATION_ID,
    MARKET_SLUG_UNIQUE_MIGRATION_ID,
)

MARKET_SLUG_INDEX = "market_slug"

MARKET_KEY_MIGRATION = "migrations/migrate_market_keys.py"

MARKET_KEY_MIGRATION_RECOVERY = (
    f"Run: docker compose run --rm backend python {MARKET_KEY_MIGRATION}"
)


class MarketKeyMigrationError(RuntimeError):
    """The market-document migration could not be confirmed as applied to this database."""


class MarketKeyMigrationMissingError(MarketKeyMigrationError):
    """The migration has demonstrably not run: one of its markers is absent."""

    def __init__(self, missing: Sequence[str]) -> None:
        super().__init__(
            f"The market-document migration has not been applied to this database: no "
            f"{', '.join(repr(marker) for marker in missing)} marker in the "
            f"'{SCHEMA_COLLECTION}' collection. Readers name the canonical camelCase key only, so "
            f"any market still stored under legacy snake_case keys is invisible to the public "
            f"vendor page and to organization-scoped market lists; the public slug lookup "
            f"names the stored slug, so any market that has not been given one is invisible to "
            f"every public URL it appears on.\n{MARKET_KEY_MIGRATION_RECOVERY}"
        )
        self.missing = tuple(missing)


class MarketKeyMigrationUnverifiableError(MarketKeyMigrationError):
    """A marker could not be read at all, so the migration state is unknown."""

    def __init__(self, cause: BaseException) -> None:
        super().__init__(
            f"Could not read the market-document migration markers "
            f"({', '.join(repr(marker) for marker in MARKET_MIGRATION_IDS)}) from the "
            f"'{SCHEMA_COLLECTION}' collection: {cause!r}. An unknown migration state is not a "
            f"migrated one, so this refuses to serve rather than risk hiding every market "
            f"stored under legacy keys. Make the database reachable, then confirm the "
            f"migration manually:\n{MARKET_KEY_MIGRATION_RECOVERY}"
        )
        self.cause = cause


def read_market_key_migration_marker(
    db: Any, migration_id: str = MARKET_KEY_MIGRATION_ID,
) -> Optional[Dict[str, Any]]:
    """One of the migration's marker documents, or None if that part has not run."""
    return db[SCHEMA_COLLECTION].find_one({MONGO_ID_KEY: migration_id})


def assert_market_key_migration_recorded(db: Any) -> None:
    """Refuse to serve a database whose market documents may not be in canonical form.

    Any failure to read a marker is a failure to confirm the migration, and is fatal for the
    same reason a missing marker is: the alternative is serving markets nobody can see. A
    database that cannot answer a single ``_id`` lookup cannot serve a request either, so
    nothing is lost by refusing.

    Every marker is checked and the refusal names all the missing ones at once, for the same
    reason the boot-time defense check names every unset variable: one run of one migration
    records them all, so an operator should never have to discover them one restart at a time.
    """
    missing = []
    for migration_id in MARKET_MIGRATION_IDS:
        try:
            marker = read_market_key_migration_marker(db, migration_id)
        except Exception as e:
            raise MarketKeyMigrationUnverifiableError(e) from e
        if marker is None:
            missing.append(migration_id)
    if missing:
        raise MarketKeyMigrationMissingError(missing)


def record_market_key_migration(db: Any) -> None:
    """Record that every market document is in canonical form."""
    applied_at = datetime.now(timezone.utc).isoformat()
    for migration_id in MARKET_MIGRATION_IDS:
        db[SCHEMA_COLLECTION].update_one(
            {MONGO_ID_KEY: migration_id},
            {"$set": {"appliedAt": applied_at}},
            upsert=True,
        )


class MarketSlugCollisionError(MarketKeyMigrationError):
    """Two or more stored markets answer one public address, so the unique index cannot be built.

    Which of them keeps the address is an organizer's decision, not a migration's, so this names
    every clash and stops. Renaming all but one of each group and running the migration again is
    the whole remedy.
    """

    def __init__(self, clashes: Dict[str, List[Dict[str, Any]]]) -> None:
        lines = [
            f"  /{slug}: "
            + ", ".join(f"{doc.get('name')!r} (id {doc.get('id')})" for doc in docs)
            for slug, docs in sorted(clashes.items())
        ]
        super().__init__(
            "These markets share a public address, and a public address must belong to one "
            "market. Rename all but one market in each group, then run the migration again:\n"
            + "\n".join(lines)
        )
        self.clashes = clashes


# A name with nothing sluggable in it has no public address at all, and any number of markets may
# share that absence. The index covers real addresses only, so the empty slug is not one address
# they all collide on.
MARKET_SLUG_INDEX_FILTER = {"slug": {"$gt": ""}}


def market_slug_collisions(docs: Sequence[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Every public address two or more of these market documents answer, with the markets."""
    by_slug: Dict[str, List[Dict[str, Any]]] = {}
    for doc in docs:
        slug = market_name_slug(doc.get("name") or "")
        if slug:
            by_slug.setdefault(slug, []).append(doc)
    return {slug: group for slug, group in by_slug.items() if len(group) > 1}


def ensure_market_slug_index(db: Any) -> None:
    """Index the stored slug uniquely: one public address, one market (E21/F03/S03).

    It keeps the unauthenticated lookup off a collection scan, and it is the database's refusal of
    what ``public_address_refusal`` checks first - two markets answering one public URL, so a
    stranger following a link can land on the wrong one. It used to be non-unique, on the grounds
    that refusing a creation over a URL clash was not the index's call; but a clash is exactly what
    the public URL cannot survive, and creation already refused a duplicate name.

    Stored markets that already clash are named and the index is not built: which of them keeps
    the address is the operator's call. An older non-unique index of the same name is replaced,
    because Mongo will not change an index's options in place.
    """
    markets = db[MARKETS_COLLECTION]
    clashes = market_slug_collisions(list(markets.find({})))
    if clashes:
        raise MarketSlugCollisionError(clashes)
    existing = markets.index_information().get(MARKET_SLUG_INDEX)
    if existing is not None and not existing.get("unique"):
        markets.drop_index(MARKET_SLUG_INDEX)
    markets.create_index(
        market_doc_key("slug"),
        name=MARKET_SLUG_INDEX,
        unique=True,
        partialFilterExpression=MARKET_SLUG_INDEX_FILTER,
    )


def pending_market_key_rewrites(db: Any) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """Every stored market that is not already in canonical form, with its rewrite."""
    rewrites = (
        (doc, normalize_market_document(doc)) for doc in db[MARKETS_COLLECTION].find({})
    )
    return [(doc, normalized) for doc, normalized in rewrites if doc != normalized]


def apply_market_key_migration(db: Any) -> int:
    """Rewrite every market into canonical form, index the slug, and record that it happened.

    Idempotent: a database that is already canonical has nothing to rewrite, the index build is a
    no-op when the index is there, and the markers are upserted either way.
    """
    rewritten = 0
    for doc, normalized in pending_market_key_rewrites(db):
        result = db[MARKETS_COLLECTION].replace_one(
            {MONGO_ID_KEY: doc[MONGO_ID_KEY]}, normalized
        )
        rewritten += result.modified_count
    ensure_market_slug_index(db)
    record_market_key_migration(db)
    return rewritten


def market_doc_key(field: str) -> str:
    """The persisted spelling of a market model field.

    Every reader and writer of a raw document must name the canonical key, and the caller should
    not have to remember which spelling that is. They don't: they name the model field, and this
    returns the persisted spelling. ``MONGO_ID_KEY`` is the one key it is not valid to hand here.
    """
    return snake_to_camel(field)


def market_doc_filter(field: str, value: Any) -> Dict[str, Any]:
    """Mongo filter over the persisted spelling of the named model field."""
    return {market_doc_key(field): value}


def market_doc_field(document: Dict[str, Any], field: str, default: Any = None) -> Any:
    """Read a model field off a raw stored market document."""
    return document.get(market_doc_key(field), default)


def market_doc_projection(fields: Sequence[str]) -> Dict[str, Any]:
    """Mongo projection over the persisted spellings of the named model fields."""
    return {market_doc_key(field): 1 for field in fields}


#: What a market document holds that no market read serves, to any role: the door code is served
#: only by its own endpoints, to whoever may check vendors in (``api/door.py``, ADR 0022).
NEVER_SERVED_FIELDS: Tuple[str, ...] = ("door_code",)


def leave_out_what_no_read_serves(document: Dict[str, Any]) -> None:
    """Take ``NEVER_SERVED_FIELDS`` off a raw market document about to be served."""
    for field in NEVER_SERVED_FIELDS:
        document.pop(market_doc_key(field), None)


# What ``market_by_slug`` reads of a candidate itself: the name it re-checks the slug
# against, and the two fields the draft test is decided from. A caller's projection is unioned with
# these rather than trusted to contain them, because a projection that dropped one would not make
# the lookup cheaper - it would make it answer a different question, and answer it wrongly (a market
# with no ``phase`` in hand is a market that reads as a draft).
_SLUG_LOOKUP_FIELDS: Tuple[str, ...] = ("name", "phase", "is_draft")


# Where a form market's applicant surface answers: every phase but draft (E26/F07/S02). An applicant
# may sign in during any phase and always see their own application (the ruling recorded in
# `api/applicants.py`); a draft is not published, so it answers as a market that does not exist.
#
# This was the open phase alone, which closed the whole surface the moment applications closed -
# before most organizers publish a verdict, so a vendor could never read theirs (bug 20). APPLYING
# is still the stage's alone, while the organizer takes applications, and the save says so itself
# (`takes_applications` in `api/applicants.py`): a stranger applying to a closed market was the old
# behaviour, and it stays wrong.
APPLICANT_SURFACE_PHASES = tuple(phase for phase in MarketPhase if phase is not MarketPhase.DRAFT)


def non_draft_market_prefilter() -> Dict[str, Any]:
    """Mongo filter over every market that could possibly be non-draft.

    This is a *prune*, not a judgement. A Mongo filter cannot decide whether a document is a
    draft, because ``{"phase": {"$ne": "draft"}}`` also matches a document that carries no
    ``phase`` at all -- which is the legacy encoding of a draft -- and ``phase == 'applications'``
    does not exclude a draft written before the ``isDraft`` convention. The only place to trust a
    draft decision is ``phase_from_market_document``, which knows both conventions. This filter
    only removes the documents for which every possible encoding says "draft": the ones that
    explicitly carry ``phase: draft`` and ``isDraft: true``.
    """
    return {
        "$nor": [
            {"isDraft": True, "phase": "draft"},
        ]
    }


def market_by_slug(
    collection: Any,
    market_slug: str,
    serving_phases: Sequence[MarketPhase],
    fields: Optional[Sequence[str]] = None,
) -> Optional[Dict[str, Any]]:
    """The market a public URL names, if it is in a phase that surface serves.

    One lookup, parameterised by the phases, because each public surface names its own (E03/F03):
    applying and the vendor page (``applicant_intake_market_by_slug``,
    ``vendor_page_market_by_slug``) both start from it.

    The candidates come from the stored slug, which is indexed (``ensure_market_slug_index``), so
    this is one indexed query rather than a pass over every published market. That matters because
    every public lookup is unauthenticated, and a lookup that decoded the collection per call would
    be an O(markets) scan any stranger could drive at will, with a slug that matches nothing costing
    exactly as much as one that does.

    The stored slug narrows; it does not decide. The name is what the rule is defined over
    (``market_name_slug``, the same rule the front end builds its links from), so the name of each
    candidate is re-checked against it here. A stored slug is a derivation of the name that a
    computed field keeps in step with it, and this is what makes that a performance detail rather
    than a second source of truth: a document the migration has not reached is unreachable, which
    the boot check refuses to serve on, but it can never be reachable under the *wrong* slug.

    Nor can a Mongo condition decide a phase: ``{"phase": {"$ne": "draft"}}`` also matches a
    document that carries no ``phase`` at all, which is exactly what a draft written before the
    field existed looks like - it would put an unpublished market on a public URL.
    ``phase_from_market_document`` is the one authority on a document's effective phase, so that
    test goes through it in Python. ``non_draft_market_prefilter`` only prunes the documents that
    are unambiguously drafts; it prunes, it does not judge.

    ``fields`` are the market fields the caller will actually read, and naming them is what keeps
    the *document* bounded now that the query is. A market document carries its ``setupObject``, its
    ``assignmentObject`` and its ``modificationList``, which for a market with a full assignment is
    megabytes, and decoding the rest is work an attacker gets for free at a public surface. A caller
    that genuinely needs the whole document names no fields and is served it.
    """
    if not market_slug:
        return None
    target = market_slug.strip().lower()
    query = live({**non_draft_market_prefilter(), **market_doc_filter("slug", target)})
    projection = (
        None if fields is None else market_doc_projection((*_SLUG_LOOKUP_FIELDS, *fields))
    )
    for candidate in collection.find(query, projection):
        if market_name_slug(candidate.get("name", "")) != target:
            continue
        if phase_from_market_document(candidate) not in serving_phases:
            continue
        return candidate
    return None


# Fields whose stored value is decided by a document reader rather than by Pydantic, because a
# value this build does not recognize has to degrade instead of raising. See the docstring below.
_DOCUMENT_READ_FIELDS = ("phase", "intake_mode")


def market_serves_applicants(market_doc: Dict[str, Any]) -> bool:
    """Does this market have an applicant-facing surface at all?

    Its intake mode is ``form``. A CSV market's vendors never apply in this product: they are
    imported from a file the organizer already collected, so its application form answers for it
    exactly as for a market that does not exist. Its vendors still get a vendor page, without an
    application, once its results are published (``vendor_page_market_by_slug``).

    The question is stated once here, which is the same reason ``applicant_intake_market_by_slug``
    below is one lookup rather than a check in each endpoint: both gates ask it, and the vendor's
    own read asks it to leave out a Google Form market's answers.
    """
    return intake_mode_from_market_document(market_doc) is IntakeMode.FORM


def applicant_intake_market_by_slug(
    collection: Any, market_slug: str, fields: Optional[Sequence[str]] = None,
) -> Optional[Dict[str, Any]]:
    """The published market at this slug whose vendors apply online, or ``None``.

    The applicant surface: sign-in, the public form, and a vendor's own application, in every phase
    but draft (``APPLICANT_SURFACE_PHASES``) - an applicant may always read their own application.
    Applying itself is gated to the stage by the save (``takes_applications``), which says so in
    words.

    Its one requirement beyond publication is that the market's intake mode is ``form``, which the
    phase cannot express: a CSV market is in ``applications`` too - that is where its imported
    responses are reviewed - so its public application form would be live and accepting strangers
    the organizer has no way to answer.

    It is a function of its own rather than a flag on the vendor page gate because the page is
    every vendor's, however they entered the market: an imported vendor reads their table and
    checks in there too (``vendor_page_market_by_slug``). And it is one function rather than a check inside each of the
    five applicant endpoints, because five checks are five chances to forget the sixth.

    ``None`` is the same answer this returns for a slug that belongs to no market at all, and
    every caller's existing not-found branch is what serves it. That is deliberate: a stranger who
    guesses the slug of a CSV market learns nothing, where a "not accepting applications online"
    message would confirm that the market exists.

    ``intake_mode`` is added to the caller's projection rather than expected in it, for the same
    reason ``_SLUG_LOOKUP_FIELDS`` is: a projection missing it would not make the lookup cheaper,
    it would make it answer a different question -- a market with no intake mode in hand reads as
    CSV, so every form market would look gated.
    """
    projected = None if fields is None else (*fields, "intake_mode")
    market_doc = market_by_slug(
        collection, market_slug, APPLICANT_SURFACE_PHASES, fields=projected,
    )
    if market_doc is None:
        return None
    if not market_serves_applicants(market_doc):
        return None
    return market_doc


def vendor_page_market_by_slug(
    collection: Any, market_slug: str, fields: Optional[Sequence[str]] = None,
) -> Optional[Dict[str, Any]]:
    """The market whose vendor page is at this slug, or ``None`` (ADR 0022).

    The vendor page, ``/<slug>``, is where a vendor signs in and reads their own application, their
    result and their seats. This decides whether a market has one: every vendor read and the
    sign-in go through it, while applying itself stays behind ``applicant_intake_market_by_slug``.

    A market whose vendors apply on its page has one in every phase but draft. A market that imports
    its vendors from the organizer's Google Form has one once its results are published, when its
    vendors have something to read there, or once it has reached its market days, which covers one
    that went live before it could publish results (an archived one that did counts). ``None`` is
    the answer for everything else, the same answer a slug that names nothing gets, so a stranger
    who guesses the slug of a draft, or of a Google Form market before its results, learns nothing.

    What the gate reads is added to the caller's projection for the reason
    ``applicant_intake_market_by_slug`` adds ``intake_mode``: the intake mode, the results flag, and
    the id and phase record that say whether the market ran.
    """
    projected = None if fields is None else (*fields, *_VENDOR_PAGE_GATE_FIELDS)
    market_doc = market_by_slug(
        collection, market_slug, APPLICANT_SURFACE_PHASES, fields=projected,
    )
    if market_doc is None:
        return None
    if market_serves_applicants(market_doc) or market_doc_field(market_doc, "results_published"):
        return market_doc
    if _reached_market_days(market_doc):
        return market_doc
    return None


def results_are_out(market_doc: Dict[str, Any]) -> bool:
    """May this market's vendors read their results: published, or it reached its market days?

    A Google Form market that went live before it could publish results never set the flag, yet
    its vendors are seated and at the door (ADR 0022), so reaching the market days counts too. A
    form market cannot reach them unpublished. Reads what ``vendor_page_market_by_slug`` adds to
    its caller's projection, so a document it served answers this.

    It asks whether applicants were told, which is the flag. Where the assignment itself stands,
    published or changed since, is the lifecycle owner's (``assignment.lifecycle.allocation``).
    """
    return bool(market_doc_field(market_doc, "results_published")) or _reached_market_days(market_doc)


# What ``vendor_page_market_by_slug`` reads of a market to decide whether it has a page.
_VENDOR_PAGE_GATE_FIELDS: Tuple[str, ...] = ("intake_mode", "results_published", "id", "phase_history")


def _reached_market_days(market_doc: Dict[str, Any]) -> bool:
    """Has this market reached its market days, by its phase record and, where that is partial, by
    whether anyone checked in (``attendance.market_ran``)?

    Imported here rather than at the top: ``phase_record`` and the attendance module both import
    this one.
    """
    if phase_from_market_document(market_doc) is MarketPhase.MARKET_DAYS:
        return True
    import api.attendance as AttendanceApi
    return AttendanceApi.market_ran(market_doc)


def market_id_at_slug(collection: Any, market_slug: str) -> Optional[str]:
    """The id of the market stored at this slug, in any phase, draft included; ``None`` for none.

    Never a public answer: a stranger must learn nothing of a draft or a gated market. Only for
    naming a cookie the browser already holds for it, so that a remembered sign-in on a vendor page
    the gate no longer serves can still be cleared and signed out (``remembered_sign_ins``).
    """
    if not market_slug:
        return None
    found = collection.find_one(
        market_doc_filter("slug", market_slug.strip().lower()), market_doc_projection(("id",)),
    )
    return (found or {}).get("id") or None


def market_dates_of(market_doc: Dict[str, Any]) -> List[str]:
    """The market's dates as its plan holds them, ``YYYY-MM-DD``, in order."""
    setup = market_doc_field(market_doc, "setup_object") or {}
    return sorted(
        str(entry.get("date"))
        for entry in (setup.get("marketDates") or [])
        if isinstance(entry, dict) and entry.get("date")
    )


def market_from_document(
    document: Dict[str, Any], market_snake: Optional[Dict[str, Any]] = None
) -> Market:
    """Parse a stored market document into a Market model.

    The stored phase is the single source of truth: it overwrites whatever the parsed model's
    default would be, which is ``draft``. A document without a phase (legacy) goes through
    ``phase_from_market_document``, and so does a document with an unrecognized phase value. The
    result is assigned to ``phase`` on the Pydantic model, so it overrides the default both ways.
    See ``Market.phase``.

    Both of those fields are *withheld* from the parse rather than corrected after it. Pydantic
    validates an enum field before any later assignment can degrade it, so a document carrying a
    value this build does not recognize used to raise here -- which is exactly what the two
    document readers exist to prevent, and the failure would have landed on whatever list
    happened to include that one market. The reader decides; the parse never sees the raw value.
    """
    if market_snake is not None:
        doc = convert_keys_to_snake_case(document)
        doc.update(market_snake)
    else:
        doc = convert_keys_to_snake_case(document)
    model_data = {
        k: v for k, v in doc.items()
        if k in Market.model_fields and k not in _DOCUMENT_READ_FIELDS
    }
    market = Market(**model_data)
    object.__setattr__(market, "phase", phase_from_market_document(document))
    object.__setattr__(market, "intake_mode", intake_mode_from_market_document(document))
    # Read like the phase, so a market still stored in an old closed phase reads as stopped.
    object.__setattr__(
        market, "applications_stopped", applications_stopped_from_market_document(document),
    )
    # The document as read, which a write judged on this market holds (``market_write``). Kept, not
    # copied, so a caller never changes the document a loader handed it.
    market._stored_document = document
    return market


def normalize_market_document(document: Dict[str, Any]) -> Dict[str, Any]:
    """Rewrite a stored market document into canonical form.

    Where a document carries both spellings of a field, the canonical one wins: it is the
    only one any write path has refreshed, so the snake_case value is stale by definition.
    ``_id`` is Mongo's own key and is left exactly as it is.

    The slug is *derived*, not carried over: it is a computed field on the model
    (``Market.slug``), so every write since it existed has stamped it from the name, and a stored
    one that disagreed with the name could only have come from an edit nothing in this codebase
    makes. Recomputing it here is what backfills the documents written before the field existed -
    and, in the same pass, repairs any that were hand-edited out of step. A market with no name
    slugs to the empty string, which no lookup can ask for.
    """
    normalized: Dict[str, Any] = {}
    for key, value in document.items():
        if key == MONGO_ID_KEY:
            normalized[key] = value
            continue
        canonical_key = market_doc_key(convert_keys_to_snake_case({key: value}).popitem()[0])
        if canonical_key != key and canonical_key in document:
            continue
        normalized[canonical_key] = convert_keys_to_camel_case(value)

    normalized[market_doc_key("slug")] = market_name_slug(normalized.get("name") or "")
    return normalized
