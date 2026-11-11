"""Every bound a floorplan and the market's table types are held to when they are written, and an
Auto-Place request when it is asked, in one place (T272, extended by T257).

A floorplan reaches a market only by its own save (``POST /floorplans/save-to-market``), which judges
it here through ``prepared_plan``; the plan write keeps the stored floorplans and table types
whatever its body carries, so it has none to judge.

The bounds are the request's, never the stored model's: ``FloorplanObject`` and its parts in
``datatypes.py`` stay as loose as they were, since a constraint there would make a market already
holding a larger floorplan fail to read, the very fault these bounds close. For the same reason a
floorplan restated unchanged is not judged again ("restating is not a change", as the setup lock
and the assignment rules have it), so a market stored before the bounds keeps saving its plan.

``floorplan_refusal`` walks the floorplan's dump for its strings and numbers, so a field added to
the model later is bounded without a new line here; the list bounds are named one by one.

Auto-Place's request is not stored, but it holds an instance for as long as the placement takes, so
``placement_refusal`` bounds what it is asked to place and where: how many tables, how large each
is, how large the room and its aisles, and how much geometry, whose wall ordering is quadratic.
"""
import math
from typing import Any, Iterator, List, Mapping, Optional

from datatypes import (
    AisleConfigObject, BetaTableType, FloorplanObject, ObstacleZone, TableTypeObject, WallSegment,
)

MAX_FLOORPLANS_PER_MARKET = 20
MAX_WALLS = 100
MAX_OBSTACLES = 100
MAX_POLYGON_POINTS = 100
MAX_TABLE_TYPES = 50
MAX_PLACED_TABLES = 1_000
MAX_SECTIONS = 200
MAX_TEXT_LENGTH = 200
MAX_MAGNITUDE = 10_000_000
#: Vercel's functions refuse a request body over 4.5 MB before Flask sees it, so an upload is held
#: under that, with room for the form's own bytes.
MAX_UPLOAD_BYTES = 4_000_000
MAX_PDF_PAGES = 20

MAX_TABLES_TO_PLACE = 500
MIN_TABLE_SIDE_MM = 100
MAX_TABLE_SIDE_MM = 20_000
MAX_ROOM_SIDE_MM = 500_000
MAX_AISLE_MM = 10_000

TOO_MANY_FLOORPLANS = f"A market keeps at most {MAX_FLOORPLANS_PER_MARKET:,} floorplans."
TOO_MANY_TABLE_TYPES = f"A market keeps at most {MAX_TABLE_TYPES:,} table types."
TABLE_TYPE_SIDES_OUT_OF_RANGE = (
    f"A table type's width and depth must be between {MIN_TABLE_SIDE_MM:,} mm and "
    f"{MAX_TABLE_SIDE_MM:,} mm."
)
TABLE_TYPE_TEXT_TOO_LONG = f"A table type's name and id are at most {MAX_TEXT_LENGTH:,} characters."
UPLOAD_TOO_LARGE = f"This file is larger than {MAX_UPLOAD_BYTES // 1_000_000} MB."
TOO_MANY_PDF_PAGES = (
    f"This PDF has more than {MAX_PDF_PAGES} pages. Send the page with the plan on it."
)
TEXT_TOO_LONG = f"A floorplan's names and ids are at most {MAX_TEXT_LENGTH:,} characters."
UNBOUNDED_MEASUREMENT = (
    f"A floorplan's measurements must be finite numbers no larger than {MAX_MAGNITUDE:,}."
)

TOO_MANY_TABLES_TO_PLACE = f"Auto-Place places up to {MAX_TABLES_TO_PLACE:,} tables at a time."
TABLE_SIDES_OUT_OF_RANGE = (
    f"A table type's width and height must be between {MIN_TABLE_SIDE_MM:,} mm and "
    f"{MAX_TABLE_SIDE_MM:,} mm."
)
ROOM_TOO_LARGE = f"The room must be at most {MAX_ROOM_SIDE_MM // 1000:,} m on each side."
AISLES_OUT_OF_RANGE = (
    f"The wall buffer and table spacing must be between 0 and {MAX_AISLE_MM:,} mm."
)
TOO_MUCH_GEOMETRY_TO_PLACE = (
    f"Auto-Place takes up to {MAX_WALLS:,} walls, {MAX_OBSTACLES:,} obstacle zones and "
    f"{MAX_POLYGON_POINTS:,} points in each."
)


def _holds_at_most(bound: int, what: str) -> str:
    return f"A floorplan holds at most {bound:,} {what}."


