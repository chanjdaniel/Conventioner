"""What a reviewer reads first, as a decision a draft must have taken before it enters Review (T206).

The list (``Market.review_highlights``) is written by ``save_review_highlights`` in the markets API,
which keeps any key the organizer marked: a mark may outlive its question, so a key on the list is
not by itself an answer the card can lead with. This module says which marks still lead with
something, and so whether the organizer has decided: the one statement the guard on leaving draft
(``ReviewHighlightsDecidedGuard``) reads, kept out of the markets API so the guards can import it.
"""
from typing import List

import essential_fields as EssentialFields
from datatypes import Market


def live_highlights(market: Market) -> List[str]:
    """The marked keys that name an answer the market asks: a field of its form, or an essential
    question its offering asks (``asked_essential_keys``), in the order they were marked."""
    form = market.application_form
    asked = {field.key for field in (form.fields if form else [])}
    asked |= EssentialFields.asked_essential_keys(
        EssentialFields.effective_essential_options_for_market(market))
    return [key for key in market.review_highlights or [] if key in asked]


def highlights_decided(market: Market) -> bool:
    """Whether the organizer has decided what a reviewer reads first: chosen that nothing leads the
    card, or marked an answer the market asks. An empty list is nobody having asked, and a mark on a
    question the form no longer asks would lead the card with nothing."""
    return market.nothing_leads_the_card or bool(live_highlights(market))
