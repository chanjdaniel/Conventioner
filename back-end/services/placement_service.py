"""
Placement engine for auto-placing tables within a floorplan.

No Flask dependency - pure geometry logic using Shapely and pyckingsolver.
Works entirely in millimetre coordinates.

Two things are placed here. A whole room, as the floorplan beta's Auto-Place asked, which no screen
asks since the beta went (T257): the solver where it is installed, else the grid. And an area of a
layout (T257's Fill an area), a box or a drawn shape: rows of tables end to end with an aisle
between the rows (``_rows_place``), the same on every machine, since rows are what was asked for
and the solver packs none.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Dict, List, NamedTuple, Optional, Sequence, Tuple

import numpy as np
from shapely.geometry import Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union
from shapely.validation import make_valid
from shapely.prepared import prep

from client_errors import BadRequestError
from floorplan_limits import MAX_ROOM_SIDE_MM, ROOM_TOO_LARGE
from datatypes import (
    WallSegment,
    ObstacleZone,
    BetaTableType,
    AisleConfigObject,
)

logger = logging.getLogger(__name__)

# ── helpers ────────────────────────────────────────────────────────────────────

def _points_are_close(a: Tuple[float, float], b: Tuple[float, float], tol: float = 0.1) -> bool:
    """Return True when two 2-D points are within *tol* mm of each other."""
    return math.hypot(a[0] - b[0], a[1] - b[1]) <= tol


def _dedupe_vertices(
    vertices: List[Tuple[float, float]], tol: float = 0.1
) -> List[Tuple[float, float]]:
    """Remove near-duplicate vertices while preserving order."""
    out: List[Tuple[float, float]] = []
    for v in vertices:
        if not any(_points_are_close(v, existing, tol) for existing in out):
            out.append(v)
    return out


def _order_wall_vertices(
    walls: List[WallSegment], tol: float = 0.1
) -> Optional[List[Tuple[float, float]]]:
    """Try to order wall segment endpoints into a closed polygon loop.

    Returns ordered vertex list if walls form a closed chain, else ``None``.
    """
    if not walls:
        return None

    # Collect all directed edges
    edges: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
    all_verts: List[Tuple[float, float]] = []
    for w in walls:
        edges.append((w.start, w.end))
        all_verts.append(w.start)
        all_verts.append(w.end)

    # Build adjacency map: vertex → list of connected vertices
    adj: Dict[int, List[int]] = {}
    for i, vi in enumerate(all_verts):
        adj.setdefault(i, [])
        for j, vj in enumerate(all_verts):
            if i == j:
                continue
            # Check if vi–vj is a known wall edge
            for a, b in edges:
                if (_points_are_close(vi, a, tol) and _points_are_close(vj, b, tol)) or \
                   (_points_are_close(vi, b, tol) and _points_are_close(vj, a, tol)):
                    adj[i].append(j)

    if not adj:
        return None

    # Greedy chain: start from first vertex, follow adjacency
    visited: List[int] = [0]
    while len(visited) < len(all_verts):
        last = visited[-1]
        candidates = [n for n in adj.get(last, []) if n not in visited]
        if not candidates:
            break
        # Pick the closest unvisited neighbour
        candidates.sort(key=lambda n: math.hypot(
            all_verts[last][0] - all_verts[n][0],
            all_verts[last][1] - all_verts[n][1],
        ))
        visited.append(candidates[0])

    # Check if we can close the loop
    first = visited[0]
    last = visited[-1]
    if len(visited) >= 3:
        # See if last connects back to first
        closes = any(
            _points_are_close(all_verts[last], a, tol) and _points_are_close(all_verts[first], b, tol)
            for a, b in edges
        ) or any(
            _points_are_close(all_verts[last], b, tol) and _points_are_close(all_verts[first], a, tol)
            for a, b in edges
        )
        if closes:
            ordered = [all_verts[i] for i in visited]
            return ordered

    return None


# ── room polygon ───────────────────────────────────────────────────────────────

def _build_room_polygon(
    walls: List[WallSegment], room_mm: Optional[Dict[str, float]] = None,
) -> Polygon:
    """Build the room boundary polygon from wall segments, or from the floor plan's extent.

    Attempts to order vertices into a closed loop first; falls back to the
    convex hull of all wall endpoints when the segments don't form a clean
    closed chain.

    With no walls the room is the floor plan itself - the calibrated image, from its top-left corner,
    in millimetres - which is where the editor draws a table at (x_mm, y_mm). It was a fixed 10 m
    square centred on the origin whatever was uploaded, so a 55 m hall had a 49 m² placement zone and
    every table landed off the image, up and to the left of it (bug 38).
    """
    if not walls:
        if room_mm is None:
            # The route refuses a request with neither before it gets here, so this is a bug.
            raise ValueError("A room needs its walls or the floor plan's size.")
        return box(0, 0, room_mm["width_mm"], room_mm["height_mm"])

    all_points: List[Tuple[float, float]] = []
    for w in walls:
        all_points.append(w.start)
        all_points.append(w.end)

    # Try ordered chain first
    ordered = _order_wall_vertices(walls)
    if ordered and len(ordered) >= 3:
        # Deduplicate consecutive near-identical points
        deduped = _dedupe_vertices(ordered)
        if len(deduped) >= 3:
            try:
                poly = Polygon(deduped)
                if poly.is_valid and not poly.is_empty and poly.area > 0:
                    return poly
            except Exception:
                pass

    # Fallback: convex hull
    from shapely.geometry import MultiPoint
    hull = MultiPoint(all_points).convex_hull
    if isinstance(hull, Polygon) and not hull.is_empty:
        return hull

    # The walls enclose nothing: fall back to the floor plan's extent when it is known.
    if room_mm is not None:
        return box(0, 0, room_mm["width_mm"], room_mm["height_mm"])
    raise BadRequestError("The walls drawn do not enclose a room.")


# ── placement zone ─────────────────────────────────────────────────────────────

def _compute_placement_zone(
    room: Polygon,
    obstacles: List[ObstacleZone],
    wall_buffer_mm: float,
) -> Polygon:
    """Subtract obstacles and wall buffer from the room polygon.

    Returns a (possibly empty or multi-part) polygon representing the valid
    placement area for tables.
    """
    # Shrink room by wall buffer
    zone = room.buffer(-wall_buffer_mm)
    if zone.is_empty:
        logger.warning("Room polygon became empty after wall buffer of %.1f mm", wall_buffer_mm)
        return Polygon()

    # Ensure we have a Polygon (buffer on concave polygons can produce MultiPolygon)
    if zone.geom_type == "MultiPolygon":
        # Use the largest polygon (main room area)
        zone = max(zone.geoms, key=lambda g: g.area)
    if zone.geom_type != "Polygon":
        return Polygon()

    # Subtract each obstacle
    for obs in obstacles:
        try:
            obs_poly = Polygon(obs.polygon)
            if not obs_poly.is_empty and obs_poly.is_valid:
                zone = zone.difference(obs_poly)
        except Exception as exc:
            logger.warning("Skipping invalid obstacle %s: %s", obs.id, exc)

    if zone.is_empty:
        return Polygon()

    # Take largest polygon if multi-part
    if zone.geom_type == "MultiPolygon":
        zone = max(zone.geoms, key=lambda g: g.area)

    if zone.geom_type != "Polygon":
        return Polygon()

    return zone


# ── pyckingsolver primary path ─────────────────────────────────────────────────

#: How long the solver may search, in seconds. It is an anytime solver - it returns the best packing
#: found by then - so this is what bounds the request. The browser gives up at 30 s, and a limit
#: wrapped around the call from outside never stopped it: the old 30 s timeout raised in the caller
#: while the solver ran on (to its own 60 s default) and the request waited for it (bug 38).
SOLVER_TIME_LIMIT_S = 10.0


def _pyckingsolver_place(
    zone: Polygon,
    tables: List[BetaTableType],
    counts: Dict[str, int],
    spacing_mm: float,
    time_limit_s: float = SOLVER_TIME_LIMIT_S,
) -> List[Dict]:
    """Use pyckingsolver for optimal bin-packing of tables into *zone*.

    Raises an exception on failure so the caller can fall back to grid placement.
    """
    from pyckingsolver import nest, Objective, SolverParams

    # Build item list (one Shapely box per table instance) and metadata
    items: List[Polygon] = []
    meta: List[Dict] = []  # parallel to *items*

    for tt in tables:
        tt_id = tt.id
        count = counts.get(tt_id, 1)
        for _ in range(count):
            # pyckingsolver anchors items at their bottom-left origin
            items.append(box(0, 0, tt.width_mm, tt.height_mm))
            meta.append({
                "table_type_id": tt_id,
                "width_mm": tt.width_mm,
                "height_mm": tt.height_mm,
            })

    if not items:
        return []

    logger.info(
        "Running pyckingsolver with %d items in zone area %.0f mm²",
        len(items), zone.area,
    )

    result = nest(
        items=items,
        bins=[zone],
        objective=Objective.KNAPSACK,
        spacing=spacing_mm,
        allowed_rotations=[(0, 0), (90, 90)],  # 0° and 90° only
        group_identical=False,                  # 1:1 item-to-type mapping
        params=SolverParams(time_limit=time_limit_s),
    )
    if result is None:
        raise RuntimeError("pyckingsolver found no packing")

    placed: List[Dict] = []
    for item in result.all_items():
        shapes = result.placed_shapes(item)
        item_meta = meta[item.item_type_id]
        for shape in shapes:
            if shape.is_empty:
                continue
            centroid = shape.centroid
            placed.append({
                "x_mm": round(centroid.x, 2),
                "y_mm": round(centroid.y, 2),
                "rotation": round(item.angle, 2),
                "width_mm": item_meta["width_mm"],
                "height_mm": item_meta["height_mm"],
                "table_type_id": item_meta["table_type_id"],
            })

    logger.info("pyckingsolver placed %d / %d items", len(placed), len(items))
    return placed


# ── grid-based greedy fallback ─────────────────────────────────────────────────

#: How long the grid may search, in seconds; it stops there and answers what it has placed. With the
#: solver's own 10 s the two sum to 20 s, under the browser's 30 s, for when the solver runs out its
#: time and then fails. In production the solver's import fails at once, and the grid has all 10 s.
#: The grid had no deadline: 200 tables took 49 s to 85 s and ran on after the browser gave up (T272).
GRID_TIME_LIMIT_S = 10.0


def _grid_place(
    zone: Polygon,
    tables: List[BetaTableType],
    counts: Dict[str, int],
    spacing_mm: float,
    time_limit_s: float = GRID_TIME_LIMIT_S,
) -> Tuple[List[Dict], bool]:
    """Grid-based greedy placement: discretize the zone and place largest-first.

    Used as a fallback when pyckingsolver is unavailable or fails, which is always in production.
    Each table takes the first position that fits: columns left to right, rows top to bottom within
    a column, unrotated before rotated. A position fits when the table is inside the zone and more
    than *spacing_mm* from every table placed, which is the same rule as two tables' buffers by half
    the spacing not touching, without building a buffer's polygon for each position.

    Returns the placed tables and whether it stopped at *time_limit_s* before trying them all.
    """
    if zone.is_empty or zone.area <= 0:
        return [], False

    deadline = time.monotonic() + time_limit_s

    # Build flat list of table instances sorted by area (largest first)
    table_entries: List[BetaTableType] = []
    for tt in tables:
        count = counts.get(tt.id, 1)
        for _ in range(count):
            table_entries.append(tt)
    table_entries.sort(key=lambda t: -(t.width_mm * t.height_mm))

    if not table_entries:
        return [], False

    # Grid step: half of the smallest table dimension (ensures decent coverage)
    min_dim = min(
        min(t.width_mm, t.height_mm) for t in table_entries
    )
    grid_step = max(min_dim / 2, 50.0)  # at least 50 mm

    minx, miny, maxx, maxy = zone.bounds
    inside = prep(zone)

    placed: List[Dict] = []
    # The placed tables' rectangles, one row of (min x, min y, max x, max y) each: they are
    # axis-aligned, so a position's distance to all of them is a few array operations.
    placed_bounds = np.empty((0, 4))
    timed_out = False

    for tt in table_entries:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        best_pos: Optional[Tuple[float, float]] = None
        best_rot: bool = False  # True = 90° rotated

        for rotated in (False, True):
            cw = tt.height_mm if rotated else tt.width_mm
            ch = tt.width_mm if rotated else tt.height_mm

            for x in np.arange(minx, maxx - cw + grid_step, grid_step):
                if time.monotonic() >= deadline:
                    timed_out = True
                    break
                # Only the tables beside this column can be too close to a position in it.
                gap_x = np.maximum(
                    np.maximum(placed_bounds[:, 0] - (x + cw), x - placed_bounds[:, 2]), 0.0,
                )
                near = gap_x <= spacing_mm
                near_bounds, near_gap_x = placed_bounds[near], gap_x[near]

                for y in np.arange(miny, maxy - ch + grid_step, grid_step):
                    # Must be more than the spacing from every placed table: the cheap test first.
                    if len(near_bounds):
                        gap_y = np.maximum(
                            np.maximum(near_bounds[:, 1] - (y + ch), y - near_bounds[:, 3]), 0.0,
                        )
                        if np.any(np.hypot(near_gap_x, gap_y) <= spacing_mm):
                            continue

                    # Must be fully inside the placement zone
                    if not inside.contains(box(x, y, x + cw, y + ch)):
                        continue

                    best_pos = (x, y)
                    best_rot = rotated
                    break  # first valid spot wins for this rotation
                if best_pos:
                    break
            if best_pos or timed_out:
                break
        if timed_out:
            break

        if best_pos is None:
            continue  # couldn't place this table

        x, y = float(best_pos[0]), float(best_pos[1])
        cw = tt.height_mm if best_rot else tt.width_mm
        ch = tt.width_mm if best_rot else tt.height_mm

        placed_bounds = np.vstack([placed_bounds, [x, y, x + cw, y + ch]])
        placed.append({
            "x_mm": round(x + cw / 2, 2),
            "y_mm": round(y + ch / 2, 2),
            "rotation": 90.0 if best_rot else 0.0,
            "width_mm": tt.width_mm,
            "height_mm": tt.height_mm,
            "table_type_id": tt.id,
        })

    logger.info(
        "Grid fallback placed %d / %d tables%s", len(placed), len(table_entries),
        " before its time ran out" if timed_out else "",
    )
    return placed, timed_out


# ── an area, in rows ───────────────────────────────────────────────────────────

#: What a row's free stretch may fall short of a whole table by and still hold it, in millimetres:
#: the float error of the area's own corners, far under anything drawn.
_FIT_SLACK_MM = 1e-6


def _parts(geometry: BaseGeometry) -> List[BaseGeometry]:
    """A geometry's polygons, however many it is made of."""
    return list(getattr(geometry, "geoms", [geometry]))


