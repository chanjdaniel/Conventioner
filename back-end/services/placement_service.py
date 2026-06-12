"""
Placement engine for auto-placing tables within a floorplan.

No Flask dependency — pure geometry logic using Shapely and pyckingsolver.
Works entirely in millimetre coordinates.
"""

from __future__ import annotations

import concurrent.futures
import logging
import math
from typing import Dict, List, Optional, Tuple

import numpy as np
from shapely import affinity
from shapely.geometry import Polygon, box, Point
from shapely.ops import unary_union

from datatypes import (
    WallSegment,
    ObstacleZone,
    TableTypeObject,
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

def _build_room_polygon(walls: List[WallSegment]) -> Polygon:
    """Build the room boundary polygon from wall segments.

    Attempts to order vertices into a closed loop first; falls back to the
    convex hull of all wall endpoints when the segments don't form a clean
    closed chain.
    """
    if not walls:
        # Default: 10×10 m room centred at origin
        return box(-5000, -5000, 5000, 5000)

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

    # Ultimate fallback
    return box(-5000, -5000, 5000, 5000)


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

def _pyckingsolver_place(
    zone: Polygon,
    tables: List[TableTypeObject],
    counts: Dict[str, int],
    spacing_mm: float,
    time_limit_s: float = 30.0,
) -> List[Dict]:
    """Use pyckingsolver for optimal bin-packing of tables into *zone*.

    Raises an exception on failure so the caller can fall back to grid placement.
    """
    from pyckingsolver import nest, Objective

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

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            nest,
            items=items,
            bins=[zone],
            objective=Objective.KNAPSACK,
            spacing=spacing_mm,
            allowed_rotations=[(0, 0), (90, 90)],  # 0° and 90° only
            group_identical=False,                  # 1:1 item-to-type mapping
        )
        try:
            result = future.result(timeout=time_limit_s)
        except concurrent.futures.TimeoutError:
            raise TimeoutError(
                f"pyckingsolver timed out after {time_limit_s}s"
            )

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

def _grid_place(
    zone: Polygon,
    tables: List[TableTypeObject],
    counts: Dict[str, int],
    spacing_mm: float,
) -> List[Dict]:
    """Grid-based greedy placement: discretize the zone and place largest-first.

    Used as a fallback when pyckingsolver is unavailable or times out.
    """
    if zone.is_empty or zone.area <= 0:
        return []

    # Build flat list of table instances sorted by area (largest first)
    table_entries: List[TableTypeObject] = []
    for tt in tables:
        count = counts.get(tt.id, 1)
        for _ in range(count):
            table_entries.append(tt)
    table_entries.sort(key=lambda t: -(t.width_mm * t.height_mm))

    if not table_entries:
        return []

    # Grid step: half of the smallest table dimension (ensures decent coverage)
    min_dim = min(
        min(t.width_mm, t.height_mm) for t in table_entries
    )
    grid_step = max(min_dim / 2, 50.0)  # at least 50 mm

    minx, miny, maxx, maxy = zone.bounds

    placed: List[Dict] = []
    placed_polys: List[Polygon] = []  # buffered placed shapes for overlap checks
    half_spacing = spacing_mm / 2.0

    for tt in table_entries:
        best_pos: Optional[Tuple[float, float]] = None
        best_rot: bool = False  # True = 90° rotated

        for rotated in (False, True):
            cw = tt.height_mm if rotated else tt.width_mm
            ch = tt.width_mm if rotated else tt.height_mm

            # Build list of candidate (x, y) positions
            for x in np.arange(minx, maxx - cw + grid_step, grid_step):
                for y in np.arange(miny, maxy - ch + grid_step, grid_step):
                    rect = box(x, y, x + cw, y + ch)

                    # Must be fully inside the placement zone
                    if not zone.contains(rect):
                        continue

                    # Must not overlap with already-placed tables (plus spacing)
                    buffered = rect.buffer(half_spacing)
                    if any(buffered.intersects(p) for p in placed_polys):
                        continue

                    best_pos = (x, y)
                    best_rot = rotated
                    break  # first valid spot wins for this rotation
                if best_pos:
                    break
            if best_pos:
                break

        if best_pos is None:
            continue  # couldn't place this table

        x, y = best_pos
        cw = tt.height_mm if best_rot else tt.width_mm
        ch = tt.width_mm if best_rot else tt.height_mm

        placed_rect = box(x, y, x + cw, y + ch)
        placed_polys.append(placed_rect.buffer(half_spacing))

        centroid = placed_rect.centroid
        placed.append({
            "x_mm": round(centroid.x, 2),
            "y_mm": round(centroid.y, 2),
            "rotation": 90.0 if best_rot else 0.0,
            "width_mm": tt.width_mm,
            "height_mm": tt.height_mm,
            "table_type_id": tt.id,
        })

    logger.info("Grid fallback placed %d / %d tables", len(placed), len(table_entries))
    return placed


# ── public entry point ─────────────────────────────────────────────────────────

def auto_place_tables(
    walls: List[Dict],
    obstacles: List[Dict],
    table_types: List[Dict],
    counts: Dict[str, int],
    scale_px_per_mm: float,
    aisle_config: Optional[Dict] = None,
) -> List[Dict]:
    """Auto-place rectangular tables inside the room boundary.

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
        (see :class:`TableTypeObject`).
    counts:
        Mapping ``table_type_id → quantity``.
    scale_px_per_mm:
        Pixel-to-mm conversion factor (unused by the engine; kept for API
        consistency, all geometry is in mm).
    aisle_config:
        Optional dict with ``wallBufferMm`` and ``tableSpacingMm`` keys
        (see :class:`AisleConfigObject`).  Defaults to 1500 mm wall buffer
        and 1200 mm table spacing.

    Returns
    -------
    List of placed-table dicts, each with:
        ``x_mm``, ``y_mm``, ``rotation``, ``width_mm``, ``height_mm``,
        ``table_type_id``.
    """
    # ── build domain objects ──────────────────────────────────────────────
    wall_objects = [WallSegment(**w) for w in walls]
    obstacle_objects = [ObstacleZone(**o) for o in obstacles]
    table_objects = [TableTypeObject(**t) for t in table_types]

    # ── aisle config defaults ─────────────────────────────────────────────
    if aisle_config:
        aisle = AisleConfigObject(**aisle_config)
    else:
        aisle = AisleConfigObject()

    wall_buffer = aisle.wall_buffer_mm
    table_spacing = aisle.table_spacing_mm

    # ── geometry prep ─────────────────────────────────────────────────────
    room = _build_room_polygon(wall_objects)
    zone = _compute_placement_zone(room, obstacle_objects, wall_buffer)

    if zone.is_empty or zone.area <= 0:
        logger.warning("Placement zone is empty — returning 0 placed tables")
        return []

    # ── primary: pyckingsolver ────────────────────────────────────────────
    try:
        return _pyckingsolver_place(zone, table_objects, counts, table_spacing)
    except Exception as exc:
        logger.warning("pyckingsolver failed (%s), falling back to grid placement", exc)

    # ── fallback: grid-based greedy ───────────────────────────────────────
    try:
        return _grid_place(zone, table_objects, counts, table_spacing)
    except Exception as exc:
        logger.error("Grid fallback also failed: %s", exc)
        return []
