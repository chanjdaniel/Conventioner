"""A location's layout, judged (T257): pure functions over a plan and its floorplans.

A layout is a floorplan (``setupObject.floorplans``, one per location): the venue's image, its
scale and the tables over it, each a real table of the plan, of a section and a table type, with
its number. The word "layout" is what an organizer reads; the code and the routes say floorplan.

- ``derive_counts``: a laid-out location's sections count its tables, so the solver and every
  reader read true counts; ``prepared_plan`` runs it on every write of the plan.
- ``tables_in_no_section``: the tables of a layout no section counts, which keep a market in draft
  (``guards.LayoutTablesHaveSectionsGuard``).
- ``in_its_sections``: a layout whose tables of a section not its location's are in none, as a
  save stores them.
- ``layout_refusal``: the rules a saved layout keeps (its location, its tables' ids, its numbering,
  its types, its tables inside the floorplan).
- ``layout_seats`` and ``settled_layout_refusal``: what of a layout settles on leaving draft, the
  seats and the types, while where a table stands stays editable until the market is archived.
- ``describe_change``: what a save changed, as the ``floorplan`` history entry records it.

Matched by id throughout: a table names its section and a floorplan its location by id, because
names change. Every other reader still matches sections and locations by name.
"""
from typing import Any, Dict, List, Optional, Tuple

from datatypes import FloorplanObject, FloorplanTable, SectionObject, SetupObject

UNKNOWN_LOCATION = "This layout's location is not one of the market's locations."
NUMBERING = "Each section's tables are numbered 1 to N."
TABLE_IDS = "Every table must have an id of its own."
UNKNOWN_TABLE_TYPE = "Every table must be of one of the market's table types."
OUTSIDE_THE_FLOORPLAN = "Every table must stand inside the floorplan."
NOT_CALIBRATED = "Set the floorplan's scale before placing tables on it."

#: How the history names a table of no section.
IN_NO_SECTION = "in no section"

#: Below these a table has not moved or turned: a drag let go where it began, a float's noise.
_MOVED_MM = 0.5
_TURNED_DEGREES = 0.01
#: How far past the floorplan's edge a centre may stand: the extent is a division of pixels by a
#: scale, so a table dropped on the edge can land a float's width beyond it.
_EDGE_MM = 0.5

#: One seat of a layout: a table, its section, its number and its type.
Seat = Tuple[str, Optional[str], Optional[int], str]


def _location_ids(plan: SetupObject) -> set:
    return {location.id for location in plan.locations}


def _sections_of(plan: SetupObject, location_id: str) -> List[SectionObject]:
    return [
        section for section in plan.sections
        if section.location is not None and section.location.id == location_id
    ]


def laid_out(plan: SetupObject) -> List[FloorplanObject]:
    """The plan's floorplans that are a layout of one of its locations: not a beta floorplan of
    no location, nor one whose location is gone."""
    locations = _location_ids(plan)
    return [floorplan for floorplan in plan.floorplans or [] if floorplan.location_id in locations]


def derive_counts(plan: SetupObject) -> SetupObject:
    """The plan with every section of a laid-out location counting that layout's tables in it.

    A section of a location with no layout keeps the count typed on Section Setup. A table naming a
    section of another location, or none, counts for no section.
    """
    counts: Dict[str, int] = {}
    for floorplan in laid_out(plan):
        own = {section.id for section in _sections_of(plan, floorplan.location_id)}
        for section_id in own:
            counts.setdefault(section_id, 0)
        for table in floorplan.tables:
            if table.section_id in own:
                counts[table.section_id] += 1
    if not counts:
        return plan
    sections = [
        section.model_copy(update={"count": counts[section.id]}) if section.id in counts
        else section
        for section in plan.sections
    ]
    return plan.model_copy(update={"sections": sections})


def tables_in_no_section(floorplan: FloorplanObject, plan: SetupObject) -> List[FloorplanTable]:
    """A layout's tables that are in no section: of none, of one that is gone, or of another
    location's. They count for no section (``derive_counts``), so no vendor can be placed at them.
    """
    own = {section.id for section in _sections_of(plan, floorplan.location_id)}
    return [table for table in floorplan.tables if table.section_id not in own]


def in_its_sections(floorplan: FloorplanObject, plan: SetupObject) -> FloorplanObject:
    """The layout with every table naming a section that is not one of its location's (one removed
    on Section Setup, or another location's) in no section and of no number, as a save stores it,
    so a number is never kept by a table no section counts."""
    own = {section.id for section in _sections_of(plan, floorplan.location_id)}
    if all(table.section_id is None or table.section_id in own for table in floorplan.tables):
        return floorplan
    return floorplan.model_copy(update={"tables": [
        table if table.section_id is None or table.section_id in own
        else table.model_copy(update={"section_id": None, "number": None})
        for table in floorplan.tables
    ]})


