"""
PDF-to-image conversion utility using pdf2image.
Renders each PDF page as a PNG byte string.
"""

import io
import logging
from typing import List

from pdf2image import convert_from_bytes

logger = logging.getLogger(__name__)


def pdf_to_images(pdf_bytes: bytes, dpi: int = 200) -> List[bytes]:
    """Convert PDF bytes to a list of PNG image bytes (one per page).

    Args:
        pdf_bytes: Raw PDF file content as bytes.
        dpi: Output image DPI (default: 200). Higher values yield larger, sharper images.

    Returns:
        List of PNG bytes, one element per page. Returns an empty list if
        conversion fails (graceful degradation).
    """
    if not pdf_bytes:
        logger.warning("pdf_to_images called with empty bytes")
        return []

    try:
        images = convert_from_bytes(pdf_bytes, dpi=dpi)
    except Exception as e:
        logger.error(f"Failed to convert PDF to images: {e}")
        return []

    result: List[bytes] = []
    for i, image in enumerate(images):
        try:
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            buf.seek(0)
            result.append(buf.getvalue())
        except Exception as e:
            logger.warning(f"Failed to encode page {i + 1} as PNG: {e}")
            continue

    if not result:
        logger.warning("pdf_to_images produced zero valid page images")

    return result


def is_pdf(content_type: str) -> bool:
    """Check whether a Content-Type header value indicates a PDF.

    Args:
        content_type: The Content-Type string (e.g. 'application/pdf').

    Returns:
        True if the content type matches 'application/pdf' or any of its
        common variants (case-insensitive).
    """
    if not content_type:
        return False

    normalized = content_type.strip().lower()
    return normalized == "application/pdf" or normalized.endswith("/pdf")
