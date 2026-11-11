"""
Floorplan table auto-placement endpoint.

Receives the market it places for, room geometry (walls, obstacles), table
specifications, and aisle-configuration; returns a list of placed-table positions with x, y,
rotation in millimetre coordinates, and whether the placement ran out of time before the rest.

The body is parsed into ``PlaceTablesRequest`` and held to ``floorplan_limits``' bounds before the
placement runs, so a malformed field or a request too large to place in time is refused with its
sentence (T272).
"""

import logging
from typing import Annotated, Dict, List, Optional

from flask import Blueprint, request, jsonify
from flask_login import login_required
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from api.floorplans_access import market_refusal
import api.market_actions as Actions
from client_errors import BadRequestError, field_named_copy, parse_failure_detail
from datatypes import AisleConfigContract, ObstacleZone, TableTypeObject, WallSegment
from floorplan_limits import placement_refusal
from services.placement_service import auto_place_tables
from utils.request_body import string_field

logger = logging.getLogger(__name__)

floorplans_placement_bp = Blueprint("floorplans_placement", __name__)

NO_ROOM_SIZE = (
    "The floor plan's size is needed to place tables: calibrate it first, or draw its walls."
)

_Measure = Annotated[float, Field(strict=True)]


class RoomSize(BaseModel):
    """The floor plan's extent in millimetres: the room when no walls are drawn (bug 38)."""

    model_config = ConfigDict(allow_inf_nan=False)

    width_mm: Annotated[float, Field(strict=True, gt=0)]
    height_mm: Annotated[float, Field(strict=True, gt=0)]


class PlaceTablesRequest(BaseModel):
    """Auto-Place's body, in the wire shape ``AutoPlaceButton.vue`` sends: snake case, but for
    ``aisle_config``'s camel-cased keys. ``market_id`` is read before it, for the access check.

    Its own numbers must be finite; the nested geometry's are judged by ``placement_refusal``,
    since its models are the stored ones, which stay as loose as they were.
    """

    model_config = ConfigDict(allow_inf_nan=False)

    walls: List[WallSegment]
    obstacles: List[ObstacleZone]
    table_types: List[TableTypeObject]
    counts: Dict[str, Annotated[int, Field(strict=True, ge=0)]]
    scale_px_per_mm: _Measure
    room_mm: Optional[RoomSize] = None
    aisle_config: Optional[AisleConfigContract] = None


def _parsed_request(data, market_id: str) -> PlaceTablesRequest:
    try:
        return PlaceTablesRequest.model_validate(data)
    except ValidationError as e:
        logger.warning(
            "Refused a placement request for market %s: %s", market_id, parse_failure_detail(e),
        )
        raise BadRequestError(field_named_copy("Invalid placement request", e)) from e


# ── POST /api/floorplans/place-tables ──────────────────────────────────────────

@floorplans_placement_bp.route("/place-tables", methods=["POST"])
@login_required
def place_tables():
    """Auto-place rectangular tables into the room boundary.

    Places only for an editor of the market named, on a market that is not archived.

    **Request body** (JSON)::

        {
            "market_id": "...",
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
            "room_mm": {"width_mm": 55000, "height_mm": 41000},
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
            ],
            "timed_out": false
        }

    ``timed_out`` is true when the grid placement stopped at its deadline before placing them all.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be valid JSON"}), 400

    market_id = string_field(data, "market_id")
    refusal = market_refusal(market_id, Actions.CHANGE_SETUP, edits=True)
    if refusal:
        return refusal

    asked = _parsed_request(data, market_id)
    if not asked.walls and asked.room_mm is None:
        raise BadRequestError(NO_ROOM_SIZE)
    refused = placement_refusal(
        walls=asked.walls,
        obstacles=asked.obstacles,
        table_types=asked.table_types,
        counts=asked.counts,
        room_mm=asked.room_mm.model_dump() if asked.room_mm else None,
        aisle=asked.aisle_config,
    )
    if refused:
        raise BadRequestError(refused)

    # The service takes the stored types' dumps: snake case, so the organizer's aisle values are
    # the ones it reads (it read the wizard's camel-cased keys as unknown, and kept its defaults).
    result = auto_place_tables(
        walls=[wall.model_dump() for wall in asked.walls],
        obstacles=[zone.model_dump() for zone in asked.obstacles],
        table_types=[table_type.model_dump() for table_type in asked.table_types],
        counts=asked.counts,
        scale_px_per_mm=asked.scale_px_per_mm,
        aisle_config=asked.aisle_config.model_dump() if asked.aisle_config else None,
        room_mm=asked.room_mm.model_dump() if asked.room_mm else None,
    )

    return jsonify({"placed_tables": result.placed, "timed_out": result.timed_out}), 200