def _extent_mm(floorplan: FloorplanObject) -> Optional[Tuple[float, float]]:
    """The floorplan image's width and depth in millimetres, or None before it has a scale."""
    if not floorplan.image_width or not floorplan.image_height or not floorplan.scale_px_per_unit:
        return None
    return (floorplan.image_width / floorplan.scale_px_per_unit,
            floorplan.image_height / floorplan.scale_px_per_unit)


def _numbered_1_to_n(tables: List[FloorplanTable]) -> bool:
    by_section: Dict[str, List[Optional[int]]] = {}
    for table in tables:
        if table.section_id is None:
            if table.number is not None:
                return False
            continue
        by_section.setdefault(table.section_id, []).append(table.number)
    return all(
        sorted(numbers, key=lambda n: (n is None, n)) == list(range(1, len(numbers) + 1))
        for numbers in by_section.values()
    )


def layout_refusal(floorplan: FloorplanObject, plan: SetupObject) -> Optional[str]:
    """The sentence a layout is refused with, or None when it keeps every rule.

    Its location is one of the plan's; no two tables share an id; each section's tables are numbered
    1 to N, and a table of no section has no number; every table is of one of the market's types; and every table's centre
    stands inside the floorplan, which therefore needs its scale once it holds a table.
    """
    if floorplan.location_id not in _location_ids(plan):
        return UNKNOWN_LOCATION
    if len({table.id for table in floorplan.tables}) != len(floorplan.tables):
        return TABLE_IDS
    if not _numbered_1_to_n(floorplan.tables):
        return NUMBERING
    types = {table_type.id for table_type in plan.table_types}
    if any(table.table_type_id not in types for table in floorplan.tables):
        return UNKNOWN_TABLE_TYPE
    if not floorplan.tables:
        return None
    extent = _extent_mm(floorplan)
    if extent is None:
        return NOT_CALIBRATED
    width, depth = extent
    if any(not (-_EDGE_MM <= table.x_mm <= width + _EDGE_MM
                and -_EDGE_MM <= table.y_mm <= depth + _EDGE_MM)
           for table in floorplan.tables):
        return OUTSIDE_THE_FLOORPLAN
    return None


def _seat_order(seat: Seat) -> Tuple[str, str, int, str]:
    table_id, section_id, number, table_type_id = seat
    return table_id, section_id or "", -1 if number is None else number, table_type_id


def layout_seats(floorplan: FloorplanObject) -> Tuple[Optional[str], Tuple[Seat, ...]]:
    """A layout's seats, with the location they stand in: what of it settles on leaving draft.

    Each table's id, section, number and type, in one order whatever the tables' and every one
    kept, so a table repeated under an id is a seat more; never where it stands or how it is
    turned, which stay editable until the market is archived.
    """
    return floorplan.location_id, tuple(sorted(
        ((table.id, table.section_id, table.number, table.table_type_id)
         for table in floorplan.tables),
        key=_seat_order,
    ))


