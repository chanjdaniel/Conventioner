"""A location's layout, as ``layout.py`` judges it (T257): the counts it gives its sections, the
rules its tables keep, what of it settles on leaving draft, and what a save of it changed.

Pure: plans and floorplans built here, no request and no database.
"""
import pytest

import layout as Layout
from datatypes import FloorplanObject, SetupObject

UPPER = "loc-upper"
LOWER = "loc-lower"
GOLD = "sec-gold"
SILVER = "sec-silver"
BLUE = "sec-blue"
SIX_FOOT = "tt-six"
SQUARE = "tt-square"


def _plan(floorplans=None, gold_count=9, silver_count=4, blue_count=7, table_types=None):
    """Two locations; Gold row and Silver aisle in Upper Hall, Blue row in Lower Hall."""
    upper = {"id": UPPER, "name": "Upper Hall"}
    lower = {"id": LOWER, "name": "Lower Hall"}
    return SetupObject.model_validate({
        "priority": [], "market_dates": [], "tiers": [], "assignment_options": {},
        "locations": [upper, lower],
        "sections": [
            {"id": GOLD, "name": "Gold row", "location": upper, "count": gold_count},
            {"id": SILVER, "name": "Silver aisle", "location": upper, "count": silver_count},
            {"id": BLUE, "name": "Blue row", "location": lower, "count": blue_count},
        ],
        "table_types": table_types if table_types is not None else [
            {"id": SIX_FOOT, "name": "Standard 6 ft", "width_mm": 1830, "depth_mm": 760},
            {"id": SQUARE, "name": "Square 4 ft", "width_mm": 1220, "depth_mm": 1220},
        ],
        "floorplans": floorplans,
    })


def _table(table_id, section=GOLD, number=1, x=1000.0, y=1000.0, rotation=0.0, kind=SIX_FOOT):
    return {"id": table_id, "section_id": section, "number": number, "table_type_id": kind,
            "x_mm": x, "y_mm": y, "rotation": rotation}


def _floorplan(tables=(), location=UPPER, floorplan_id="fp-upper", **overrides):
    """A calibrated layout 30 m across: an 800 x 600 px image at 800 / 30,000 px per mm."""
    floorplan = {
        "id": floorplan_id, "location_id": location, "revision": 1,
        "image_gridfs_id": "img-1", "image_width": 800, "image_height": 600,
        "scale_px_per_unit": 800 / 30_000,
        "tables": list(tables),
    }
    floorplan.update(overrides)
    return FloorplanObject.model_validate(floorplan)


def _gold(n, start=1):
    return [_table(f"g-{i}", GOLD, i, x=1000.0 * i) for i in range(start, start + n)]


def _counts(plan):
    return {section.name: section.count for section in plan.sections}


class TestDeriveCounts:

    def test_a_laid_out_sections_count_is_its_tables(self):
        plan = _plan([_floorplan([*_gold(3), _table("s-1", SILVER, 1)])], gold_count=13)

        assert _counts(Layout.derive_counts(plan)) == {
            "Gold row": 3, "Silver aisle": 1, "Blue row": 7}

    def test_a_section_of_a_laid_out_location_with_no_table_counts_none(self):
        plan = _plan([_floorplan(_gold(2))])

        assert _counts(Layout.derive_counts(plan))["Silver aisle"] == 0

    def test_a_location_with_no_layout_keeps_its_typed_counts(self):
        plan = _plan([_floorplan(_gold(2))], blue_count=11)

        assert _counts(Layout.derive_counts(plan))["Blue row"] == 11

    def test_a_table_in_no_section_counts_for_none(self):
        plan = _plan([_floorplan([*_gold(2), _table("x", None, None)])])

        assert _counts(Layout.derive_counts(plan))["Gold row"] == 2

    def test_a_table_naming_a_section_of_another_location_counts_for_none(self):
        plan = _plan([_floorplan([*_gold(2), _table("b", BLUE, 1)])], blue_count=7)

        assert _counts(Layout.derive_counts(plan)) == {
            "Gold row": 2, "Silver aisle": 0, "Blue row": 7}

    def test_a_beta_floorplan_of_no_location_is_ignored(self):
        beta = FloorplanObject.model_validate({
            "id": "fp-beta", "placed_tables": [{"id": "t", "x": 1, "y": 1}],
            "sections": [{"name": "Gold row", "location_name": "Upper Hall", "table_ids": ["t"]}],
        })
        plan = _plan([beta], gold_count=13)

        assert beta.location_id is None
        assert _counts(Layout.derive_counts(plan)) == _counts(plan)

    def test_a_floorplan_of_a_location_gone_is_ignored(self):
        plan = _plan([_floorplan(_gold(2), location="loc-gone")], gold_count=13)

        assert _counts(Layout.derive_counts(plan))["Gold row"] == 13

    def test_a_plan_with_no_floorplans_is_unchanged(self):
        plan = _plan(None)

        assert Layout.derive_counts(plan) == plan


