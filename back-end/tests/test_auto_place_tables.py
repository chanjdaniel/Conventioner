"""Auto-Place fills the floor plan it was given (bug 38, E26/F09/S01).

With no walls drawn, the room was a fixed 10 m square centred on the origin whatever floor plan was
uploaded: a 55 m hall had a 49 m² placement zone, and every table landed off the image, up and to
the left of it. And the solver's time limit wrapped the call from outside, so the request ran on
past the moment the browser gave up.

These run the real solver - the placement is pure geometry, with no model call to stub.
"""
import time

import pytest
from shapely.geometry import box

import services.placement_service as Placement

SIX_FOOT = {"id": "six", "name": "Six-foot", "width_mm": 1800, "height_mm": 750, "max_capacity": 2}
HALL = {"width_mm": 40000, "height_mm": 30000}


def place(count, room_mm=HALL, walls=()):
    return Placement.auto_place_tables(
        walls=list(walls), obstacles=[], table_types=[SIX_FOOT], counts={"six": count},
        scale_px_per_mm=0.02, room_mm=room_mm,
    )


def test_it_places_as_many_as_it_is_asked_when_they_fit():
    placed = place(20)

    assert len(placed) == 20


def test_every_table_is_on_the_floor_plan_and_clear_of_its_edges():
    """Tables are drawn from the image's top-left corner; none may sit off the plan."""
    wall_buffer = 1500
    for table in place(20):
        half_w, half_h = table["width_mm"] / 2, table["height_mm"] / 2
        if table["rotation"] in (90, -90, 270):
            half_w, half_h = half_h, half_w
        assert table["x_mm"] - half_w >= wall_buffer - 1
        assert table["y_mm"] - half_h >= wall_buffer - 1
        assert table["x_mm"] + half_w <= HALL["width_mm"] - wall_buffer + 1
        assert table["y_mm"] + half_h <= HALL["height_mm"] - wall_buffer + 1


def test_a_small_room_holds_fewer_and_says_so_by_placing_fewer():
    placed = place(50, room_mm={"width_mm": 9000, "height_mm": 9000})

    assert 0 < len(placed) < 50


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
        [Placement.TableTypeObject(**SIX_FOOT)], {"six": 200}, 1200,
        time_limit_s=Placement.SOLVER_TIME_LIMIT_S,
    )

    assert time.monotonic() - started < 8
