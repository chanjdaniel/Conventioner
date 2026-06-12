"""
Floorplan API endpoints for uploading, retrieving, and deleting floorplan images.
Uses GridFS for storage and pdf2image for PDF-to-image conversion.
"""

import io
import logging
import traceback

from flask import Blueprint, request, jsonify, send_file
from flask_login import login_required
from PIL import Image as PILImage

from services.gridfs_service import upload_image, get_image, delete_image
from utils.pdf_converter import pdf_to_images, is_pdf

logger = logging.getLogger(__name__)

floorplans_bp = Blueprint("floorplans", __name__)


def _get_image_dimensions(image_data: bytes):
    """Extract (width, height) from image bytes using PIL.
    Returns (0, 0) if the data is not parseable as an image.
    """
    try:
        img = PILImage.open(io.BytesIO(image_data))
        return img.size  # (width, height)
    except Exception as exc:
        logger.warning(f"Could not determine image dimensions: {exc}")
        return (0, 0)


def _detect_mimetype(image_data: bytes) -> str:
    """Detect image MIME type from raw bytes using PIL.
    Falls back to 'image/png' when detection fails.
    """
    try:
        img = PILImage.open(io.BytesIO(image_data))
        fmt = img.format
        if fmt:
            return f"image/{fmt.lower()}"
    except Exception:
        pass
    return "image/png"


# ── POST /api/floorplans/upload ──────────────────────────────────────────────

@floorplans_bp.route("/upload", methods=["POST"])
@login_required
def upload_floorplan():
    """Accept a multipart file upload (image or PDF).

    - Image: stores directly in GridFS, returns ``{gridfs_id, width, height}``.
    - PDF: converts each page via ``pdf_to_images``, stores each page
      separately, returns ``{pages: [{gridfs_id, width, height}, ...]}``.
    """
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "No file provided"}), 400

        # ── MIME type whitelist ───────────────────────────────────────────
        _ALLOWED_MIMES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
        content_type = file.content_type or ""
        if content_type not in _ALLOWED_MIMES:
            return jsonify({
                "error": f"Unsupported file type: {content_type}. "
                         "Allowed: image/png, image/jpeg, image/webp, application/pdf"
            }), 400

        file_bytes = file.read()
        if not file_bytes:
            return jsonify({"error": "Empty file"}), 400

        filename = file.filename or "floorplan"

        # ── PDF path ───────────────────────────────────────────────────
        if is_pdf(content_type) or filename.lower().endswith(".pdf"):
            page_images = pdf_to_images(file_bytes)
            if not page_images:
                return jsonify({"error": "Failed to convert PDF to images"}), 500

            pages = []
            for i, page_bytes in enumerate(page_images):
                page_filename = f"{filename}_page_{i + 1}.png"
                gridfs_id = upload_image(page_bytes, page_filename)
                width, height = _get_image_dimensions(page_bytes)
                pages.append({
                    "gridfs_id": gridfs_id,
                    "width": width,
                    "height": height,
                })

            return jsonify({"pages": pages}), 201

        # ── Image path ─────────────────────────────────────────────────
        gridfs_id = upload_image(file_bytes, filename)
        width, height = _get_image_dimensions(file_bytes)
        return jsonify({
            "gridfs_id": gridfs_id,
            "width": width,
            "height": height,
        }), 201

    except Exception as exc:
        logger.error(f"Error uploading floorplan: {exc}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# ── GET /api/floorplans/<gridfs_id> ──────────────────────────────────────────

@floorplans_bp.route("/<gridfs_id>", methods=["GET"])
def get_floorplan(gridfs_id: str):
    """Retrieve a floorplan image by its GridFS ObjectId.

    No authentication required — images are referenced by opaque ID.
    """
    try:
        image_data = get_image(gridfs_id)
        if image_data is None:
            return jsonify({"error": "Image not found"}), 404

        mimetype = _detect_mimetype(image_data)
        return send_file(io.BytesIO(image_data), mimetype=mimetype)

    except Exception as exc:
        logger.error(f"Error retrieving floorplan {gridfs_id}: {exc}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500


# ── DELETE /api/floorplans/<gridfs_id> ───────────────────────────────────────

@floorplans_bp.route("/<gridfs_id>", methods=["DELETE"])
@login_required
def delete_floorplan(gridfs_id: str):
    """Delete a floorplan image from GridFS. Requires login."""
    try:
        success = delete_image(gridfs_id)
        if not success:
            return jsonify({"error": "Image not found"}), 404

        return jsonify({"message": "Image deleted successfully"}), 200

    except Exception as exc:
        logger.error(f"Error deleting floorplan {gridfs_id}: {exc}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
