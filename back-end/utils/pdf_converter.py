"""
PDF-to-image conversion utility using pypdfium2.
Renders each PDF page as a PNG byte string, no side over the caller's bound whatever the page's
size, and says why a PDF gave none: it could not be opened or drawn, or it has more pages than the
caller takes.

pypdfium2's wheel carries PDFium itself, so a PDF is drawn with no system package. Production's
Vercel function installs only the Python requirements, which is why pdf2image cannot be used here:
it runs poppler's programs, and nothing installs poppler there.
"""

import io
import logging
import threading
from typing import Any, List, Optional

import pypdfium2 as pdfium

logger = logging.getLogger(__name__)

# PDFium is not thread-safe, and a threaded server may convert two uploads at once.
_PDFIUM_LOCK = threading.Lock()

_POINTS_PER_INCH = 72


class UnreadablePdf(Exception):
    """The bytes are not a PDF PDFium can open, or it drew none of its pages."""


class TooManyPages(Exception):
    """The PDF has more pages than the caller takes; none was drawn."""


def pdf_to_images(
    pdf_bytes: bytes, dpi: int = 200, *, max_pages: Optional[int] = None,
    max_side_px: Optional[int] = None,
) -> List[bytes]:
    """Convert PDF bytes to a list of PNG image bytes (one per page).

    Args:
        pdf_bytes: Raw PDF file content as bytes.
        dpi: Output image DPI (default: 200). Higher values yield larger, sharper images.
        max_pages: The most pages taken; a longer PDF raises ``TooManyPages`` before any page is
            drawn, so its size costs nothing.
        max_side_px: The most pixels a drawn page's longer side holds: a page whose size at
            ``dpi`` would pass it is drawn smaller, so a page of any size asks PDFium for a bitmap
            of a bounded size.

    Returns:
        List of PNG bytes, one element per page.

    Raises:
        UnreadablePdf: PDFium cannot open the bytes, or no page could be drawn or encoded. It used to answer
            an empty list, which the route could read only as a server error (T257).
        TooManyPages: the PDF has more than ``max_pages`` pages.
    """
    if not pdf_bytes:
        raise UnreadablePdf("no bytes")
    result = _render_pages_as_png(pdf_bytes, dpi / _POINTS_PER_INCH, max_pages, max_side_px)
    if not result:
        raise UnreadablePdf("no page could be drawn")
    return result


def _page_scale(page: Any, scale: float, max_side_px: Optional[int]) -> float:
    """``scale``, lowered so the page's longer side is drawn in ``max_side_px`` pixels at most."""
    if max_side_px is None:
        return scale
    width, height = page.get_size()
    longer = max(width, height)
    if longer <= 0:
        return scale
    return min(scale, max_side_px / longer)


def _render_pages_as_png(
    pdf_bytes: bytes, scale: float, max_pages: Optional[int], max_side_px: Optional[int],
) -> List[bytes]:
    """Each page drawn on white at ``scale`` pixels per point, or smaller to keep within
    ``max_side_px``, encoded as PNG while its bitmap is still open, since the PIL image shares the
    bitmap's memory. A page that will not draw or encode is skipped, so the pages that do are
    kept."""
    with _PDFIUM_LOCK:
        try:
            document = pdfium.PdfDocument(pdf_bytes)
        except pdfium.PdfiumError as e:
            raise UnreadablePdf(str(e)) from e
        try:
            if max_pages is not None and len(document) > max_pages:
                raise TooManyPages(f"{len(document)} pages")
            result: List[bytes] = []
            for index in range(len(document)):
                page = document[index]
                try:
                    try:
                        bitmap = page.render(scale=_page_scale(page, scale, max_side_px))
                    except pdfium.PdfiumError as e:
                        logger.warning(f"Failed to draw page {index + 1}: {e}")
                        continue
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
