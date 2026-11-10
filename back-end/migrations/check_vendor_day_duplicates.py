#!/usr/bin/env python3
"""Find any vendor's day held by more than one record, before promoting the release that refuses
to boot on one (T270).

Each collection in ``unique_indexes.VENDOR_DAY_INDEXES`` has its owner build a unique index per
vendor's day at boot (``api.attendance.ensure_attendance_indexes``), and the back end refuses to
start when it cannot, which a duplicate already stored would cause. Run this against production
first: it reads, groups by market, vendor and date, and prints each duplicate by market id, date
and record id, never by address. It writes nothing. Resolving one is in docs/OPERATIONS.md, "When the back end refuses to
boot".

Exits 0 when no vendor's day has more than one record, and 1 when any has.

Usage (the production database address passed inline, never from back-end/.env):
    MONGODB_URI='<URI>' .venv/bin/python migrations/check_vendor_day_duplicates.py
"""
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unique_indexes import (  # noqa: E402
    VENDOR_DAY_FIELDS,
    VENDOR_DAY_INDEXES,
    VENDOR_DAY_SHOWN,
    describe_groups,
    duplicate_groups,
)

#: Every collection read: each that holds one record per vendor's day.
CHECKED = tuple(VENDOR_DAY_INDEXES)


def check(database: Any) -> int:
    """Print what each collection holds twice; 0 when nothing, 1 when anything."""
    found = 0
    for name in CHECKED:
        groups = duplicate_groups(database[name], VENDOR_DAY_FIELDS, VENDOR_DAY_SHOWN)
        if not groups:
            print(f"{name}: no vendor's day has more than one record.")
            continue
        found += len(groups)
        days = "vendor's day has" if len(groups) == 1 else "vendor's days have"
        print(f"{name}: {len(groups)} {days} more than one record, by "
              f"{', '.join(VENDOR_DAY_SHOWN)} and record id:")
        for group in groups:
            print(f"  - {describe_groups([group], VENDOR_DAY_SHOWN)}")
    return 1 if found else 0


def main() -> int:
    from db_config import get_database

    return check(get_database())


if __name__ == "__main__":
    sys.exit(main())
