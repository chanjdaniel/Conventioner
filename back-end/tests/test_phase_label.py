"""A phase is named to an organizer the way the product names it everywhere else.

The application-form lock banner used to read ``Current phase: market_days.`` - the stored enum,
on a screen whose phase rail names the same state ``Market Days`` two inches above it (E15/F02/S02).

``phase_label`` derives the label rather than keeping a second table beside the front end's
``PHASE_LABELS`` (``front-end/src/utils/phase.ts``). That is only safe while the derivation
reproduces those labels exactly, which is what this pins: the expected strings below are the front
end's, copied deliberately, so a phase whose label does not survive the transform fails here rather
than reaching an organizer as ``market_days``.
"""

import pytest

from datatypes import MarketPhase, phase_label


# Exactly the values of `PHASE_LABELS` in `front-end/src/utils/phase.ts`.
FRONT_END_LABELS = {
    MarketPhase.DRAFT: "Draft",
    MarketPhase.APPLICATIONS_OPEN: "Applications Open",
    MarketPhase.APPLICATIONS_CLOSED: "Applications Closed",
    MarketPhase.REVIEW: "Review",
    MarketPhase.ASSIGNMENT: "Assignment",
    MarketPhase.OFFERS: "Offers",
    MarketPhase.MARKET_DAYS: "Market Days",
    MarketPhase.ARCHIVED: "Archived",
}


@pytest.mark.parametrize("phase", list(MarketPhase))
def test_every_phase_reads_the_way_the_front_end_names_it(phase: MarketPhase) -> None:
    assert phase_label(phase) == FRONT_END_LABELS[phase]


def test_every_phase_is_covered() -> None:
    """A phase added later has no label here, and that should fail rather than pass quietly."""
    assert set(FRONT_END_LABELS) == set(MarketPhase)


def test_no_label_leaks_the_stored_spelling() -> None:
    for phase in MarketPhase:
        assert "_" not in phase_label(phase)
