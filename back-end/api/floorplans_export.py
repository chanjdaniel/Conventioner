"""
Floorplan export endpoint.
Renders a floorplan image with table overlay rectangles and returns a PNG.
"""

import io
import logging
import math
import traceback

from flask import Blueprint, request, jsonify, send_file
from PIL import Image, ImageDraw, ImageFont

from services.gridfs_service import get_image

logger = logging.getLogger(__name__)

floorplans_export_bp = Blueprint("floorplans_export", __name__)

# ── Section color palette ──────────────────────────────────────────────────────
# Deterministic 20-color palette for section-based coloring.
_SECTION_COLORS = [
    "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
    "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4",
    "#469990", "#dcbeff", "#9a6324", "#fffac8", "#800000",
    "#aaffc3", "#808000", "#ffd8b1", "#000075", "#a9a9a9",
]


def _get_section_color(section_name: str) -> str:
    """Return a deterministic color for a section name.

    Uses hash so the same section always gets the same color across requests.
    """
    if not section_name:
        return "#cccccc"
    idx = abs(hash(section_name)) % len(_SECTION_COLORS)
    return _SECTION_COLORS[idx]


# ── Geometry helpers ───────────────────────────────────────────────────────────

def _compute_rotated_corners(
    cx_px: float, cy_px: float,
    w_px: float, h_px: float,
    rotation_deg: float,
):
    """Compute the four corner points of a rotated rectangle.

    Args:
        cx_px, cy_px: Center point in pixel coordinates.
        w_px, h_px: Width and height in pixels.
        rotation_deg: Clockwise rotation in degrees (0 = horizontal).

    Returns:
        List of [(x1, y1), (x2, y2), (x3, y3), (x4, y4)] in order.
    """
    angle = math.radians(rotation_deg)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)

    hw = w_px / 2.0
    hh = h_px / 2.0

    # Unrotated corners relative to center (top-left, top-right, bottom-right,
    # bottom-left)
    corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]

    result = []
    for dx, dy in corners:
        # Standard 2D rotation (counter-clockwise in math coords, but appears
        # clockwise in image coords due to y-axis pointing down).
        rx = dx * cos_a - dy * sin_a
        ry = dx * sin_a + dy * cos_a
        result.append((cx_px + rx, cy_px + ry))

    return result


# ── POST /api/floorplans/export ────────────────────────────────────────────────

