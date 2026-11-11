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


# ── Fill an area (T257): a box or a drawn shape, packed in rows ──────────────

AREA_HALL = {"width_mm": 30000, "height_mm": 20000}
AISLE = {"wall_buffer_mm": 0, "table_spacing_mm": 1200}


def fill(count, *, area_mm=None, area_polygon_mm=None, obstacles=(), existing_mm=(),
         direction="across", room_mm=AREA_HALL):
    return Placement.auto_place_tables(
        walls=[], obstacles=list(obstacles), table_types=[SIX_FOOT], counts={"six": count},
        scale_px_per_mm=0.02, room_mm=room_mm, aisle_config=AISLE, area_mm=area_mm,
        area_polygon_mm=area_polygon_mm, existing_mm=list(existing_mm), direction=direction,
    )


def _rows_of(footprints):
    """The footprints by the row they stand in: their top edge, then left to right."""
    rows = {}
    for footprint in footprints:
        rows.setdefault(round(footprint[1]), []).append(footprint)
    return [sorted(row) for _, row in sorted(rows.items())]


@pytest.fixture(params=["with the solver installed", "without it"])
def either_install(request, monkeypatch):
    """An area is packed by the rows of this module wherever it runs: with ``pyckingsolver``
    installed, as on a developer's machine and in CI, and without it, as in production."""
    if request.param == "without it":
        monkeypatch.setitem(sys.modules, "pyckingsolver", None)
    return request.param


class TestFillingABox:
    def test_thirty_asked_of_an_empty_box_are_thirty_inside_it(self, either_install):
        area = [2000, 3000, 20000, 12000]

        result = fill(30, area_mm=area)

        assert len(result.placed) == 30
        assert result.timed_out is False
        for min_x, min_y, max_x, max_y in map(_footprint, result.placed):
            assert 2000 - 0.01 <= min_x and max_x <= 22000 + 0.01
            assert 3000 - 0.01 <= min_y and max_y <= 15000 + 0.01

    def test_the_tables_stand_in_rows_across_touching_with_the_aisle_between_rows(
        self, either_install,
    ):
        rows = _rows_of([_footprint(table) for table in fill(30, area_mm=[2000, 3000, 20000, 12000]).placed])

        # 20 m holds eleven 1.8 m tables end to end; thirty are two rows of eleven and one of eight.
        assert [len(row) for row in rows] == [11, 11, 8]
        for row in rows:
            for left, right in zip(row, row[1:]):
                assert right[0] == pytest.approx(left[2], abs=0.01)
        tops = [row[0][1] for row in rows]
        assert tops == pytest.approx([3000, 3000 + 750 + 1200, 3000 + 2 * (750 + 1200)], abs=0.01)
        assert all(table["rotation"] == 0 for table in fill(30, area_mm=[2000, 3000, 20000, 12000]).placed)

    def test_the_answer_is_in_reading_order(self, either_install):
        placed = fill(30, area_mm=[2000, 3000, 20000, 12000]).placed

        assert [(t["y_mm"], t["x_mm"]) for t in placed] == sorted((t["y_mm"], t["x_mm"]) for t in placed)

    def test_asked_for_more_than_fit_it_fills_the_box_and_does_not_say_it_ran_out_of_time(
        self, either_install,
    ):
        # 10 m by 5 m: three rows (0, 1.95 m and 3.9 m down) of five.
        result = fill(500, area_mm=[0, 0, 10000, 5000])

        assert len(result.placed) == 15
        assert result.timed_out is False

    def test_rows_down_stand_turned_a_quarter_in_columns(self, either_install):
        placed = fill(500, area_mm=[0, 0, 5000, 10000], direction="down").placed

        assert len(placed) == 15
        assert all(table["rotation"] == 90 for table in placed)
        assert sorted({round(table["x_mm"]) for table in placed}) == [375, 2325, 4275]

    def test_no_table_stands_on_a_no_table_zone(self, either_install):
        zone = {"polygon": [[6000, 0], [9000, 0], [9000, 20000], [6000, 20000]], "type": "no_table_zone"}

        result = fill(500, area_mm=[0, 0, 20000, 6000], obstacles=[zone])

        assert result.placed
        for min_x, _min_y, max_x, _max_y in map(_footprint, result.placed):
            assert max_x <= 6000 + 0.01 or min_x >= 9000 - 0.01
        # A row goes on past the zone, from its far edge.
        assert any(_footprint(table)[0] == pytest.approx(9000, abs=0.01) for table in result.placed)

    def test_every_table_keeps_the_aisle_from_a_table_already_placed(self, either_install):
        # A table already standing in the middle of the box, turned 30 degrees.
        standing = [[9000, 2600], [10585, 3515], [10205, 4173], [8620, 3258]]

        result = fill(500, area_mm=[0, 0, 20000, 6000], existing_mm=[standing])

        assert result.placed
        from shapely.geometry import Polygon
        for table in result.placed:
            assert box(*_footprint(table)).distance(Polygon(standing)) >= 1200 - 0.01

    def test_a_zone_whose_sides_cross_still_keeps_its_floor_clear(self, either_install):
        from shapely.geometry import Polygon
        from shapely.validation import make_valid
        bow_tie = [[6000, 0], [10000, 6000], [10000, 0], [6000, 6000]]

        result = fill(500, area_mm=[0, 0, 20000, 6000],
                      obstacles=[{"polygon": bow_tie, "type": "no_table_zone"}])

        assert result.placed
        covered = make_valid(Polygon(bow_tie))
        for table in result.placed:
            assert box(*_footprint(table)).intersection(covered).area < 0.01

    @pytest.mark.parametrize("points", [[], [[5, 5]], [[0, 0], [5, 5]]])
    def test_a_zone_of_fewer_than_three_points_takes_no_floor(self, either_install, points):
        result = fill(500, area_mm=[0, 0, 10000, 5000],
                      obstacles=[{"polygon": points, "type": "no_table_zone"}])

        assert len(result.placed) == 15

    def test_a_box_that_runs_past_the_floorplan_is_filled_only_on_it(self, either_install):
        result = fill(500, area_mm=[25000, 15000, 20000, 20000])

        assert result.placed
        for _min_x, _min_y, max_x, max_y in map(_footprint, result.placed):
            assert max_x <= 30000 + 0.01 and max_y <= 20000 + 0.01

    def test_a_box_with_no_room_for_a_table_places_none(self, either_install):
        result = fill(5, area_mm=[0, 0, 1000, 500])

        assert result.placed == []
        assert result.timed_out is False


