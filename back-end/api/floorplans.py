"""
Floorplan API endpoints for uploading, retrieving, and deleting floorplan images.
Uses GridFS for storage and pypdfium2 for PDF-to-image conversion.
"""

import io
import logging
import traceback

from flask import Blueprint, request, jsonify, send_file
from flask_login import login_required
from PIL import Image as PILImage

from api.floorplans_access import image_refusal, market_refusal
import api.market_actions as Actions
import floorplan_limits as Limits
import history as History
from services.gridfs_service import delete_image, get_image, get_image_market_id, upload_image
from utils.identity import authenticated_email
from utils.pdf_converter import TooManyPages, UnreadablePdf, pdf_to_images, is_pdf

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
    """Accept a multipart file upload (image or PDF) for a market.

    The ``market_id`` form field names the market the image is for: the caller must be an editor
    of it, on a market that is not archived, and every stored image remembers it.

    - Image: stores directly in GridFS, returns ``{gridfs_id, width, height}``.
    - PDF: converts each page via ``pdf_to_images``, stores each page
      separately, returns ``{pages: [{gridfs_id, width, height}, ...]}``.

    Held to production's limits (T257): a file over ``MAX_UPLOAD_BYTES`` is refused 413, by the
    request's ``Content-Length`` before the body is read when it says so, and by the file's own
    length when it does not; a PDF of more than ``MAX_PDF_PAGES`` pages, or one PDFium cannot open,
    is refused 400 with a sentence, the latter naming the file.
    """
    length = request.content_length
    if length is not None and length > Limits.MAX_UPLOAD_BYTES + Limits.UPLOAD_FORM_ALLOWANCE_BYTES:
        return jsonify({"error": Limits.UPLOAD_TOO_LARGE}), 413
    try:
        market_id = request.form.get("market_id")
        refusal = market_refusal(market_id, Actions.CHANGE_SETUP, edits=True)
        if refusal:
            return refusal

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
        if len(file_bytes) > Limits.MAX_UPLOAD_BYTES:
            return jsonify({"error": Limits.UPLOAD_TOO_LARGE}), 413

        filename = file.filename or "floorplan"

        # ── PDF path ───────────────────────────────────────────────────
        if is_pdf(content_type) or filename.lower().endswith(".pdf"):
            try:
                page_images = pdf_to_images(
                    file_bytes, max_pages=Limits.MAX_PDF_PAGES,
                    max_side_px=Limits.MAX_PDF_PAGE_SIDE_PX)
            except TooManyPages:
                return jsonify({"error": Limits.TOO_MANY_PDF_PAGES}), 400
            except UnreadablePdf as exc:
                logger.info("Refused an unreadable PDF for market %s: %s", market_id, exc)
                return jsonify({"error": Limits.unreadable_pdf(filename)}), 400

            pages = []
            for i, page_bytes in enumerate(page_images):
                page_filename = f"{filename}_page_{i + 1}.png"
                gridfs_id = upload_image(page_bytes, page_filename, market_id)
                width, height = _get_image_dimensions(page_bytes)
                pages.append({
                    "gridfs_id": gridfs_id,
                    "width": width,
                    "height": height,
                })

            return jsonify({"pages": pages}), 201

        # ── Image path ─────────────────────────────────────────────────
        gridfs_id = upload_image(file_bytes, filename, market_id)
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
@login_required
def get_floorplan(gridfs_id: str):
    """Retrieve a floorplan image by its GridFS ObjectId.

    The image is read on the market it was uploaded for, by anyone the Read row lets in (any role
    on it), an archived market's too. To anyone else, and for an unknown image or one stored
    without a market, the image is not there: every refusal answers 404 "Image not found", so the
    answer never tells a stranger that an id names an image.
    """
    if image_refusal(gridfs_id, Actions.READ, edits=False):
        return jsonify({"error": "Image not found"}), 404

    image_data = get_image(gridfs_id)
    if image_data is None:
        return jsonify({"error": "Image not found"}), 404

    mimetype = _detect_mimetype(image_data)
    return send_file(io.BytesIO(image_data), mimetype=mimetype)


# ── DELETE /api/floorplans/<gridfs_id> ───────────────────────────────────────

@floorplans_bp.route("/<gridfs_id>", methods=["DELETE"])
@login_required
def delete_floorplan(gridfs_id: str):
    """Delete a floorplan image from GridFS.

    The caller must be an editor of the image's market, on a market that is not archived.
    """
    try:
        refusal = image_refusal(gridfs_id, Actions.CHANGE_SETUP, edits=True)
        if refusal:
            return refusal

        market_id = get_image_market_id(gridfs_id)
        success = delete_image(gridfs_id)
        if not success:
            return jsonify({"error": "Image not found"}), 404
        History.record(
            market_id, authenticated_email(), Actions.CHANGE_SETUP,
            kind=History.FLOORPLAN_IMAGE_DELETED, subject={"image_id": gridfs_id},
            detail=lambda: History.changes({"image_id": gridfs_id}, {"image_id": None}),
        )

        return jsonify({"message": "Image deleted successfully"}), 200

    except Exception as exc:
        logger.error(f"Error deleting floorplan {gridfs_id}: {exc}")
        logger.error(traceback.format_exc())
        return jsonify({"error": "Internal server error"}), 500