class TestLayoutRefusal:

    def test_a_layout_keeping_every_rule_is_not_refused(self):
        plan = _plan()
        floorplan = _floorplan([*_gold(3), _table("s-1", SILVER, 1), _table("x", None, None)])

        assert Layout.layout_refusal(floorplan, plan) is None

    def test_an_empty_layout_is_not_refused(self):
        assert Layout.layout_refusal(_floorplan([]), _plan()) is None

    @pytest.mark.parametrize("location", ["loc-gone", None])
    def test_a_location_not_the_markets_is_refused(self, location):
        refused = Layout.layout_refusal(_floorplan([], location=location), _plan())

        assert refused == Layout.UNKNOWN_LOCATION

    @pytest.mark.parametrize("numbers", [[1, 3], [1, 1, 2], [2], [0, 1], [1, None]],
                             ids=["gap", "repeat", "not-from-1", "zero", "unnumbered"])
    def test_numbers_that_do_not_run_1_to_n_are_refused(self, numbers):
        tables = [_table(f"g-{i}", GOLD, number) for i, number in enumerate(numbers)]

        assert Layout.layout_refusal(_floorplan(tables), _plan()) == Layout.NUMBERING

    def test_a_number_on_a_table_of_no_section_is_refused(self):
        floorplan = _floorplan([*_gold(2), _table("x", None, 3)])

        assert Layout.layout_refusal(floorplan, _plan()) == Layout.NUMBERING

    def test_each_section_numbers_on_its_own(self):
        floorplan = _floorplan([*_gold(2), _table("s-1", SILVER, 1), _table("s-2", SILVER, 2)])

        assert Layout.layout_refusal(floorplan, _plan()) is None

    def test_a_table_of_a_type_not_the_markets_is_refused(self):
        floorplan = _floorplan([_table("g-1", kind="tt-gone")])

        assert Layout.layout_refusal(floorplan, _plan()) == Layout.UNKNOWN_TABLE_TYPE

    @pytest.mark.parametrize("x,y", [(-1, 100), (30_001, 100), (100, -1), (100, 22_501)])
    def test_a_centre_outside_the_floorplan_is_refused(self, x, y):
        floorplan = _floorplan([_table("g-1", x=x, y=y)])

        assert Layout.layout_refusal(floorplan, _plan()) == Layout.OUTSIDE_THE_FLOORPLAN

    @pytest.mark.parametrize("x,y", [(0, 0), (30_000, 22_500)])
    def test_a_centre_on_the_floorplans_edge_is_inside(self, x, y):
        floorplan = _floorplan([_table("g-1", x=x, y=y)])

        assert Layout.layout_refusal(floorplan, _plan()) is None

    @pytest.mark.parametrize("missing", ["image_width", "image_height", "scale_px_per_unit"])
    def test_tables_on_a_floorplan_not_calibrated_are_refused(self, missing):
        floorplan = _floorplan(_gold(1), **{missing: None})

        assert Layout.layout_refusal(floorplan, _plan()) == Layout.NOT_CALIBRATED

    def test_a_floorplan_not_calibrated_with_no_tables_is_not_refused(self):
        assert Layout.layout_refusal(_floorplan([], scale_px_per_unit=None), _plan()) is None


SETTLED = "The setup is settled."


