"""A submission timestamp is stored as a moment, not as whatever text the form wrote.

E01/F04/S02, decided by wayfinder ticket 01.

The public applicant form already writes ISO-8601 (`application_write.py`). Only the CSV path
stored the form's own `M/D/YYYY H:MM:SS`, and two readers compare that stored value:

  - ``_as_magnitude`` (``assignment/assignment.py``) ends in ``datetime.fromisoformat``, which
    cannot read it - so every imported vendor scored ``math.inf`` and the organizer's
    "when the application arrived, earliest first" rule ordered nothing at all, silently.
  - ``api/applications.py`` sorts the review queue by the same string, so unpadded hours put
    ``9/27/2025 9:04:01`` *after* ``9/27/2025 23:49:25``.

Normalising at the import boundary fixes both, because both read one stored value.
"""
import os
import sys
from datetime import datetime

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from csv_import import normalized_submitted_at  # noqa: E402


class TestTheFormatsAFormActuallyWrites:
    """Google Forms writes the sheet's locale, and a sheet exports unpadded."""

    @pytest.mark.parametrize("raw,expected", [
        ("9/12/2025 18:22:56", "2025-09-12T18:22:56"),
        # The case that misordered the fixture: single-digit hour sorts after 23 as text.
        ("9/27/2025 9:04:01", "2025-09-27T09:04:01"),
        ("9/27/2025 23:49:25", "2025-09-27T23:49:25"),
        # Zero-padded is the same day.
        ("09/12/2025 18:22:56", "2025-09-12T18:22:56"),
        # 12-hour clocks appear when the sheet's locale uses one.
        ("9/12/2025 6:22:56 PM", "2025-09-12T18:22:56"),
        ("9/12/2025 6:22:56 AM", "2025-09-12T06:22:56"),
        # Date with no time at all.
        ("9/12/2025", "2025-09-12T00:00:00"),
    ])
    def test_it_becomes_iso(self, raw, expected):
        assert normalized_submitted_at(raw) == expected

    def test_iso_is_left_alone(self):
        """The public form already writes this; normalising must not disturb it."""
        assert normalized_submitted_at("2026-07-01T00:00:00+00:00") == "2026-07-01T00:00:00+00:00"

    def test_blank_is_absent_rather_than_wrong(self):
        assert normalized_submitted_at("") is None
        assert normalized_submitted_at("   ") is None
        assert normalized_submitted_at(None) is None

    def test_something_that_is_not_a_time_is_refused(self):
        """Refused, not guessed. A row whose time cannot be read cannot take its turn."""
        with pytest.raises(ValueError):
            normalized_submitted_at("last tuesday")
        with pytest.raises(ValueError):
            normalized_submitted_at("13/45/2025 99:99:99")


class TestWhatNormalisingBuys:
    """The two bugs, asserted as behaviour rather than as a format."""

    def test_the_solver_can_read_every_normalised_value(self):
        from assignment.assignment import _as_magnitude

        for raw in ("9/12/2025 18:22:56", "9/27/2025 9:04:01", "9/27/2025 23:49:25"):
            assert _as_magnitude(normalized_submitted_at(raw)) is not None, (
                f"{raw!r} still scores math.inf, so the priority rule still orders nothing"
            )

    def test_text_order_now_matches_time_order(self):
        """ISO's whole point: the earliest submission is simply the smallest string."""
        raw = [
            "9/27/2025 23:49:25",
            "9/12/2025 18:22:56",
            "9/27/2025 9:04:01",
            "10/1/2025 8:00:00",
        ]
        iso = [normalized_submitted_at(r) for r in raw]

        assert sorted(iso) == [normalized_submitted_at(r) for r in sorted(
            raw, key=lambda s: datetime.strptime(s, "%m/%d/%Y %H:%M:%S")
        )]

    def test_the_real_fixture_orders_chronologically_as_text(self):
        """The measured failure: 111 of 232 rows were in the wrong position."""
        import csv

        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "test_data", "google_forms_export.csv")
        with open(path, newline="", encoding="utf-8") as handle:
            rows = list(csv.reader(handle))
        stamps = [r[1] for r in rows[1:] if len(r) > 1 and r[1]]
        iso = [normalized_submitted_at(s) for s in stamps]

        by_text = sorted(iso)
        by_time = sorted(iso, key=lambda s: datetime.fromisoformat(s))

        assert by_text == by_time
