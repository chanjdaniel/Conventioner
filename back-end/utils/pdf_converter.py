"""
PDF-to-image conversion utility using pypdfium2.
Renders each PDF page as a PNG byte string.

pypdfium2's wheel carries PDFium itself, so a PDF is drawn with no system package. Production's
Vercel function installs only the Python requirements, which is why pdf2image cannot be used here:
it runs poppler's programs, and nothing installs poppler there.
"""

import io
import logging
import threading
from typing import List

import pypdfium2 as pdfium

logger = logging.getLogger(__name__)

# PDFium is not thread-safe, and a threaded server may convert two uploads at once.
_PDFIUM_LOCK = threading.Lock()

_POINTS_PER_INCH = 72


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
        result = _render_pages_as_png(pdf_bytes, dpi / _POINTS_PER_INCH)
    except Exception as e:
        logger.error(f"Failed to convert PDF to images: {e}")
        return []

    if not result:
        logger.warning("pdf_to_images produced zero valid page images")

    return result


def _render_pages_as_png(pdf_bytes: bytes, scale: float) -> List[bytes]:
    """Each page drawn on white at ``scale`` pixels per point, encoded as PNG while its bitmap is
    still open, since the PIL image shares the bitmap's memory. A page that will not encode is
    skipped, so the pages that do are kept."""
    with _PDFIUM_LOCK:
        document = pdfium.PdfDocument(pdf_bytes)
        try:
            result: List[bytes] = []
            for index in range(len(document)):
                page = document[index]
                try:
                    bitmap = page.render(scale=scale)
                    try:
                        buf = io.BytesIO()
                        bitmap.to_pil().save(buf, format="PNG")
                        result.append(buf.getvalue())
                    except Exception as e:
                        logger.warning(f"Failed to encode page {index + 1} as PNG: {e}")
                    finally:
                        bitmap.close()
                finally:
                    page.close()
            return result
        finally:
            document.close()


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
