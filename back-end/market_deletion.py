"""Deleting a market, and everything kept with it (bug 47).

A market keeps records beside itself, keyed by its id: its applications (each vendor's name, email
and answers), its check-ins, its applicant sign-in codes and its placement trail. Deleting the
market document alone left all of them behind for ever, describing a market nobody could reach any
more. Both doors that delete a market - its own Delete, and its organization's - come through here,
so a record kind added later is one line in one place rather than a third door that forgets it.

The records go first and the market last: if anything fails, the market is still there to delete
again, rather than records that nothing reaches.
"""
from typing import Any

import api.applicant_auth as ApplicantAuth
import api.applications as ApplicationsApi
import api.attendance as AttendanceApi
import placement_history as PlacementHistory


def delete_market_and_records(markets_collection: Any, market_id: str) -> Any:
    """Delete a market's records, then the market. Returns the market's ``DeleteResult``."""
    ApplicationsApi.delete_applications_for_market(market_id)
    AttendanceApi.delete_attendance_for_market(market_id)
    ApplicantAuth.delete_challenges_for_market(market_id)
    PlacementHistory.delete_for_market(market_id)
    return markets_collection.delete_one({"id": market_id})
