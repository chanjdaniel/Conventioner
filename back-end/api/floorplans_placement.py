"""
Floorplan table auto-placement endpoint.

Receives room geometry (walls, obstacles), table specifications, and
aisle-configuration; returns a list of placed-table positions with x, y,
rotation in millimetre coordinates.
"""

import logging
import traceback

from flask import Blueprint, request, jsonify
from flask_login import login_required

from services.placement_service import auto_place_tables

logger = logging.getLogger(__name__)

floorplans_placement_bp = Blueprint("floorplans_placement", __name__)


# ── POST /api/floorplans/place-tables ──────────────────────────────────────────

@floorplans_placement_bp.route("/place-tables", methods=["POST"])
@login_required
def place_tables():
    """Auto-place rectangular tables into the room boundary.

    **Request body** (JSON)::

        {
            "walls": [
                {"start": [x, y], "end": [x, y], "thickness_mm": 200, "is_exterior": true}
            ],
            "obstacles": [
                {"polygon": [[x, y], ...], "type": "pillar"}
            ],
            "table_types": [
                {"id": "type_6ft", "name": "6ft Table", "width_mm": 1800, "height_mm": 900, "max_capacity": 2}
            ],
            "counts": {"type_6ft": 10},
            "scale_px_per_mm": 0.1,
            "aisle_config": {
                "wallBufferMm": 1500,
                "tableSpacingMm": 1200
            }
        }

    **Returns**::

        {
            "placed_tables": [
                {
                    "x_mm": 3000.0,
                    "y_mm": 4500.0,
                    "rotation": 0.0,
                    "width_mm": 1800,
                    "height_mm": 900,
                    "table_type_id": "type_6ft"
                }
            ]
        }
    """
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON"}), 400

        # ── validate required fields ──────────────────────────────────────
        for field in ("walls", "obstacles", "table_types", "counts", "scale_px_per_mm"):
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        walls = data["walls"]
        obstacles = data["obstacles"]
        table_types = data["table_types"]
        counts = data["counts"]
        scale_px_per_mm = data["scale_px_per_mm"]
        aisle_config = data.get("aisle_config")

        # Type checks
        if not isinstance(walls, list):
            return jsonify({"error": "walls must be an array"}), 400
        if not isinstance(obstacles, list):
            return jsonify({"error": "obstacles must be an array"}), 400
        if not isinstance(table_types, list):
            return jsonify({"error": "table_types must be an array"}), 400
        if not isinstance(counts, dict):
            return jsonify({"error": "counts must be an object"}), 400
        if not isinstance(scale_px_per_mm, (int, float)):
            return jsonify({"error": "scale_px_per_mm must be a number"}), 400

        # ── run placement ─────────────────────────────────────────────────
        placed = auto_place_tables(
            walls=walls,
            obstacles=obstacles,
            table_types=table_types,
            counts=counts,
            scale_px_per_mm=scale_px_per_mm,
            aisle_config=aisle_config,
        )

        return jsonify({"placed_tables": placed}), 200

    except Exception as exc:
        logger.error("Error in place_tables: %s", exc)
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