class TestFillingADrawnShape:
    L_SHAPE = [[0, 0], [12000, 0], [12000, 4000], [4000, 4000], [4000, 12000], [0, 12000]]

    def test_an_l_is_filled_only_inside_the_l(self, either_install):
        from shapely.geometry import Polygon
        shape = Polygon(self.L_SHAPE)

        result = fill(500, area_polygon_mm=self.L_SHAPE)

        # Rows 0 and 1.95 m down run the L's whole width (six tables); the four below, its arm (two).
        assert len(result.placed) == 2 * 6 + 4 * 2
        for table in result.placed:
            assert shape.buffer(0.01).contains(box(*_footprint(table)))

    def test_a_shape_with_a_sloping_wall_holds_only_whole_tables_inside_it(self, either_install):
        from shapely.geometry import Polygon
        triangle = [[0, 0], [16000, 0], [0, 8000]]

        result = fill(500, area_polygon_mm=triangle)

        assert len(result.placed) > 5
        for table in result.placed:
            assert Polygon(triangle).buffer(0.01).contains(box(*_footprint(table)))


class TestAFillsTime:
    def test_a_fill_that_runs_out_of_time_says_so(self, monkeypatch):
        monkeypatch.setattr(Placement, "GRID_TIME_LIMIT_S", 0.0)

        result = fill(30, area_mm=[0, 0, 20000, 12000])

        assert result.timed_out is True
        assert len(result.placed) < 30

    def test_a_hall_of_five_hundred_among_a_thousand_standing_is_filled_within_its_time(self):
        """The largest request the route lets through: 500 asked, 1,000 tables standing."""
        standing = [
            [[x, y], [x + 1800, y], [x + 1800, y + 750], [x, y + 750]]
            for x in range(0, 100_000, 2000) for y in range(100_000, 140_000, 2000)
        ]
        assert len(standing) == 1000
        started = time.monotonic()

        result = fill(
            500, area_mm=[0, 0, 100_000, 150_000], existing_mm=standing,
            room_mm={"width_mm": 100_000, "height_mm": 150_000},
        )

        assert time.monotonic() - started < 5
        assert len(result.placed) == 500
        assert result.timed_out is False
