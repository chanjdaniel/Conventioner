"""
Floorplan save-to-market endpoint.
Bridge between floorplan visual placement and the assignment engine.

POST /api/floorplans/save-to-market
  Accepts market_id + FloorplanObject JSON.
  Builds the market's plan with the floorplan's sections and locations, and the floorplan in
  ``setupObject.floorplans``, and writes it through the plan's own writer.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, request, jsonify
from flask_login import login_required
from pydantic import ValidationError

from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from client_errors import BadRequestError, field_named_copy, parse_failure_detail
from datatypes import (
    AssignmentOptionObject,
    FloorplanObject,
    LocationObject,
    SectionObject,
    SetupObject,
    TierObject,
)
from market_documents import market_doc_filter
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


def _sections_and_locations(
    floorplan: FloorplanObject,
) -> Tuple[List[SectionObject], List[LocationObject]]:
    """The plan's sections and locations, one section for each of the floorplan's, its count the
    tables grouped into it, and one location for each location name, in the order first named."""
    sections: List[SectionObject] = []
    locations: Dict[str, LocationObject] = {}
    for fp_section in floorplan.sections:
        location_name = fp_section.location_name
        locations.setdefault(location_name, LocationObject(name=location_name))
        tier_id = fp_section.tier_id
        sections.append(SectionObject(
            name=fp_section.name,
            location=LocationObject(name=location_name) if location_name else None,
            tier=TierObject(
                id=int(tier_id.split("_")[1]) if "_" in tier_id else 0, name=tier_id,
            ) if tier_id else None,
            count=len(fp_section.table_ids),
        ))
    return sections, list(locations.values())


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


def _floorplan_change(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """What a floorplan save changes of a plan, as its history entry records it."""
    if plan is None:
        return {"sections": None, "locations": None, "floorplan_ids": []}
    return {
        "sections": [section.model_dump() for section in plan.sections],
        "locations": [location.model_dump() for location in plan.locations],
        "floorplan_ids": [floorplan.id for floorplan in plan.floorplans or []],
    }


# ── POST /save-to-market ──────────────────────────────────────────────────────

@floorplans_save_bp.route("/save-to-market", methods=["POST"])
@login_required
def save_floorplan_to_market() -> Tuple[Any, int]:
    """Save a floorplan, and its sections and locations, to a Market's plan.

    **Request body** (JSON)::

        {
            "market_id": "uuid-string",
            "floorplan": { ... FloorplanObject fields, its own id among them ... }
        }

    Algorithm:
      1. Look up the Market document by ``market_id`` (404 if not found, 400 if it does not parse).
      2. Resolve the requesting user from the session and ask the table's Market Setup row
         (``Actions.CHANGE_SETUP``; 403 if not), then the archived rule (403) and the settled
         setup (409).
      3. Parse the floorplan (400 naming the field, or when it carries no id of its own).
      4. Build the plan: the stored one, or the empty plan Market Setup starts from, with its
         ``sections`` and ``locations`` the floorplan's and the floorplan in ``floorplans`` in the
         place of the one of its id, or added. Everything else is as stored.
      5. Write it through ``MarketsApi.prepared_plan``, the plan write's own judge, so what is
         stored is a plan that reads, held to every rule a plan write is.

    **Returns**::

        {
            "success": true,
            "market_id": "<uuid>",
            "sections_count": 3,
            "locations_count": 2
        }
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
    # A floorplan writes the sections and locations, which settle on leaving draft (E31/F01/S02).
    settled = MarketsApi.setup_lock_reason(market)
    if settled:
        return jsonify({"error": settled}), 409

    # ── 3. Parse the floorplan ─────────────────────────────────────────
    floorplan = _parsed_floorplan(market_id, data)

    # ── 4. The plan it makes ───────────────────────────────────────────
    stored = market.setup_object
    sections, locations = _sections_and_locations(floorplan)
    proposed = (stored or _empty_plan()).model_copy(update={
        "sections": sections,
        "locations": locations,
        "floorplans": _with_floorplan(stored.floorplans if stored else None, floorplan),
    })

    # ── 5. Write it through the plan's own writer ──────────────────────
    plan, update = MarketsApi.prepared_plan(
        market, {"setupObject": convert_keys_to_camel_case(proposed.model_dump())})
    MarketsApi.markets_collection.update_one(market_doc_filter("id", market_id), {"$set": update})
    History.record(
        market_id, user_email, Actions.CHANGE_SETUP, kind=History.FLOORPLAN,
        subject={"floorplan_id": floorplan.id},
        detail=lambda: History.changes(_floorplan_change(stored), _floorplan_change(plan)),
    )

    return jsonify({
        "success": True,
        "market_id": market_id,
        "sections_count": len(plan.sections),
        "locations_count": len(plan.locations),
    }), 200
