"""
Floorplan AI Analysis API endpoints.
Uses Gemini 2.5 Flash (primary) and GPT-4o-mini (fallback) to detect
walls, obstacles, and room boundaries in floorplan images.
Output is structured JSON with normalized 0-1 coordinate space.
"""

import base64
import io
import json
import logging
import os

from flask import Blueprint, request, jsonify
from flask_login import login_required
from PIL import Image as PILImage

from services.gridfs_service import get_image

logger = logging.getLogger(__name__)

floorplans_analysis_bp = Blueprint("floorplans_analysis", __name__)

_SYSTEM_PROMPT = (
    "You are a floorplan analysis expert. Analyze this architectural floorplan image. "
    "Detect all walls as line segments, obstacles (pillars, columns, fixed furniture), "
    "and room boundaries. Output coordinates normalized to 0-1 range "
    "(x=0 is left edge, x=1 is right edge, y=0 is top edge, y=1 is bottom edge). "
    "Output ONLY valid JSON."
)

_OUTPUT_SCHEMA = """
Output JSON in this exact format:
{
  "walls": [
    {
      "start": [0.1, 0.2],
      "end": [0.9, 0.2],
      "thickness_mm": 150,
      "is_exterior": true
    }
  ],
  "obstacles": [
    {
      "polygon": [[0.3, 0.4], [0.35, 0.4], [0.35, 0.45], [0.3, 0.45]],
      "type": "pillar"
    }
  ],
  "rooms": [
    {
      "label": "main_hall",
      "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]
    }
  ]
}
"""

_FULL_PROMPT = _SYSTEM_PROMPT + "\n\n" + _OUTPUT_SCHEMA


def _get_mime_type(image_bytes: bytes) -> str:
    """Detect MIME type from image bytes using PIL. Falls back to image/png."""
    try:
        img = PILImage.open(io.BytesIO(image_bytes))
        fmt = img.format or "PNG"
        return f"image/{fmt.lower()}"
    except Exception:
        return "image/png"


def _parse_json_response(raw_text: str) -> dict:
    """Parse JSON from AI response, stripping markdown fences if present."""
    text = raw_text.strip()
    if text.startswith("```"):
        # Strip opening fence: ```json or ```
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        else:
            text = text[3:]
        # Strip closing fence
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    return json.loads(text)


def _call_gemini(image_bytes: bytes) -> dict:
    """Call Gemini 2.5 Flash with the floorplan image and return parsed JSON."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    mime_type = _get_mime_type(image_bytes)
    image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            _FULL_PROMPT,
            image_part,
        ],
    )

    return _parse_json_response(response.text)


def _call_openai(image_bytes: bytes) -> dict:
    """Call GPT-4o-mini with the floorplan image and return parsed JSON."""
    from openai import OpenAI

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    mime_type = _get_mime_type(image_bytes)
    base64_image = base64.b64encode(image_bytes).decode("utf-8")

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _FULL_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{base64_image}",
                        },
                    },
                ],
            }
        ],
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)


@floorplans_analysis_bp.route("/analyze", methods=["POST"])
@login_required
def analyze_floorplan():
    """Analyze a floorplan image using AI vision.

    Request body (JSON):
        { "gridfs_id": "<GridFS ObjectId string>" }

    Returns structured JSON with walls[], obstacles[], rooms[]
    in normalized 0-1 coordinate space.

    Primary: Gemini 2.5 Flash. Fallback: GPT-4o-mini.
    """
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "No JSON body provided"}), 400

        gridfs_id = data.get("gridfs_id")
        if not gridfs_id:
            return jsonify({"error": "gridfs_id is required"}), 400

        # Retrieve image bytes from GridFS
        image_bytes = get_image(gridfs_id)
        if image_bytes is None:
            return jsonify({"error": "Image not found"}), 404

        # Check API key availability
        gemini_key = os.environ.get("GEMINI_API_KEY")
        openai_key = os.environ.get("OPENAI_API_KEY")

        if not gemini_key and not openai_key:
            return jsonify({
                "error": (
                    "No AI API keys configured. "
                    "Set GEMINI_API_KEY and/or OPENAI_API_KEY environment variables."
                )
            }), 501

        # Try Gemini first (primary)
        if gemini_key:
            try:
                result = _call_gemini(image_bytes)
                return jsonify(result), 200
            except Exception as exc:
                logger.warning(
                    f"Gemini analysis failed: {exc}. Falling back to OpenAI."
                )

        # Fallback to OpenAI
        if openai_key:
            try:
                result = _call_openai(image_bytes)
                return jsonify(result), 200
            except Exception as exc:
                logger.error(f"OpenAI fallback also failed: {exc}")
                return jsonify({
                    "error": "AI analysis failed. Check server logs for details."
                }), 500

        # Should not be reachable due to the 501 check above
        return jsonify({"error": "No AI provider available"}), 500

    except Exception as exc:
        logger.error(f"Unexpected error in analyze_floorplan: {exc}")
        return jsonify({"error": "Internal server error"}), 500