def _free_stretches(zone: BaseGeometry, top: float, depth: float) -> List[Tuple[float, float]]:
    """Where a row *depth* deep with its top edge at *top* is clear of everything, left to right:
    the stretches of x over which the whole depth of the row is inside *zone*."""
    minx, _miny, maxx, _maxy = zone.bounds
    blocked = sorted(
        (part.bounds[0], part.bounds[2])
        for part in _parts(box(minx, top, maxx, top + depth).difference(zone))
        if part.area > _FIT_SLACK_MM
    )
    stretches: List[Tuple[float, float]] = []
    at = minx
    for left, right in blocked:
        if left > at:
            stretches.append((at, left))
        at = max(at, right)
    if maxx > at:
        stretches.append((at, maxx))
    return stretches


def _swapped(geometry: BaseGeometry) -> BaseGeometry:
    """A geometry with its x and y exchanged: a column is a row of the hall seen sideways."""
    return transform(lambda x, y: (y, x), geometry)


def _area_zone(
    area: BaseGeometry,
    room: Polygon,
    obstacles: List[ObstacleZone],
    existing: Sequence[Sequence[Tuple[float, float]]],
    spacing_mm: float,
) -> BaseGeometry:
    """Where an area may take tables: the part of it on the floorplan, less the no-table zones and
    the tables already placed, each of those grown by the aisle. Every piece of it is kept: an
    area cut in two by a zone is filled on both sides."""
    # An obstacle of fewer than three points is no shape and takes no floor; one whose sides cross
    # is mended, so the floor it covers stays clear.
    taken = [make_valid(Polygon(zone.polygon)) for zone in obstacles if len(zone.polygon) >= 3]
    taken += [
        make_valid(Polygon(corners)).buffer(spacing_mm, join_style="mitre") for corners in existing
    ]
    zone = area.intersection(room)
    usable = [shape for shape in taken if not shape.is_empty]
    return zone.difference(unary_union(usable)) if usable else zone


