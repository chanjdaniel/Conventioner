"""
Floorplan save-to-market endpoint.
Bridge between floorplan visual placement and the assignment engine.

POST /api/floorplans/save-to-market
  Accepts market_id, a FloorplanObject (a location's layout, T257) and the revision of it the
  caller read. Puts the floorplan in ``setupObject.floorplans`` in the place of the one of its id,
  or adds it as the location's first, and writes the plan through the plan's own writer, which
  derives the sections' counts from it. Sections and locations are Market Setup's: the save never
  writes them.
"""

import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, request, jsonify
from flask_login import login_required
from pydantic import ValidationError

from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from client_errors import BadRequestError, field_named_copy, parse_failure_detail
from datatypes import (
    AssignmentOptionObject, FloorplanObject, SetupObject, StartingCount, TableTypeObject,
)
import layout as Layout
from market_documents import market_doc_filter, market_doc_key
from services.gridfs_service import delete_image
from utils.identity import authenticated_email
from utils.request_body import NOT_AN_OBJECT, string_field

import api.markets as MarketsApi
import api.market_actions as Actions
import history as History

logger = logging.getLogger(__name__)

floorplans_save_bp = Blueprint("floorplans_save", __name__)

def _empty_plan() -> SetupObject:
    """The plan Market Setup starts from (``MarketSetupView.vue``), and so the one a floorplan
    saved to a market whose plan was never saved starts from too."""
    return SetupObject(
        priority=[], market_dates=[], tiers=[], locations=[], sections=[],
        assignment_options=AssignmentOptionObject(),
    )


def _parsed_floorplan(market_id: str, body: Dict[str, Any]) -> FloorplanObject:
    """The floorplan the body carries, parsed as every model write parses, unknown keys dropped.

    Its own id is required, never the model's default: a save replaces the floorplan of the same
    id, so it must be the id the client holds.
    """
    try:
        floorplan = FloorplanObject.model_validate(convert_keys_to_snake_case(body["floorplan"]))
    except ValidationError as e:
        logger.warning("Refused a floorplan for market %s: %s", market_id, parse_failure_detail(e))
        raise BadRequestError(field_named_copy("Invalid floorplan", e)) from e
    given_id = body["floorplan"].get("id")
    if not isinstance(given_id, str) or not given_id.strip():
        raise BadRequestError("A floorplan needs its id.")
    return floorplan


def _with_floorplan(
    floorplans: Optional[List[FloorplanObject]], floorplan: FloorplanObject,
) -> List[FloorplanObject]:
    """The floorplans with this one in the place of the one of its id, or added after them."""
    kept = list(floorplans or [])
    for index, stored in enumerate(kept):
        if stored.id == floorplan.id:
            kept[index] = floorplan
            return kept
    return kept + [floorplan]


#: Why a save is refused when the layout it read is no longer the stored one: another tab or
#: another organizer saved it, or started this location's layout, in between.
STALE_LAYOUT = "This layout changed elsewhere. Reload to see the latest."

#: The table type a market with none gains as its first layout starts: a 6 ft trestle table.
STANDARD_TABLE_TYPE = {"name": "Standard 6 ft", "width_mm": 1830, "depth_mm": 760}


class StaleLayout(Exception):
    """The layout the save read is not the one stored: answered 409 with ``STALE_LAYOUT``."""


def _revision(data: Dict[str, Any]) -> Optional[int]:
    """The revision of the layout the caller read, 0 for a new one; None when it names none."""
    revision = data.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        return None
    return revision


def _stored_layout(
    stored: Optional[SetupObject], floorplan: FloorplanObject, revision: int,
) -> Tuple[Optional[int], Optional[FloorplanObject]]:
    """The place and the floorplan the save replaces, ``(None, None)`` for a location's first
    layout; ``StaleLayout`` when the caller read another revision of it, or a new layout's location
    already has one."""
    floorplans = (stored.floorplans if stored else None) or []
    for index, held in enumerate(floorplans):
        if held.id == floorplan.id:
            if held.revision != revision:
                raise StaleLayout()
            return index, held
    if revision != 0:
        raise StaleLayout()
    if floorplan.location_id is not None and any(
            held.location_id == floorplan.location_id for held in floorplans):
        raise StaleLayout()
    return None, None


