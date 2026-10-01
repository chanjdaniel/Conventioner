"""Where a market has been: one entry for every phase it entered (E26/F06/S03).

Settles claims-and-room ticket 06. Before this there was no record of which phases a market passed
through, so the archived rail read evidence instead - a stored assignment meant Assignment, a
published form meant Applications Open - and no evidence distinguished "assigned, then archived"
from "assigned, published, ran, then archived". It always stopped at Assignment, and said the
stronger thing anyway: "It was assigned but never published, so no check-in page went on the air",
about a market whose check-in page had served a real market day (bug 8).

**The record is written by the one phase writer**, ``MarketsApi.apply_phase_transition``, in the
same atomic update that moves the phase, and by ``create_market`` for the ``draft`` every market
starts in. It is a log, not a "furthest phase" field, because the machine has back edges (Reopen
for Editing, the form amendment chain) and because a log answers the questions that come next -
when applications opened, who published - which a single field cannot.

**On the market document, not beside it.** ``placement_history`` is a separate collection because
placements are many and each names a vendor; a market enters a handful of phases in its life, the
rail reads them on every market screen, and the one market store already holds the document.

**A market that predates the record says less.** Its record, if it has one at all, began partway
through its life, so a phase missing from it may still have been entered. Its phases are the record
plus what the market holds that PROVES more - a check-in proves it ran, a stored assignment that it
was assigned, a published form that it opened applications - and ``complete`` is false, so no
reader takes a phase missing from them to mean the market never got there.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, FrozenSet, List, Optional

import api.attendance as AttendanceApi
from assignment.utils import convert_keys_to_camel_case
from datatypes import MarketPhase, PhaseEntry, phase_from_market_document
from market_documents import market_doc_field, market_doc_key


def phase_entry(phase: str, by: Optional[str]) -> PhaseEntry:
    """One entry: the phase entered, when, and who moved it there."""
    return PhaseEntry(phase=phase, entered_at=datetime.now(timezone.utc).isoformat(), by=by)


def _stored(entry: PhaseEntry) -> Dict[str, Any]:
    return convert_keys_to_camel_case(entry.model_dump())


def _record(document: Dict[str, Any]) -> List[Dict[str, Any]]:
    record = market_doc_field(document, "phase_history")
    if not isinstance(record, list):
        return []
    return [entry for entry in record if isinstance(entry, dict)]


def push_entries(document: Dict[str, Any], to_phase: str, by: Optional[str]) -> Dict[str, Any]:
    """The ``$push`` that records this market entering ``to_phase``.

    A market with no record yet predates it, so its record starts here - with the phase it was
    already in, undated, because when it entered that phase is not known. That undated first entry
    is what keeps a record begun partway through a market's life from passing for a whole one.
    """
    entries = [_stored(phase_entry(to_phase, by))]
    if not _record(document):
        current = phase_from_market_document(document).value
        entries.insert(0, _stored(PhaseEntry(phase=current, entered_at=None, by=None)))
    return {market_doc_key("phase_history"): {"$each": entries}}


@dataclass(frozen=True)
class PhasesReached:
    """Every phase a market is known to have entered.

    ``complete`` is whether that is the whole story. A market whose record began with its creation
    can be taken at its word - a phase missing here is a phase it never entered. One that predates
    the record cannot: a phase missing here is only one nothing it holds can prove.
    """

    phases: FrozenSet[str]
    complete: bool

    @property
    def ran(self) -> bool:
        """Did it reach its market days - the phase that serves a check-in page?"""
        return MarketPhase.MARKET_DAYS.value in self.phases


def phases_reached(document: Dict[str, Any]) -> PhasesReached:
    """Where this stored market has been, from its record and, where that is partial, from proof.

    Attendance is read only for a market whose record is partial: a check-in is the one proof
    that a market ran, and a market with a whole record needs no proof.
    """
    record = _record(document)
    entered = {entry["phase"] for entry in record if isinstance(entry.get("phase"), str)}
    entered.add(phase_from_market_document(document).value)

    # Every market starts in draft, and `create_market` dates that entry. A record that opens any
    # other way began partway through the market's life.
    first = record[0] if record else {}
    if first.get("phase") == MarketPhase.DRAFT.value and first.get(market_doc_key("entered_at")):
        return PhasesReached(frozenset(entered), complete=True)

    entered.add(MarketPhase.DRAFT.value)
    form = market_doc_field(document, "application_form")
    if isinstance(form, dict) and form.get(market_doc_key("published_at")):
        entered.add(MarketPhase.APPLICATIONS_OPEN.value)
    assignment = market_doc_field(document, "assignment_object")
    if isinstance(assignment, dict) and assignment.get(market_doc_key("vendor_assignments")):
        entered.add(MarketPhase.ASSIGNMENT.value)
    if AttendanceApi.market_has_attendance(document.get("id", "")):
        entered.add(MarketPhase.MARKET_DAYS.value)
    return PhasesReached(frozenset(entered), complete=False)
