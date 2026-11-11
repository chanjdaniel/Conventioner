"""
Floorplan save-to-market endpoint.
Bridge between floorplan visual placement and the assignment engine.

POST /api/floorplans/save-to-market
  Accepts market_id + FloorplanObject JSON: a location's layout (T257).
  Puts the floorplan in ``setupObject.floorplans`` in the place of the one of its id, or adds it,
  and writes the plan through the plan's own writer, which derives the sections' counts from it.
  Sections and locations are Market Setup's: the save never writes them.
"""

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, request, jsonify
from flask_login import login_required
from pydantic import ValidationError

from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from client_errors import BadRequestError, field_named_copy, parse_failure_detail
from datatypes import AssignmentOptionObject, FloorplanObject, SetupObject
import layout as Layout
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


#: A floorplan's parts that are not its layout, which ``layout_digest`` stands for: its id, and its
#: revision, which every write moves.
_NOT_LAYOUT = {"id", "revision"}


def _floorplan_summary(floorplan: Optional[FloorplanObject]) -> Dict[str, Any]:
    """A floorplan as its history entry records it: what it holds, counted, and a digest of its
    layout, which differs whenever a table, a zone, a style, the scale or the image does. Never the
    floorplan itself, which an entry fetched with the market's history would carry whole (up to
    1,000 tables) on every save."""
    if floorplan is None:
        return {"tables": None, "no_go_zones": None, "layout_digest": None}
    layout = json.dumps(floorplan.model_dump(exclude=_NOT_LAYOUT), sort_keys=True, default=str)
    return {
        "tables": len(floorplan.tables),
        "no_go_zones": len(floorplan.zones),
        "layout_digest": hashlib.sha256(layout.encode()).hexdigest()[:16],
    }


def _floorplan_change(plan: Optional[SetupObject], floorplan_id: str) -> Dict[str, Any]:
    """What a floorplan save changes of a plan, as its history entry records it: the plan's
    sections, locations and floorplan ids, and the summary of the floorplan of the saved id, so a
    save that replaced it with only its layout changed is recorded too."""
    floorplans = (plan.floorplans if plan else None) or []
    saved = next((floorplan for floorplan in floorplans if floorplan.id == floorplan_id), None)
    if plan is None:
        return {"sections": None, "locations": None, "floorplan_ids": [],
                **_floorplan_summary(None)}
    return {
        "sections": [section.model_dump() for section in plan.sections],
        "locations": [location.model_dump() for location in plan.locations],
        "floorplan_ids": [floorplan.id for floorplan in floorplans],
        **_floorplan_summary(saved),
    }


# ── POST /save-to-market ──────────────────────────────────────────────────────

@floorplans_save_bp.route("/save-to-market", methods=["POST"])
@login_required
def save_floorplan_to_market() -> Tuple[Any, int]:
    """Save a location's layout (a floorplan) to a Market's plan.

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
      4. Build the plan: the stored one, or the empty plan Market Setup starts from, with the
         floorplan in ``floorplans`` in the place of the one of its id, or added. Everything else
         is as stored.
      5. Write it through ``MarketsApi.prepared_plan`` with those floorplans, the plan write's own
         judge, so what is stored is a plan that reads, its sections counting the layout's tables,
         held to every rule a plan write is: among them the floorplan's bounds
         (``floorplan_limits``) and its image, which must be one uploaded for this market (400
         with the sentence for each); then the layout's own rules (``layout.layout_refusal``: its
         location one of the plan's, each section's tables numbered 1 to N, every type the
         market's, every table inside the floorplan; 400 with the sentence).

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
    # A layout's tables are the sections' counts, which settle on leaving draft (E31/F01/S02).
    settled = MarketsApi.setup_lock_reason(market)
    if settled:
        return jsonify({"error": settled}), 409

    # ── 3. Parse the floorplan ─────────────────────────────────────────
    floorplan = _parsed_floorplan(market_id, data)

    stored = market.setup_object

    # ── 4. The plan it makes ───────────────────────────────────────────
    proposed = stored or _empty_plan()
    floorplans = _with_floorplan(stored.floorplans if stored else None, floorplan)

    # ── 5. Write it through the plan's own writer ──────────────────────
    prepared = MarketsApi.prepared_plan(
        market, {"setupObject": convert_keys_to_camel_case(proposed.model_dump())},
        floorplans=floorplans)
    plan = prepared.plan
    refused = Layout.layout_refusal(floorplan, plan)
    if refused:
        raise BadRequestError(refused)
    MarketsApi.markets_collection.update_one(
        market_doc_filter("id", market_id), {"$set": prepared.update})
    MarketsApi.release_removed_floorplans(market, prepared.removed_floorplans, user_email)
    History.record(
        market_id, user_email, Actions.CHANGE_SETUP, kind=History.FLOORPLAN,
        subject={"floorplan_id": floorplan.id},
        detail=lambda: History.changes(
            _floorplan_change(stored, floorplan.id), _floorplan_change(plan, floorplan.id)),
    )

    return jsonify({
        "success": True,
        "market_id": market_id,
        "sections_count": len(plan.sections),
        "locations_count": len(plan.locations),
    }), 200