def _still_as_read(
    index: Optional[int], held: Optional[FloorplanObject], floorplan: FloorplanObject,
) -> Dict[str, Any]:
    """The filter holding what ``_stored_layout`` read, so a save that lands between this save's
    read and its write makes this one match nothing: the replaced layout still at its place and
    revision, or, for a new one, no layout of its id or its location."""
    floorplans = f"{market_doc_key('setup_object')}.floorplans"
    if held is None:
        return {f"{floorplans}.id": {"$ne": floorplan.id},
                f"{floorplans}.locationId": {"$ne": floorplan.location_id}}
    # A layout stored before revisions were written has none, which reads as 0.
    revision = {"$in": [0, None]} if held.revision == 0 else held.revision
    return {f"{floorplans}.{index}.id": held.id, f"{floorplans}.{index}.revision": revision}


def _started(plan: SetupObject, floorplan: FloorplanObject) -> FloorplanObject:
    """A location's first layout, holding what Section Setup had for each of its sections."""
    counts = [
        StartingCount(section_id=section.id, count=section.count)
        for section in plan.sections
        if section.location is not None and section.location.id == floorplan.location_id
    ]
    return floorplan.model_copy(update={"starting_counts": counts})


# ── POST /save-to-market ──────────────────────────────────────────────────────

