"""A vendor who never applied, added by hand on the day (E36/F03/S01).

A walk-in, or a late arrangement, was once seated by typing an address into a seat: no name, no
answers, nothing in the vendor drawer. A seat now goes only to an applicant (E36/F02/S01), and this
is how someone becomes one without applying: an organizer records a name and an address, and the
application says who added it and when.

An added vendor is approved by the act of adding, and is never an input to the run: their answers
may be missing, and a missing answer refuses every run. They are seated by hand, as a vendor the
run holds a seat for (`held_vendors_for`).
"""
from datetime import datetime, timezone
from typing import Any, Dict, Tuple

import api.applications as ApplicationsApi
import api.markets as MarketsApi
import essential_fields as EssentialFields
from assignment.utils import convert_keys_to_camel_case
from client_errors import BadRequestError, ConflictError
from datatypes import Application, ApplicationStatus, MarketPerson, MarketRole
from utils.email_address import normalized_email

class AddVendorRefused(ConflictError, ValueError):
    """The market cannot take this vendor now: its phase, or an address it already holds. A 409.

    Still a ``ValueError`` until no route catches one to answer it."""


class AddVendorInvalid(BadRequestError):
    """The request names no vendor that could be recorded. A 400."""


def add_vendor(
    market_id: str, data: Dict[str, Any], adder: MarketPerson,
) -> Tuple[Dict[str, Any], int]:
    """Record a vendor who never applied: their name, their address, and who added them."""
    market = MarketsApi._load_market_to_change(
        market_id, adder.email, MarketRole.EDITOR, "add a vendor to")
    refused = MarketsApi.adding_refusal(market.phase)
    if refused:
        raise AddVendorRefused(refused)

    name = str(data.get("name") or "").strip()
    address = normalized_email(data.get("email"))
    if not name:
        raise AddVendorInvalid("Give the vendor's name.")
    if "@" not in address or " " in address:
        raise AddVendorInvalid("Give the vendor's email address.")
    if ApplicationsApi.find_application_by_email(market_id, address) is not None:
        raise AddVendorRefused(
            f"{address} already has an application in this market. Seat them on the Result page."
        )

    now = datetime.now(timezone.utc).isoformat()
    application = ApplicationsApi.find_or_create_application(Application(
        market_id=market_id,
        applicant_email=address,
        form_data={EssentialFields.FULL_NAME_KEY: name},
        status=ApplicationStatus.REVIEWER_APPROVED,
        verdict_by=adder.as_giver(),
        verdict_at=now,
        added_by=adder,
        added_at=now,
    ))
    return {"application": convert_keys_to_camel_case(application.model_dump())}, 201
