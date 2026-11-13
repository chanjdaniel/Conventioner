"""Deleting a market, and everything kept with it (bug 47).

A market keeps records beside itself, keyed by its id: its applications (each vendor's name, email
and answers), its check-ins, its applicant sign-in codes and remembered sign-ins, its history, the
organizer's notes on its vendors, its vendors' payments and amounts owed, and its floorplan images.
Deleting the market document alone left all of them behind for ever, describing a market nobody
could reach any more.
Both doors that delete a market - its own Delete, and its organization's - come through here, so a
record kind added later is one line in one place rather than a third door that forgets it.

A deletion first sets the market's tombstone (``tombstone``), so from then on it reads as absent
and takes no write; then its records go, and the market document last: if anything fails, the
tombstone is still there for a retry to resume from, rather than records that nothing reaches.
"""
from typing import Any, Dict, Mapping, Optional

import api.applicant_auth as ApplicantAuth
import api.applications as ApplicationsApi
import api.attendance as AttendanceApi
import deletion_trail as DeletionTrail
import history as History
import payments as Payments
import remembered_sign_ins as RememberedSignIns
import services.gridfs_service as GridfsService
import vendor_notes as VendorNotes
from client_errors import NotFoundError
from market_documents import market_doc_field, market_doc_key
from tombstone import DELETING, live, tombstone_of


def mark_deleting(
    markets_collection: Any, document: Mapping[str, Any], tombstone: Dict[str, Any], *,
    holding_phase: bool = False,
) -> Optional[Dict[str, Any]]:
    """Set ``tombstone`` on the market ``document`` was read from, by one conditional write held on
    its being live, and on its stored phase as read when ``holding_phase``.

    Answers the tombstone the market carries now: ``tombstone``, or the one another deletion set
    first. None when the market is gone, or, holding its phase, live in a phase moved since.
    """
    condition: Dict[str, Any] = live({"id": document["id"]})
    if holding_phase:
        phase_key = market_doc_key("phase")
        condition[phase_key] = (
            document[phase_key] if phase_key in document else {"$exists": False})
    if markets_collection.update_one(condition, {"$set": {DELETING: tombstone}}).matched_count:
        return tombstone
    return tombstone_of(markets_collection.find_one({"id": document["id"]}))


def delete_records(market_id: str) -> None:
    """Delete every record kept beside a market, not the market itself. Each step deletes what is
    there, so it may run again over what a cut deletion left."""
    ApplicationsApi.delete_applications_for_market(market_id)
    AttendanceApi.delete_attendance_for_market(market_id)
    ApplicantAuth.delete_challenges_for_market(market_id)
    RememberedSignIns.delete_for_market(market_id)
    History.delete_for_market(market_id)
    VendorNotes.delete_for_market(market_id)
    Payments.delete_for_market(market_id)
    GridfsService.delete_images_for_market(market_id)


def delete_market_and_records(markets_collection: Any, market_id: str) -> Any:
    """Delete a market's records, then the market. Returns the market's ``DeleteResult``.

    Its caller has set the tombstone first, so no request reading the market from then on writes
    beside it; one that read it live before can still land a record between the two, and
    ``kept_only_while_live``, after that request's last write, takes it back."""
    delete_records(market_id)
    return markets_collection.delete_one({"id": market_id})


class MarketGoneUnderWrite(NotFoundError):
    """A write beside a market met it being deleted or gone, and what it wrote was taken back: the
    404 its loader would have answered had the deletion come first."""

    def __init__(self) -> None:
        super().__init__("Market not found")


def kept_only_while_live(markets_collection: Any, market_id: str) -> None:
    """Called after a request has written records beside a market (an application, its answers,
    their history): raises ``MarketGoneUnderWrite`` when the market is gone or a deletion now
    certain is taking it, having deleted its records again.

    A deletion sets its tombstone before it deletes any record, so a request that read the market
    live before the tombstone can write after the deletion swept: this read, after the request's
    last write, settles it. Seeing the market live, it came before the tombstone, so the sweep comes
    after every write here; seeing it gone or certainly going, the records the sweep may have missed
    are deleted here, since a market being deleted keeps none. A tombstone its organization's
    deletion may still take back (``deletion_decided``) leaves them: that deletion sweeps only
    after its trail is written, after this read, and a refused one leaves the market live with
    every record it has."""
    if not deletion_decided(markets_collection, market_id):
        return
    delete_records(market_id)
    raise MarketGoneUnderWrite()


def deletion_decided(markets_collection: Any, market_id: str) -> bool:
    """Whether the market is gone, or carries the tombstone of a deletion nothing takes back: its
    own Delete's, or its organization's once that deletion has written its trail.

    An organization's deletion judges its markets again after giving them its tombstone, and takes
    every tombstone back when one is under way; until its trail is written, its markets may live
    on. The organization is read after the market, and the market again after it, since that
    deletion takes a market's tombstone back before the organization's: a market still carrying a
    tombstone its organization does not is going by its own Delete."""
    document = markets_collection.find_one({"id": market_id})
    while document is not None:
        held = tombstone_of(document)
        if held is None:
            return False
        if DeletionTrail.is_recorded(held["trail_id"]):
            return True
        organization_id = market_doc_field(document, "organization_id")
        if organization_id and _carries(_organization(organization_id), held):
            return False
        again = markets_collection.find_one({"id": market_id})
        if _carries(again, held):
            return True
        document = again
    return True


def organization_taken(organization_id: str) -> bool:
    """Whether the organization is gone, or its deletion has written its trail: from then on it
    deletes the organization's history, and takes back no tombstone."""
    organization = _organization(organization_id)
    if organization is None:
        return True
    held = tombstone_of(organization)
    return held is not None and DeletionTrail.is_recorded(held["trail_id"])


def _organization(organization_id: str) -> Optional[Dict[str, Any]]:
    import api.organizations as OrgsApi  # it deletes markets through this module

    return OrgsApi.organizations_collection.find_one({"id": organization_id})


def _carries(document: Optional[Mapping[str, Any]], tombstone: Mapping[str, Any]) -> bool:
    """Whether ``document`` carries the tombstone of the deletion ``tombstone`` is of."""
    held = tombstone_of(document)
    return held is not None and held.get("trail_id") == tombstone.get("trail_id")