class TestSettledLayoutRefusal:

    def _settled(self, stored_floorplans, proposed_floorplans, stored_types=None,
                 proposed_types=None):
        return Layout.settled_layout_refusal(
            _plan(stored_floorplans, table_types=stored_types),
            _plan(proposed_floorplans, table_types=proposed_types),
            SETTLED,
        )

    def test_the_same_seats_are_not_a_change(self):
        assert self._settled([_floorplan(_gold(3))], [_floorplan(_gold(3))]) is None

    def test_moving_and_turning_a_table_is_not_a_change(self):
        moved = _gold(3)
        moved[0] = {**moved[0], "x_mm": 4321.0, "rotation": 90.0}

        assert self._settled([_floorplan(_gold(3))], [_floorplan(moved)]) is None

    def test_the_seats_in_another_order_are_not_a_change(self):
        assert self._settled([_floorplan(_gold(3))], [_floorplan(_gold(3)[::-1])]) is None

    def test_a_zone_the_image_or_the_scale_is_not_a_change(self):
        changed = _floorplan(_gold(3), image_gridfs_id="img-2", scale_px_per_unit=0.03,
                             zones=[{"id": "z", "x_mm": 0, "y_mm": 0, "width_mm": 10,
                                     "depth_mm": 10}])

        assert self._settled([_floorplan(_gold(3))], [changed]) is None

    @pytest.mark.parametrize("field,value", [
        ("id", "g-other"), ("section_id", SILVER), ("number", 4), ("table_type_id", SQUARE),
    ])
    def test_a_changed_seat_is_refused(self, field, value):
        changed = _gold(3)
        changed[2] = {**changed[2], field: value}

        assert self._settled([_floorplan(_gold(3))], [_floorplan(changed)]) == SETTLED

    def test_an_added_or_removed_table_is_refused(self):
        assert self._settled([_floorplan(_gold(3))], [_floorplan(_gold(4))]) == SETTLED
        assert self._settled([_floorplan(_gold(3))], [_floorplan(_gold(2))]) == SETTLED

    def test_a_layout_added_or_removed_is_refused(self):
        assert self._settled([_floorplan(_gold(3))], [
            _floorplan(_gold(3)), _floorplan([], location=LOWER, floorplan_id="fp-lower"),
        ]) == SETTLED
        assert self._settled([_floorplan(_gold(3))], []) == SETTLED

    def test_a_layout_moved_to_another_location_is_refused(self):
        assert self._settled([_floorplan([])], [_floorplan([], location=LOWER)]) == SETTLED

    def test_the_same_types_in_another_order_are_not_a_change(self):
        types = [
            {"id": SIX_FOOT, "name": "Standard 6 ft", "width_mm": 1830, "depth_mm": 760},
            {"id": SQUARE, "name": "Square 4 ft", "width_mm": 1220, "depth_mm": 1220},
        ]

        assert self._settled([], [], types, types[::-1]) is None

    @pytest.mark.parametrize("field,value", [
        ("name", "Long 8 ft"), ("width_mm", 2440), ("depth_mm", 900), ("id", "tt-other"),
    ])
    def test_a_changed_type_is_refused(self, field, value):
        types = [{"id": SIX_FOOT, "name": "Standard 6 ft", "width_mm": 1830, "depth_mm": 760}]

        assert self._settled([], [], types, [{**types[0], field: value}]) == SETTLED

    def test_an_added_type_is_refused(self):
        types = [{"id": SIX_FOOT, "name": "Standard 6 ft", "width_mm": 1830, "depth_mm": 760}]
        added = [*types, {"id": SQUARE, "name": "Square 4 ft", "width_mm": 1220, "depth_mm": 1220}]

        assert self._settled([], [], types, added) == SETTLED