@floorplans_export_bp.route("/export", methods=["POST"])
def export_floorplan():
    """Render a floorplan image with table overlay rectangles and return PNG.

    **Request body (JSON):**::

        {
            "gridfs_id": "<ObjectId string>",
            "placed_tables": [
                {
                    "x_mm": 500, "y_mm": 300,
                    "rotation": 0,
                    "width_mm": 1800, "height_mm": 800,
                    "table_code": "A1",
                    "section_name": "A"
                }
            ],
            "scale_px_per_mm": 0.5,
            "options": {
                "show_codes": true,
                "show_sections": true
            }
        }

    Display options can also be passed as query parameters
    (``?show_codes=true&show_sections=true``).  JSON body ``options``
    overrides query params when both are present.

    Returns a ``image/png`` response.
    """
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON"}), 400

        # ── Validate gridfs_id ───────────────────────────────────────────
        gridfs_id = data.get("gridfs_id")
        if not gridfs_id or not isinstance(gridfs_id, str):
            return jsonify({"error": "gridfs_id (string) is required"}), 400

        # ── Validate placed_tables ───────────────────────────────────────
        placed_tables = data.get("placed_tables")
        if not placed_tables or not isinstance(placed_tables, list):
            return jsonify({"error": "placed_tables (array) is required"}), 400

        # ── Validate scale ───────────────────────────────────────────────
        scale = data.get("scale_px_per_mm")
        if scale is None:
            return jsonify({"error": "scale_px_per_mm (number) is required"}), 400
        try:
            scale = float(scale)
        except (TypeError, ValueError):
            return jsonify({"error": "scale_px_per_mm must be a number"}), 400
        if scale <= 0:
            return jsonify({"error": "scale_px_per_mm must be greater than 0"}), 400

        # ── Parse display options ────────────────────────────────────────
        options = data.get("options") or {}
        if not isinstance(options, dict):
            options = {}

        # Query-param defaults (both true)
        show_codes = request.args.get("show_codes", "true").lower() != "false"
        show_sections = request.args.get("show_sections", "true").lower() != "false"

        # JSON body overrides query params
        if "show_codes" in options:
            show_codes = bool(options["show_codes"])
        if "show_sections" in options:
            show_sections = bool(options["show_sections"])

        # ── Load floorplan image from GridFS ─────────────────────────────
        image_data = get_image(gridfs_id)
        if image_data is None:
            return jsonify({"error": "Image not found for the given gridfs_id"}), 404

        try:
            # Open as RGBA so we can draw cleanly, then flatten to RGB for PNG
            img = Image.open(io.BytesIO(image_data)).convert("RGBA")
        except Exception as exc:
            logger.warning(f"Could not open image {gridfs_id}: {exc}")
            return jsonify({"error": "Stored data is not a valid image"}), 400

        # ── Prepare drawing ──────────────────────────────────────────────
        draw = ImageDraw.Draw(img)

        # Try to load a reasonable font for table codes; fall back to PIL default
        _font = None
        for font_path in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ):
            try:
                _font = ImageFont.truetype(font_path, 14)
                break
            except (IOError, OSError):
                continue
        if _font is None:
            try:
                _font = ImageFont.load_default()
            except Exception:
                pass

        # ── Draw each table ──────────────────────────────────────────────
        for table in placed_tables:
            if not isinstance(table, dict):
                continue

            # Extract dimensions (all mm)
            try:
                x_mm = float(table.get("x_mm", 0))
                y_mm = float(table.get("y_mm", 0))
                w_mm = float(table.get("width_mm", 0))
                h_mm = float(table.get("height_mm", 0))
                rotation = float(table.get("rotation", 0))
            except (TypeError, ValueError):
                continue

            if w_mm <= 0 or h_mm <= 0:
                continue

            table_code = str(table.get("table_code", ""))
            section_name = str(table.get("section_name", ""))

            # Convert mm → pixels
            cx = x_mm * scale
            cy = y_mm * scale
            w_px = w_mm * scale
            h_px = h_mm * scale

            # Color: by section if enabled, otherwise a neutral green
            color = _get_section_color(section_name) if show_sections else "#00cc66"

            # Draw rotated rectangle outline
            corners = _compute_rotated_corners(cx, cy, w_px, h_px, rotation)
            draw.polygon(corners, outline=color, width=2)

            # Draw table code text centered inside the rectangle
            if show_codes and table_code:
                # Compute approximate text dimensions for centering
                if _font:
                    try:
                        bbox = draw.textbbox((0, 0), table_code, font=_font)
                        tw = bbox[2] - bbox[0]
                        th = bbox[3] - bbox[1]
                    except Exception:
                        tw = len(table_code) * 8
                        th = 14
                else:
                    tw = len(table_code) * 8
                    th = 14

                tx = cx - tw / 2.0
                ty = cy - th / 2.0

                # Drop-shadow for readability against busy floorplans
                draw.text((tx + 1, ty + 1), table_code, fill="#000000", font=_font)
                draw.text((tx, ty), table_code, fill="#ffffff", font=_font)

        # ── Flatten RGBA → RGB for PNG output ────────────────────────────
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # ── Encode and return ────────────────────────────────────────────
        output = io.BytesIO()
        img.save(output, format="PNG")
        output.seek(0)

        return send_file(output, mimetype="image/png")

    except Exception as exc:
        logger.error(f"Error in export_floorplan: {exc}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