@floorplans_save_bp.route("/save-to-market", methods=["POST"])
@login_required
def save_floorplan_to_market() -> Tuple[Any, int]:
    """Save a location's layout (a floorplan) to a Market's plan.

    **Request body** (JSON)::

        {
            "market_id": "uuid-string",
            "floorplan": { ... FloorplanObject fields, its own id among them ... },
            "revision": 3
        }

    ``revision`` is the stored revision of the layout the caller read, 0 for a new one.

    Algorithm:
      1. Look up the Market document by ``market_id`` (404 if not found, 400 if it does not parse).
      2. Resolve the requesting user from the session and ask the table's Market Setup row
         (``Actions.CHANGE_SETUP``; 403 if not), then the archived rule (403) and the settled
         setup (409).
      3. Parse the floorplan (400 naming the field, or when it carries no id of its own).
      4. Find the layout it replaces, by id: 409 ``STALE_LAYOUT`` when the stored one is of another
         revision, or, for a new id, when ``revision`` is not 0 or the location has a layout
         already. A layout keeps its location, its starting counts and moves its revision by one;
         a new one records Section Setup's counts for its location's sections, starts at revision
         1, and gives a market with no table type "Standard 6 ft".
      5. Write it through ``MarketsApi.prepared_plan`` with those floorplans, the plan write's own
         judge, its tables of a section not its location's in none and of no number
         (``layout.in_its_sections``), so what is stored is a plan that reads, its sections
         counting the layout's tables, held to every rule a plan write is: among them the
         floorplan's bounds (``floorplan_limits``) and its image, which must be one uploaded for
         this market (400 with the sentence for each); then the layout's own rules
         (``layout.layout_refusal``: its location one of the plan's, no two tables of one id, each
         section's tables numbered 1 to N, every type the market's, every table inside the
         floorplan; 400 with the sentence). The write holds what
         step 4 read, and the market's table types as it read them, so a save or a write of the
         types landing in between makes it 409 ``STALE_LAYOUT`` too. An image the
         layout no longer names is deleted.

    **Returns** the layout and the plan's sections as stored, so the editor adopts the revision and
    the counts::

        {"floorplan": { ... }, "sections": [ ... ]}
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be valid JSON"}), 400
    if not isinstance(data, dict):
        return jsonify({"error": NOT_AN_OBJECT}), 400

    market_id = string_field(data, "market_id")
    if not market_id:
        return jsonify({"error": "market_id is required"}), 400
    if not isinstance(data.get("floorplan"), dict):
        return jsonify({"error": "floorplan is required"}), 400
    revision = _revision(data)
    if revision is None:
        return jsonify({"error": "revision is required"}), 400

    # ── 1. Find the market ─────────────────────────────────────────────
    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return jsonify({"error": "Market not found"}), 404
    if context.market is None:
        return jsonify({"error": "Invalid market data"}), 400
    market = context.market

    # ── 2. Permission check ────────────────────────────────────────────
    user_email = authenticated_email()
    refused = Actions.refusal(Actions.CHANGE_SETUP, user_email, market, context.organization)
    if refused:
        return jsonify({"error": refused}), 403
    # It writes the plan, and an archived market's plan is part of its record (bug 30).
    refusal = MarketsApi.archived_refusal(market)
    if refusal:
        return jsonify({"error": refusal}), 403
    # A layout's tables are the sections' counts, which settle on leaving draft (E31/F01/S02).
    settled = MarketsApi.setup_lock_reason(market)
    if settled:
        return jsonify({"error": settled}), 409

    # ── 3. Parse the floorplan ─────────────────────────────────────────
    floorplan = _parsed_floorplan(market_id, data)

    stored = market.setup_object
    proposed = stored or _empty_plan()

    # ── 4. The layout it replaces, or starts ───────────────────────────
    try:
        index, held = _stored_layout(stored, floorplan, revision)
    except StaleLayout:
        return jsonify({"error": STALE_LAYOUT}), 409
    table_types = None
    if held is None:
        floorplan = _started(proposed, floorplan)
        if not proposed.table_types:
            table_types = [TableTypeObject(id=str(uuid.uuid4()), **STANDARD_TABLE_TYPE)]
    else:
        floorplan = floorplan.model_copy(update={
            "location_id": held.location_id, "starting_counts": held.starting_counts})
    # A table of a section not its location's is stored in none, of no number (T257).
    floorplan = Layout.in_its_sections(
        floorplan.model_copy(update={"revision": revision + 1}), proposed)
    floorplans = _with_floorplan(stored.floorplans if stored else None, floorplan)

    # ── 5. Write it through the plan's own writer ──────────────────────
    prepared = MarketsApi.prepared_plan(
        market, {"setupObject": convert_keys_to_camel_case(proposed.model_dump())},
        floorplans=floorplans, table_types=table_types)
    plan = prepared.plan
    refused = Layout.layout_refusal(floorplan, plan)
    if refused:
        raise BadRequestError(refused)
    written = MarketsApi.markets_collection.update_one(
        {**market_doc_filter("id", market_id), **_still_as_read(index, held, floorplan),
         **prepared.held},
        {"$set": prepared.update})
    if written.matched_count == 0:
        return jsonify({"error": STALE_LAYOUT}), 409
    MarketsApi.release_removed_floorplans(market, prepared.removed_floorplans, user_email)
    if held is not None and held.image_gridfs_id \
            and held.image_gridfs_id != floorplan.image_gridfs_id:
        delete_image(held.image_gridfs_id)
    location = next(
        (place.name for place in plan.locations if place.id == floorplan.location_id), None)
    History.record(
        market_id, user_email, Actions.CHANGE_SETUP, kind=History.FLOORPLAN,
        subject={"floorplan_id": floorplan.id, "location": location},
        detail=lambda: Layout.describe_change(held, floorplan, plan) or None,
    )

    saved = convert_keys_to_camel_case(plan.model_dump())
    return jsonify({
        "floorplan": next(f for f in saved["floorplans"] if f["id"] == floorplan.id),
        "sections": saved["sections"],
    }), 200