def _rows_place(
    zone: BaseGeometry,
    tables: List[BetaTableType],
    counts: Dict[str, int],
    spacing_mm: float,
    direction: str,
    deadline: float,
) -> Tuple[List[Dict], bool]:
    """Fill *zone* with rows of tables: each row's tables end to end, touching, from the left of
    every stretch of the row that is clear, and the rows *spacing_mm* apart, from the zone's top.
    ``across`` rows run across the page, their tables unturned; ``down`` rows run down it, from the
    zone's left, their tables turned a quarter. The answer is in the order placed: row by row, each
    from its start.

    A type's tables are placed whole before the next type's, which keep the aisle from them.
    Returns the placed tables and whether it stopped at *deadline*, a ``time.monotonic()`` reading,
    before the rest.
    """
    down = direction == "down"
    if down:
        zone = _swapped(zone)
    placed: List[Dict] = []

    for table_type in tables:
        wanted = counts.get(table_type.id, 1)
        if zone.is_empty or zone.area <= 0:
            break
        width, depth = table_type.width_mm, table_type.height_mm
        _minx, miny, _maxx, maxy = zone.bounds
        mine: List[Polygon] = []
        top = miny
        while len(mine) < wanted and top + depth <= maxy + _FIT_SLACK_MM:
            if time.monotonic() >= deadline:
                return placed, True
            for left, right in _free_stretches(zone, top, depth):
                fit = int((right - left + _FIT_SLACK_MM) // width)
                for nth in range(min(fit, wanted - len(mine))):
                    x = left + nth * width
                    mine.append(box(x, top, x + width, top + depth))
                    centre = (x + width / 2, top + depth / 2)
                    placed.append({
                        "x_mm": round(centre[1] if down else centre[0], 2),
                        "y_mm": round(centre[0] if down else centre[1], 2),
                        "rotation": 90.0 if down else 0.0,
                        "width_mm": table_type.width_mm,
                        "height_mm": table_type.height_mm,
                        "table_type_id": table_type.id,
                    })
                if len(mine) >= wanted:
                    break
            top += depth + spacing_mm
        if mine:
            zone = zone.difference(unary_union(mine).buffer(spacing_mm, join_style="mitre"))

    logger.info("Rows placed %d tables in the area", len(placed))
    return placed, False


# ── public entry point ─────────────────────────────────────────────────────────

class PlacementResult(NamedTuple):
    """What Auto-Place placed, and whether it stopped for time before placing the rest."""

    #: The placed tables, each a dict of ``x_mm``, ``y_mm`` (its centre), ``rotation``,
    #: ``width_mm``, ``height_mm`` and ``table_type_id``.
    placed: List[Dict]
    #: True only when the grid, or an area's rows, stopped at the deadline. The solver's anytime
    #: answer is its best packing and does not say whether it stopped for time, so it is never
    #: reported as timed out.
    timed_out: bool


def auto_place_tables(
    walls: List[Dict],
    obstacles: List[Dict],
    table_types: List[Dict],
    counts: Dict[str, int],
    scale_px_per_mm: float,
    aisle_config: Optional[Dict] = None,
    room_mm: Optional[Dict[str, float]] = None,
    area_mm: Optional[Sequence[float]] = None,
    area_polygon_mm: Optional[Sequence[Sequence[float]]] = None,
    existing_mm: Sequence[Sequence[Sequence[float]]] = (),
    direction: str = "across",
) -> PlacementResult:
    """Auto-place rectangular tables inside the room boundary, or inside an area of it.

    Parameters
    ----------
    walls:
        List of wall dicts with keys ``start``, ``end``, ``thickness_mm``,
        ``is_exterior`` (see :class:`WallSegment`).
    obstacles:
        List of obstacle dicts with keys ``polygon``, ``type``
        (see :class:`ObstacleZone`).
    table_types:
        List of table-type dicts with keys ``id``, ``width_mm``, ``height_mm``
        (see :class:`BetaTableType`).
    counts:
        Mapping ``table_type_id → quantity``.
    scale_px_per_mm:
        Pixel-to-mm conversion factor (unused by the engine; kept for API
        consistency, all geometry is in mm).
    aisle_config:
        Optional dict with ``wall_buffer_mm`` and ``table_spacing_mm`` keys
        (see :class:`AisleConfigObject`).  Defaults to 1500 mm wall buffer
        and 1200 mm table spacing.
    room_mm:
        The floor plan's extent, ``width_mm`` by ``height_mm`` from its top-left corner: the room
        when no walls are drawn. Required then; there is no default room.
    area_mm, area_polygon_mm:
        An area to fill, one or the other: a box, ``[x, y, width, depth]``, or a drawn shape's
        corners, ``[[x, y], ...]``. With an area the room is ``room_mm`` whatever walls are sent,
        the wall buffer is not read, and the tables stand in rows (``_rows_place``), clear of the
        obstacles and ``table_spacing_mm`` clear of every table of ``existing_mm``.
    existing_mm:
        The tables already placed, each its four corners as it stands turned. Read with an area.
    direction:
        ``across`` or ``down``: which way an area's rows run.

    Returns
    -------
    A :class:`PlacementResult`: the placed-table dicts, each with ``x_mm``, ``y_mm``,
    ``rotation``, ``width_mm``, ``height_mm`` and ``table_type_id``, and ``timed_out``, true when
    the grid stopped at ``GRID_TIME_LIMIT_S`` before trying every table.
    """
    # ── build domain objects ──────────────────────────────────────────────
    wall_objects = [WallSegment(**w) for w in walls]
    obstacle_objects = [ObstacleZone(**o) for o in obstacles]
    table_objects = [BetaTableType(**t) for t in table_types]

    # ── aisle config defaults ─────────────────────────────────────────────
    if aisle_config:
        aisle = AisleConfigObject(**aisle_config)
    else:
        aisle = AisleConfigObject()

    wall_buffer = aisle.wall_buffer_mm
    table_spacing = aisle.table_spacing_mm

    # ── an area of the floorplan, in rows ─────────────────────────────────
    if area_mm is not None or area_polygon_mm is not None:
        if room_mm is None:
            # The route refuses an area with no floorplan size before it gets here.
            raise ValueError("An area needs the floor plan's size.")
        # The time the zone takes to build is the fill's too.
        deadline = time.monotonic() + GRID_TIME_LIMIT_S
        if area_mm is not None:
            x, y, width, depth = area_mm
            area: BaseGeometry = box(x, y, x + width, y + depth)
        else:
            area = Polygon(area_polygon_mm)
        zone = _area_zone(
            area, _build_room_polygon([], room_mm), obstacle_objects, existing_mm, table_spacing,
        )
        placed, timed_out = _rows_place(
            zone, table_objects, counts, table_spacing, direction, deadline,
        )
        return PlacementResult(placed=placed, timed_out=timed_out)

    # ── geometry prep ─────────────────────────────────────────────────────
    room = _build_room_polygon(wall_objects, room_mm)
    minx, miny, maxx, maxy = room.bounds
    if max(maxx - minx, maxy - miny) > MAX_ROOM_SIDE_MM:
        # The request's own room size is bounded before this; walls drawn far apart are bounded here.
        raise BadRequestError(ROOM_TOO_LARGE)
    zone = _compute_placement_zone(room, obstacle_objects, wall_buffer)

    if zone.is_empty or zone.area <= 0:
        logger.warning("Placement zone is empty - returning 0 placed tables")
        return PlacementResult(placed=[], timed_out=False)

    # ── primary: pyckingsolver ────────────────────────────────────────────
    try:
        return PlacementResult(
            placed=_pyckingsolver_place(zone, table_objects, counts, table_spacing),
            timed_out=False,
        )
    except Exception as exc:
        logger.warning("pyckingsolver failed (%s), falling back to grid placement", exc)

    # ── fallback: grid-based greedy ───────────────────────────────────────
    try:
        placed, timed_out = _grid_place(
            zone, table_objects, counts, table_spacing, time_limit_s=GRID_TIME_LIMIT_S,
        )
    except Exception as exc:
        logger.error("Grid fallback also failed: %s", exc)
        return PlacementResult(placed=[], timed_out=False)
    return PlacementResult(placed=placed, timed_out=timed_out)
