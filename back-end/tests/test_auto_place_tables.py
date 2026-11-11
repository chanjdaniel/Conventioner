"""Auto-Place fills the floor plan it was given (bug 38, E26/F09/S01).

With no walls drawn, the room was a fixed 10 m square centred on the origin whatever floor plan was
uploaded: a 55 m hall had a 49 m² placement zone, and every table landed off the image, up and to
the left of it. And the solver's time limit wrapped the call from outside, so the request ran on
past the moment the browser gave up.

These run the real solver - the placement is pure geometry, with no model call to stub - and each
placement case runs twice: once on the solver, and once on the grid placement with the solver's
import blocked, which is production's state, since production has no ``pyckingsolver`` wheel (T272).
"""
import itertools
import math
import sys
import time

import pytest
from shapely.geometry import box

import services.placement_service as Placement
from client_errors import BadRequestError

SIX_FOOT = {"id": "six", "name": "Six-foot", "width_mm": 1800, "height_mm": 750, "max_capacity": 2}
HALL = {"width_mm": 40000, "height_mm": 30000}


@pytest.fixture(params=["solver", "grid"])
def engine(request, monkeypatch):
    """Which placement runs: the solver, with the grid made to fail so a fallback cannot pass for
    it, or the grid, with ``pyckingsolver`` unimportable as it is in production."""
    if request.param == "solver":
        import pyckingsolver  # noqa: F401 - the solver case needs the solver installed, as CI has it

        def no_grid(*_args, **_kwargs):
            raise AssertionError("the solver case fell back to the grid")

        monkeypatch.setattr(Placement, "_grid_place", no_grid)
    else:
        monkeypatch.setitem(sys.modules, "pyckingsolver", None)
    return request.param


def place(count, room_mm=HALL, walls=()):
    return Placement.auto_place_tables(
        walls=list(walls), obstacles=[], table_types=[SIX_FOOT], counts={"six": count},
        scale_px_per_mm=0.02, room_mm=room_mm,
    )


def _footprint(table):
    """A placed table's rectangle on the plan, as (min x, min y, max x, max y) in millimetres."""
    half_w, half_h = table["width_mm"] / 2, table["height_mm"] / 2
    if table["rotation"] in (90, -90, 270):
        half_w, half_h = half_h, half_w
    return (table["x_mm"] - half_w, table["y_mm"] - half_h,
            table["x_mm"] + half_w, table["y_mm"] + half_h)


def test_it_places_as_many_as_it_is_asked_when_they_fit(engine):
    result = place(20)

    assert len(result.placed) == 20
    assert result.timed_out is False


def test_every_table_is_on_the_floor_plan_and_clear_of_its_edges(engine):
    """Tables are drawn from the image's top-left corner; none may sit off the plan."""
    wall_buffer = 1500
    for table in place(20).placed:
        half_w, half_h = table["width_mm"] / 2, table["height_mm"] / 2
        if table["rotation"] in (90, -90, 270):
            half_w, half_h = half_h, half_w
        assert table["x_mm"] - half_w >= wall_buffer - 1
        assert table["y_mm"] - half_h >= wall_buffer - 1
        assert table["x_mm"] + half_w <= HALL["width_mm"] - wall_buffer + 1
        assert table["y_mm"] + half_h <= HALL["height_mm"] - wall_buffer + 1


def test_a_small_room_holds_fewer_and_says_so_by_placing_fewer(engine):
    """A full room is not a slow one: it places fewer and does not say it ran out of time."""
    result = place(50, room_mm={"width_mm": 9000, "height_mm": 9000})

    assert 0 < len(result.placed) < 50
    assert result.timed_out is False


@pytest.fixture
def grid(monkeypatch):
    """The grid placement alone: ``pyckingsolver`` unimportable, as in production."""
    monkeypatch.setitem(sys.modules, "pyckingsolver", None)


def test_the_grid_places_a_real_hall_within_its_time(grid):
    """About 60 six-foot tables in a 40 m by 30 m hall: the size of a real market (T272)."""
    result = place(59)

    assert len(result.placed) == 59
    assert result.timed_out is False


def test_every_two_tables_keep_the_spacing_and_stay_in_the_zone(grid):
    """The default 1200 mm aisle between tables, and the 1500 mm wall buffer, on a hall it fills.

    The grid tests a position by its distance to the placed tables, not by their buffers.
    """
    spacing, wall_buffer = 1200, 1500
    room = {"width_mm": 20000, "height_mm": 15000}
    footprints = [_footprint(table) for table in place(60, room_mm=room).placed]

    assert len(footprints) > 10
    for min_x, min_y, max_x, max_y in footprints:
        assert min_x >= wall_buffer - 1 and min_y >= wall_buffer - 1
        assert max_x <= room["width_mm"] - wall_buffer + 1
        assert max_y <= room["height_mm"] - wall_buffer + 1
    for a, b in itertools.combinations(footprints, 2):
        gap_x = max(0, a[0] - b[2], b[0] - a[2])
        gap_y = max(0, a[1] - b[3], b[1] - a[3])
        assert math.hypot(gap_x, gap_y) >= spacing - 1


def test_the_grid_stops_at_its_own_time_limit_and_says_so(grid, monkeypatch):
    """Asked for more than it can place in its time, it answers what it placed by then (T272).

    The grid had no deadline: 200 tables took 49 s to 85 s, past the browser's 30 s, and the request
    ran on after the browser had given up.
    """
    monkeypatch.setattr(Placement, "GRID_TIME_LIMIT_S", 0.5)
    started = time.monotonic()

    result = place(500, room_mm={"width_mm": 200_000, "height_mm": 200_000})

    assert time.monotonic() - started < 3
    assert result.timed_out is True
    assert len(result.placed) < 500


def _square(side_mm):
    corners = [(0, 0), (side_mm, 0), (side_mm, side_mm), (0, side_mm)]
    return [{"start": corners[i], "end": corners[(i + 1) % 4], "thickness_mm": 200}
            for i in range(4)]


def test_walls_drawn_more_than_500_m_apart_are_no_room_to_place_in(engine):
    """The request's own size is bounded by the route; the room its walls enclose is bounded here."""
    with pytest.raises(BadRequestError, match="at most 500 m on each side"):
        place(1, room_mm=None, walls=_square(500_001))


def test_walls_that_enclose_nothing_are_refused_with_that_sentence(engine):
    walls = [{"start": (0, 0), "end": (10000, 0), "thickness_mm": 200},
             {"start": (10000, 0), "end": (20000, 0), "thickness_mm": 200}]

    with pytest.raises(BadRequestError, match="do not enclose a room"):
        place(1, room_mm=None, walls=walls)


def test_without_walls_the_room_is_the_floor_plan():
    assert Placement._build_room_polygon([], {"width_mm": 55000, "height_mm": 41000}).equals(
        box(0, 0, 55000, 41000),
    )


def test_without_walls_or_a_size_there_is_no_room_to_guess():
    with pytest.raises(ValueError, match="size"):
        Placement._build_room_polygon([], None)


def test_the_solver_stops_at_its_own_time_limit(monkeypatch):
    monkeypatch.setattr(Placement, "SOLVER_TIME_LIMIT_S", 1.0)
    started = time.monotonic()

    Placement._pyckingsolver_place(
        Placement._compute_placement_zone(box(0, 0, 40000, 30000), [], 1500),
        [Placement.BetaTableType(**SIX_FOOT)], {"six": 200}, 1200,
        time_limit_s=Placement.SOLVER_TIME_LIMIT_S,
    )

    assert time.monotonic() - started < 8
