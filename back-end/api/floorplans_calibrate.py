"""
Floorplan scale calibration endpoint.
Computes scale factor (px/mm) from a user-drawn reference line on a floorplan image.
"""

import io
import logging
import math
import traceback

from flask import Blueprint, request, jsonify
from flask_login import login_required
from PIL import Image as PILImage

from services.gridfs_service import get_image

logger = logging.getLogger(__name__)

floorplans_calibrate_bp = Blueprint("floorplans_calibrate", __name__)


def _validate_reference_line(ref_line: dict, width: int, height: int):
    """Validate reference line coordinates.

    Returns (errors, start_x, start_y, end_x, end_y).  errors is a list of
    human-readable strings; if non-empty the validation fails.
    """
    errors = []

    required_keys = ("start_x", "start_y", "end_x", "end_y")
    for key in required_keys:
        if key not in ref_line:
            errors.append(f"reference_line.{key} is required")
            return errors, 0, 0, 0, 0  # bail early — not all coords present

    try:
        start_x = float(ref_line["start_x"])
        start_y = float(ref_line["start_y"])
        end_x = float(ref_line["end_x"])
        end_y = float(ref_line["end_y"])
    except (TypeError, ValueError):
        errors.append("reference_line coordinates must be numbers")
        return errors, 0, 0, 0, 0

    # Endpoints must not be identical
    if start_x == end_x and start_y == end_y:
        errors.append(
            "reference_line start and end must be different (non-zero length)"
        )

    # Bounds check (image dimensions are 0-indexed: valid range is 0..w, 0..h)
    for label, val, limit in [
        ("start_x", start_x, width),
        ("end_x", end_x, width),
        ("start_y", start_y, height),
        ("end_y", end_y, height),
    ]:
        if val < 0 or val > limit:
            errors.append(
                f"reference_line.{label} ({val}) is outside image bounds "
                f"(0–{limit})"
            )

    return errors, start_x, start_y, end_x, end_y


# ── POST /api/floorplans/calibrate ────────────────────────────────────────────

@floorplans_calibrate_bp.route("/calibrate", methods=["POST"])
@login_required
def calibrate_floorplan():
    """Compute scale factor from a reference line on a floorplan image.

    Request body (JSON):
        {
            "gridfs_id": "<ObjectId string>",
            "reference_line": {
                "start_x": 100, "start_y": 200,
                "end_x": 500,   "end_y": 200
            },
            "length_mm": 5000
        }

    Returns:
        {
            "scale_px_per_mm": 0.08,
            "scale_mm_per_px": 12.5,
            "pixel_distance": 400.0,
            "image_width": 4000,
            "image_height": 3000
        }

    scale_px_per_mm = pixel_distance / length_mm
    scale_mm_per_px = 1 / scale_px_per_mm
    """
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON"}), 400

        # ── Validate required fields ────────────────────────────────────
        gridfs_id = data.get("gridfs_id")
        if not gridfs_id or not isinstance(gridfs_id, str):
            return jsonify({"error": "gridfs_id (string) is required"}), 400

        length_mm = data.get("length_mm")
        if length_mm is None:
            return jsonify({"error": "length_mm (number) is required"}), 400
        try:
            length_mm = float(length_mm)
        except (TypeError, ValueError):
            return jsonify({"error": "length_mm must be a number"}), 400
        if length_mm <= 0:
            return jsonify({"error": "length_mm must be greater than 0"}), 400

        ref_line = data.get("reference_line")
        if not ref_line or not isinstance(ref_line, dict):
            return jsonify({"error": "reference_line (object) is required"}), 400

        # ── Retrieve image from GridFS ──────────────────────────────────
        image_data = get_image(gridfs_id)
        if image_data is None:
            return jsonify({"error": "Image not found for the given gridfs_id"}), 404

        # ── Get image dimensions for bounds validation ──────────────────
        try:
            img = PILImage.open(io.BytesIO(image_data))
            width, height = img.size
        except Exception as exc:
            logger.warning(f"Could not open image {gridfs_id}: {exc}")
            return jsonify({"error": "Stored data is not a valid image"}), 400

        # ── Validate reference line coordinates ─────────────────────────
        errors, start_x, start_y, end_x, end_y = _validate_reference_line(
            ref_line, width, height
        )
        if errors:
            return jsonify({"error": "Invalid reference_line", "details": errors}), 400

        # ── Compute scale ───────────────────────────────────────────────
        pixel_distance = math.sqrt(
            (end_x - start_x) ** 2 + (end_y - start_y) ** 2
        )
        scale_px_per_mm = pixel_distance / length_mm
        scale_mm_per_px = length_mm / pixel_distance  # = 1 / scale_px_per_mm

        return jsonify({
            "scale_px_per_mm": scale_px_per_mm,
            "scale_mm_per_px": scale_mm_per_px,
            "pixel_distance": pixel_distance,
            "image_width": width,
            "image_height": height,
        }), 200

    except Exception as exc:
        logger.error(f"Error in calibrate_floorplan: {exc}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
