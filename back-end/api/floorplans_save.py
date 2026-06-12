"""
Floorplan save-to-market endpoint.
Bridge between floorplan visual placement and the assignment engine.

POST /api/floorplans/save-to-market
  Accepts market_id + FloorplanObject JSON.
  Extracts SectionObjects and LocationObjects from floorplan sections,
  updates Market.setupObject.sections, .locations, and .floorplans.
"""

import logging
import traceback

from flask import Blueprint, request, jsonify
from flask_login import login_required

from db_config import get_database
from datatypes import Market, MarketRole
from assignment.utils import convert_keys_to_snake_case

logger = logging.getLogger(__name__)

db = get_database()
markets_collection = db["markets"]

floorplans_save_bp = Blueprint("floorplans_save", __name__)


# ── POST /save-to-market ──────────────────────────────────────────────────────

@floorplans_save_bp.route("/save-to-market", methods=["POST"])
@login_required
def save_floorplan_to_market():
    """Save a floorplan's sections and locations to a Market's setupObject.

    **Request body** (JSON)::

        {
            "market_id": "uuid-string",
            "floorplan": { ... FloorplanObject fields ... }
        }

    Algorithm:
      1. Look up the Market document by ``market_id`` (404 if not found).
      2. Resolve the requesting user from the ``X-Owner-Email`` header and
         verify they hold EDITOR+ permission on the market (403 if not).
      3. Walk ``floorplan.sections``, extracting ``SectionObject`` entries
         (name, location name, tier id, count = len(tableIds)) and
         deduplicating ``LocationObject`` entries by name.
      4. Build / preserve ``setupObject`` on the Market document, setting
         ``sections``, ``locations``, and appending to ``floorplans``.
      5. Return counts and success.

    **Returns**::

        {
            "success": true,
            "market_id": "<uuid>",
            "sections_count": 3,
            "locations_count": 2
        }
    """
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON"}), 400

        market_id = data.get("market_id")
        floorplan = data.get("floorplan")

        if not market_id:
            return jsonify({"error": "market_id is required"}), 400
        if not floorplan:
            return jsonify({"error": "floorplan is required"}), 400

        # ── 1. Find the market ─────────────────────────────────────────────
        market_doc = markets_collection.find_one({"id": market_id})
        if not market_doc:
            return jsonify({"error": "Market not found"}), 404

        # ── 2. Permission check ────────────────────────────────────────────
        user_email = request.headers.get("X-Owner-Email")
        if not user_email:
            return jsonify({"error": "User email not provided in headers"}), 401

        market_dict_snake = convert_keys_to_snake_case(market_doc.copy())
        try:
            market = Market(**market_dict_snake)
        except Exception:
            return jsonify({"error": "Invalid market data"}), 400

        # Resolve organization for org-based access
        import api.permissions as PermissionsApi
        import api.organizations as OrgsApi

        organization = None
        if market.organization_id:
            org_dict = OrgsApi.get_organization(market.organization_id)
            if org_dict:
                org_dict.pop("_id", None)
                try:
                    from datatypes import Organization
                    organization = Organization(**org_dict)
                except Exception:
                    pass

        if not PermissionsApi.user_has_permission(
            user_email, market, MarketRole.EDITOR, organization
        ):
            return jsonify({
                "error": "User does not have permission to edit this market"
            }), 403

        # ── 3. Extract sections and locations from floorplan ───────────────
        sections_data = []
        locations_data = {}

        for fp_section in floorplan.get("sections", []):
            section_name = fp_section.get("name", "Unnamed Section")
            location_name = fp_section.get("locationName", "Default")
            tier_id = fp_section.get("tierId")
            table_count = len(fp_section.get("tableIds", []))

            # Deduplicate locations by name
            if location_name not in locations_data:
                locations_data[location_name] = {"name": location_name}

            # Build SectionObject dict (camelCase keys for MongoDB)
            section = {
                "name": section_name,
                "location": {"name": location_name} if location_name else None,
                "tier": {
                    "id": int(tier_id.split("_")[1]) if tier_id and "_" in tier_id else 0,
                    "name": tier_id,
                } if tier_id else None,
                "count": table_count,
            }
            sections_data.append(section)

        # ── 4. Update Market.setupObject atomically ────────────────────────
        markets_collection.update_one(
            {"id": market_id},
            {
                "$set": {
                    "setupObject.sections": sections_data,
                    "setupObject.locations": list(locations_data.values()),
                },
                "$push": {
                    "setupObject.floorplans": floorplan,
                },
            },
        )

        # ── 5. Return success ──────────────────────────────────────────────
        return jsonify({
            "success": True,
            "market_id": market_id,
            "sections_count": len(sections_data),
            "locations_count": len(locations_data),
        }), 200

    except Exception as exc:
        logger.error("Error saving floorplan to market: %s", exc)
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