def settled_part(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """What of a plan's layouts settles on leaving draft, in one comparable shape: every
    floorplan's seats by its id, and the market's table types by theirs, so restating them in
    another order is not a change."""
    if plan is None:
        return {"floorplans": {}, "table_types": {}}
    return {
        "floorplans": {floorplan.id: layout_seats(floorplan) for floorplan in plan.floorplans or []},
        "table_types": {table_type.id: table_type.model_dump() for table_type in plan.table_types},
    }


def settled_layout_refusal(
    stored: Optional[SetupObject], proposed: SetupObject, settled: str,
) -> Optional[str]:
    """``settled``, the setup-settled sentence, when the proposed plan changes a seat, a table type
    or the set of layouts the stored one holds; else None, so a table moved or turned saves."""
    if settled_part(stored) != settled_part(proposed):
        return settled
    return None


def _section_name(plan: SetupObject, section_id: Optional[str]) -> str:
    for section in plan.sections:
        if section.id == section_id:
            return section.name
    return IN_NO_SECTION


def _per_section(plan: SetupObject, tables: List[FloorplanTable]) -> Dict[str, int]:
    counted: Dict[str, int] = {}
    for table in tables:
        name = _section_name(plan, table.section_id)
        counted[name] = counted.get(name, 0) + 1
    return counted


def _metres_across(floorplan: Optional[FloorplanObject]) -> Optional[float]:
    """The floorplan's width in metres, to the millimetre, so a recalibration by a few centimetres
    is recorded; None before it has a scale."""
    extent = _extent_mm(floorplan) if floorplan is not None else None
    return round(extent[0] / 1000, 3) if extent else None


def _turned_by(before: float, after: float) -> float:
    """How far a table turned, the short way round: 359.999 to 0 is a thousandth of a degree."""
    turn = abs(before - after) % 360
    return min(turn, 360 - turn)


def describe_change(
    before: Optional[FloorplanObject], after: FloorplanObject, plan: SetupObject,
) -> Dict[str, Any]:
    """What a save of a layout changed, as its ``floorplan`` history entry records it, sections
    named as ``plan`` names them; empty when it changed nothing.

    ``started`` on a layout's first save; ``added`` and ``removed``, tables counted per section
    name (a table that changed section left one and joined the other, a section the plan no longer
    has reading as none); ``moved``, ``turned`` and
    ``retyped`` (given another table type), how many tables; ``renumbered``, the sections whose tables kept their section and changed
    number; ``zones``, how many were added, changed and removed; ``image``, ``"replaced"``;
    ``scale``, the floorplan's metres across before and after, to the millimetre; ``colours`` and ``labels``, the
    sections whose colour or label changed. Never a table itself: the entry is fetched with the
    market's history.
    """
    change: Dict[str, Any] = {}
    if before is None:
        change["started"] = True
    was = {table.id: table for table in (before.tables if before else [])}
    now = {table.id: table for table in after.tables}
    known = {section.id for section in plan.sections}

    def section_of(table: FloorplanTable) -> Optional[str]:
        """A table's section, None when it names none or one the plan no longer has: a table of
        a section removed on Section Setup was in no section already, so the save that stores it
        so moved it nowhere."""
        return table.section_id if table.section_id in known else None

    left = [table for table_id, table in was.items()
            if table_id not in now or section_of(now[table_id]) != section_of(table)]
    joined = [table for table_id, table in now.items()
              if table_id not in was or section_of(was[table_id]) != section_of(table)]
    if joined:
        change["added"] = _per_section(plan, joined)
    if left:
        change["removed"] = _per_section(plan, left)

    kept = [(was[table_id], table) for table_id, table in now.items() if table_id in was]
    moved = sum(1 for old, new in kept
                if max(abs(old.x_mm - new.x_mm), abs(old.y_mm - new.y_mm)) >= _MOVED_MM)
    turned = sum(1 for old, new in kept
                 if _turned_by(old.rotation, new.rotation) >= _TURNED_DEGREES)
    retyped = sum(1 for old, new in kept if old.table_type_id != new.table_type_id)
    if moved:
        change["moved"] = moved
    if turned:
        change["turned"] = turned
    if retyped:
        change["retyped"] = retyped
    renumbered = sorted({
        _section_name(plan, new.section_id) for old, new in kept
        if old.section_id == new.section_id and old.number != new.number
    })
    if renumbered:
        change["renumbered"] = renumbered

    zones_was = {zone.id: zone for zone in (before.zones if before else [])}
    zones_now = {zone.id: zone for zone in after.zones}
    zones = {
        "added": sum(1 for zone_id in zones_now if zone_id not in zones_was),
        "changed": sum(1 for zone_id, zone in zones_now.items()
                       if zone_id in zones_was and zones_was[zone_id] != zone),
        "removed": sum(1 for zone_id in zones_was if zone_id not in zones_now),
    }
    if any(zones.values()):
        change["zones"] = zones

    if before is not None and before.image_gridfs_id and \
            before.image_gridfs_id != after.image_gridfs_id:
        change["image"] = "replaced"
    across_before, across_after = _metres_across(before), _metres_across(after)
    if across_before != across_after:
        change["scale"] = {"before": across_before, "after": across_after}

    styles_was = {style.section_id: style for style in (before.section_styles if before else [])}
    styles_now = {style.section_id: style for style in after.section_styles}
    styled = sorted(set(styles_was) | set(styles_now))
    colours = [section_id for section_id in styled
               if getattr(styles_was.get(section_id), "color", None)
               != getattr(styles_now.get(section_id), "color", None)]
    labels = [section_id for section_id in styled
              if getattr(styles_was.get(section_id), "label_at", None)
              != getattr(styles_now.get(section_id), "label_at", None)]
    if colours:
        change["colours"] = sorted(_section_name(plan, section_id) for section_id in colours)
    if labels:
        change["labels"] = sorted(_section_name(plan, section_id) for section_id in labels)
    return change