def _leaves(value: Any) -> Iterator[Any]:
    """Every string, number and other scalar in a dumped model, however deeply nested."""
    if isinstance(value, dict):
        for item in value.values():
            yield from _leaves(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _leaves(item)
    else:
        yield value


def _is_unbounded(number: Any) -> bool:
    """Whether a number is not finite or larger than ``MAX_MAGNITUDE`` (a bool is not a measure)."""
    if isinstance(number, bool) or not isinstance(number, (int, float)):
        return False
    return not math.isfinite(number) or abs(number) > MAX_MAGNITUDE


def measurement_refusal(dumped: Any) -> Optional[str]:
    """The sentence for a dumped model holding a number that is not finite or too large, else None.

    ``NaN`` and ``Infinity`` pass Flask's JSON reader and a float field alike, and a market holding
    one is echoed back as bare tokens that are not JSON, so no browser can read it.
    """
    if any(_is_unbounded(leaf) for leaf in _leaves(dumped)):
        return UNBOUNDED_MEASUREMENT
    return None


def floorplan_refusal(floorplan: FloorplanObject) -> Optional[str]:
    """The sentence a floorplan over a bound is refused with, or None when it is within all."""
    counts = (
        (len(floorplan.tables), MAX_PLACED_TABLES, "tables"),
        (len(floorplan.zones), MAX_OBSTACLES, "no-table zones"),
        (len(floorplan.section_styles), MAX_SECTIONS, "section styles"),
        (len(floorplan.starting_counts), MAX_SECTIONS, "starting counts"),
    )
    for count, bound, what in counts:
        if count > bound:
            return _holds_at_most(bound, what)
    dumped = floorplan.model_dump()
    if any(isinstance(leaf, str) and len(leaf) > MAX_TEXT_LENGTH for leaf in _leaves(dumped)):
        return TEXT_TOO_LONG
    return measurement_refusal(dumped)


def changed_floorplans(
    proposed: List[FloorplanObject], stored: List[FloorplanObject],
) -> List[FloorplanObject]:
    """The proposed floorplans that are not, as models, one the market already holds.

    A floorplan holding ``NaN`` never equals its stored self, so it is always judged.
    """
    return [floorplan for floorplan in proposed if floorplan not in stored]


def floorplans_refusal(
    proposed: List[FloorplanObject], stored: List[FloorplanObject],
) -> Optional[str]:
    """The sentence a plan's floorplans are refused with, or None.

    The count is refused only when it grows past the bound, so a market that already holds more
    (the save once added a copy on every save) can still restate or replace its own; each floorplan
    that is not one the market already holds is held to ``floorplan_refusal``.
    """
    if len(proposed) > max(MAX_FLOORPLANS_PER_MARKET, len(stored)):
        return TOO_MANY_FLOORPLANS
    for floorplan in changed_floorplans(proposed, stored):
        refused = floorplan_refusal(floorplan)
        if refused:
            return refused
    return None


def table_types_refusal(table_types: List[TableTypeObject]) -> Optional[str]:
    """The sentence the market's table types are refused with, or None when they are within all:
    how many, each side's length, and every string and number by the same walk as a floorplan's."""
    if len(table_types) > MAX_TABLE_TYPES:
        return TOO_MANY_TABLE_TYPES
    dumped = [table_type.model_dump() for table_type in table_types]
    refused = measurement_refusal(dumped)
    if refused:
        return refused
    if any(isinstance(leaf, str) and len(leaf) > MAX_TEXT_LENGTH for leaf in _leaves(dumped)):
        return TABLE_TYPE_TEXT_TOO_LONG
    if any(
        not MIN_TABLE_SIDE_MM <= side <= MAX_TABLE_SIDE_MM
        for table_type in table_types for side in (table_type.width_mm, table_type.depth_mm)
    ):
        return TABLE_TYPE_SIDES_OUT_OF_RANGE
    return None


def tables_to_place(table_types: List[BetaTableType], counts: Mapping[str, int]) -> int:
    """How many tables Auto-Place is asked for: each type's count, and one of a type it names none
    for, as the placement service reads them; a count for a type not listed places nothing."""
    return sum(counts.get(table_type.id, 1) for table_type in table_types)


def placement_refusal(
    *,
    walls: List[WallSegment],
    obstacles: List[ObstacleZone],
    table_types: List[BetaTableType],
    counts: Mapping[str, int],
    room_mm: Optional[Mapping[str, float]],
    aisle: Optional[AisleConfigObject],
) -> Optional[str]:
    """The sentence an Auto-Place request over a bound is refused with, or None.

    The geometry is walked for numbers that are not finite or too large first, since no other bound
    can be read on them; the room the walls enclose is bounded by the placement service, which is
    where that room is built.
    """
    geometry = [item.model_dump() for item in (*walls, *obstacles, *table_types)]
    if aisle is not None:
        geometry.append(aisle.model_dump())
    refused = measurement_refusal(geometry)
    if refused:
        return refused
    if (
        len(walls) > MAX_WALLS
        or len(obstacles) > MAX_OBSTACLES
        or any(len(zone.polygon) > MAX_POLYGON_POINTS for zone in obstacles)
    ):
        return TOO_MUCH_GEOMETRY_TO_PLACE
    if tables_to_place(table_types, counts) > MAX_TABLES_TO_PLACE:
        return TOO_MANY_TABLES_TO_PLACE
    if any(
        not MIN_TABLE_SIDE_MM <= side <= MAX_TABLE_SIDE_MM
        for table_type in table_types for side in (table_type.width_mm, table_type.height_mm)
    ):
        return TABLE_SIDES_OUT_OF_RANGE
    if room_mm is not None and max(room_mm["width_mm"], room_mm["height_mm"]) > MAX_ROOM_SIDE_MM:
        return ROOM_TOO_LARGE
    if aisle is not None and any(
        not 0 <= value <= MAX_AISLE_MM for value in (aisle.wall_buffer_mm, aisle.table_spacing_mm)
    ):
        return AISLES_OUT_OF_RANGE
    return None