class TestDescribeChange:

    def _change(self, before, after):
        return Layout.describe_change(before, after, _plan())

    def test_a_first_save_is_started(self):
        change = self._change(None, _floorplan(_gold(2)))

        assert change["started"] is True
        assert change["added"] == {"Gold row": 2}

    def test_a_save_that_changes_nothing_describes_nothing(self):
        assert self._change(_floorplan(_gold(3)), _floorplan(_gold(3))) == {}

    def test_added_and_removed_are_counted_per_section(self):
        before = _floorplan([*_gold(3), _table("s-1", SILVER, 1)])
        after = _floorplan([*_gold(2), _table("s-1", SILVER, 1), _table("s-2", SILVER, 2),
                            _table("s-3", SILVER, 3), _table("x", None, None)])

        change = self._change(before, after)

        assert change["added"] == {"Silver aisle": 2, "in no section": 1}
        assert change["removed"] == {"Gold row": 1}

    def test_a_table_changing_section_leaves_one_and_joins_the_other(self):
        before = _floorplan(_gold(2))
        after = _floorplan([_gold(1)[0], _table("g-2", SILVER, 1, x=2000.0)])

        change = self._change(before, after)

        assert change["removed"] == {"Gold row": 1}
        assert change["added"] == {"Silver aisle": 1}

    def test_moved_and_turned_are_counted(self):
        after = _gold(3)
        after[0] = {**after[0], "x_mm": 5000.0}
        after[1] = {**after[1], "y_mm": 2000.0, "rotation": 45.0}
        after[2] = {**after[2], "rotation": 90.0}

        change = self._change(_floorplan(_gold(3)), _floorplan(after))

        assert (change["moved"], change["turned"]) == (2, 2)
        assert set(change) == {"moved", "turned"}

    def test_a_move_under_half_a_millimetre_is_not_a_move(self):
        after = _gold(1)
        after[0] = {**after[0], "x_mm": after[0]["x_mm"] + 0.2}

        assert self._change(_floorplan(_gold(1)), _floorplan(after)) == {}

    def test_a_turn_by_a_whole_circle_is_not_a_turn(self):
        after = _gold(1)
        after[0] = {**after[0], "rotation": 360.0}

        assert self._change(_floorplan(_gold(1)), _floorplan(after)) == {}

    def test_renumbered_names_the_sections(self):
        after = _gold(2)
        after[0], after[1] = {**after[0], "number": 2}, {**after[1], "number": 1}

        change = self._change(_floorplan(_gold(2)), _floorplan(after))

        assert change == {"renumbered": ["Gold row"]}

    def test_zones_are_counted_added_changed_and_removed(self):
        zone = {"id": "z-1", "label": "Stage", "x_mm": 0, "y_mm": 0, "width_mm": 10, "depth_mm": 10}
        before = _floorplan([], zones=[zone, {**zone, "id": "z-2"}])
        after = _floorplan([], zones=[{**zone, "width_mm": 20}, {**zone, "id": "z-3"},
                                      {**zone, "id": "z-4"}])

        change = self._change(before, after)

        assert change == {"zones": {"added": 2, "changed": 1, "removed": 1}}

    def test_a_replaced_image_is_said(self):
        assert self._change(_floorplan([]), _floorplan([], image_gridfs_id="img-2")) == {
            "image": "replaced"}

    def test_a_new_scale_is_metres_across_before_and_after(self):
        change = self._change(_floorplan([]), _floorplan([], scale_px_per_unit=800 / 36_000))

        assert change == {"scale": {"before": 30.0, "after": 36.0}}

    def test_a_first_scale_is_from_none(self):
        change = self._change(_floorplan([], scale_px_per_unit=None), _floorplan([]))

        assert change == {"scale": {"before": None, "after": 30.0}}

    def test_colours_name_the_sections(self):
        style = {"section_id": GOLD, "color": 1, "label_at": None}
        before = _floorplan([], section_styles=[style])
        after = _floorplan([], section_styles=[{**style, "color": 3},
                                               {"section_id": SILVER, "color": 2}])

        assert self._change(before, after) == {"colours": ["Gold row", "Silver aisle"]}

    def test_a_moved_label_names_its_section_apart_from_the_colours(self):
        style = {"section_id": GOLD, "color": 1, "label_at": None}
        after = _floorplan([], section_styles=[{**style, "label_at": {"x_mm": 5, "y_mm": 5}}])

        assert self._change(_floorplan([], section_styles=[style]), after) == {
            "labels": ["Gold row"]}
