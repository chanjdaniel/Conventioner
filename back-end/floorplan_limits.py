"""Every bound a floorplan is held to when it is written, in one place (T272).

A floorplan reaches a market by two writes, the wizard's save and the plan write, which carries the
stored floorplans back as Market Setup read them; both judge it here, through ``prepared_plan``.

The bounds are the request's, never the stored model's: ``FloorplanObject`` and its parts in
``datatypes.py`` stay as loose as they were, since a constraint there would make a market already
holding a larger floorplan fail to read, the very fault these bounds close. For the same reason a
floorplan restated unchanged is not judged again ("restating is not a change", as the setup lock
and the assignment rules have it), so a market stored before the bounds keeps saving its plan.

``floorplan_refusal`` walks the floorplan's dump for its strings and numbers, so a field added to
the model later is bounded without a new line here; the list bounds are named one by one.
"""
import math
from typing import Any, Iterator, List, Optional

from datatypes import FloorplanObject

MAX_FLOORPLANS_PER_MARKET = 20
MAX_WALLS = 100
MAX_OBSTACLES = 100
MAX_POLYGON_POINTS = 100
MAX_TABLE_TYPES = 50
MAX_PLACED_TABLES = 1_000
MAX_SECTIONS = 200
MAX_TABLES_PER_SECTION = 1_000
MAX_TEXT_LENGTH = 200
MAX_MAGNITUDE = 10_000_000

TOO_MANY_FLOORPLANS = f"A market keeps at most {MAX_FLOORPLANS_PER_MARKET:,} floorplans."
TEXT_TOO_LONG = f"A floorplan's names and ids are at most {MAX_TEXT_LENGTH:,} characters."
UNBOUNDED_MEASUREMENT = (
    f"A floorplan's measurements must be finite numbers no larger than {MAX_MAGNITUDE:,}."
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
        (len(floorplan.walls), MAX_WALLS, "walls"),
        (len(floorplan.obstacles), MAX_OBSTACLES, "no-go zones"),
        (max((len(zone.polygon) for zone in floorplan.obstacles), default=0),
         MAX_POLYGON_POINTS, "points in a no-go zone"),
        (len(floorplan.table_types), MAX_TABLE_TYPES, "table types"),
        (len(floorplan.placed_tables), MAX_PLACED_TABLES, "tables"),
        (len(floorplan.sections), MAX_SECTIONS, "sections"),
        (max((len(section.table_ids) for section in floorplan.sections), default=0),
         MAX_TABLES_PER_SECTION, "tables in a section"),
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
