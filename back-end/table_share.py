"""Who asked to share a table with whom, and whether each request can be met (E27).

The one statement of the rule, read by the solver (``assignment/assignment.py``), which seats the
pairs, and by the organizer's applications list (``api/applicants.py``), which says why a request
pairs nobody. Two copies would drift, and the drift would show as the review screen calling a
request fine that the solver then ignored.

The rule, decided in the November 2026 dry-run map, ticket 08:

- A pair needs both applicants to exist, identified by email, and both to accept a half table:
  half or either, never a whole table only.
- One-way is enough: A naming B pairs them whether or not B named anyone.
- A person's own request outranks a request about them: if A names B and B names C, B's stands.

Addresses are compared as stored: the write (``essential_fields.partner_address``) reads the
address out of the applicant's words and lowercases it, as applicant addresses are lowercased at
import.
"""
from dataclasses import dataclass
from typing import Dict, Mapping, Optional

from essential_fields import TABLE_CHOICE_FULL

NO_ADDRESS = "no_address"
NO_APPLICANT = "no_applicant"
PARTNER_WANTS_FULL_TABLE = "partner_wants_full_table"
PARTNER_ASKED_FOR_SOMEONE_ELSE = "partner_asked_for_someone_else"


@dataclass(frozen=True)
class ShareRequest:
    """One applicant's side of it: what table they want, and the address their answer named."""

    table_choice: Optional[str]
    partner: str = ""
    # Whether they answered the question at all, to tell "no address in it" from "left blank".
    answered: bool = False

    @property
    def wants_whole_table(self) -> bool:
        return self.table_choice == TABLE_CHOICE_FULL


def _named(email: str, requests: Mapping[str, ShareRequest]) -> Optional[str]:
    """Who this applicant named, when the two of them could share a table at all."""
    request = requests[email]
    partner = request.partner
    if request.wants_whole_table or not partner or partner == email:
        return None
    if partner not in requests or requests[partner].wants_whole_table:
        return None
    return partner


def requests_in_force(requests: Mapping[str, ShareRequest]) -> Dict[str, str]:
    """Every request that stands, as ``asker -> the one they named``.

    ``requests`` is keyed by applicant email and holds everyone who could be paired.
    """
    in_force = {}
    for email in requests:
        named = _named(email, requests)
        if named is None:
            continue
        theirs = _named(named, requests)
        if theirs is None or theirs == email:
            in_force[email] = named
    return in_force


def why_unpaired(requests: Mapping[str, ShareRequest]) -> Dict[str, Optional[Dict[str, str]]]:
    """Why each applicant's request pairs nobody: a reason and the address it is about, or None
    when it stands or they asked for nobody. The screens word it.
    """
    in_force = requests_in_force(requests)

    def reason(email: str) -> Optional[Dict[str, str]]:
        request = requests[email]
        if request.wants_whole_table or not request.answered:
            return None
        partner = request.partner
        if not partner:
            return {"reason": NO_ADDRESS}
        if partner == email or partner not in requests:
            return {"reason": NO_APPLICANT, "address": partner}
        if requests[partner].wants_whole_table:
            return {"reason": PARTNER_WANTS_FULL_TABLE, "address": partner}
        if email not in in_force:
            return {"reason": PARTNER_ASKED_FOR_SOMEONE_ELSE, "address": partner}
        return None

    return {email: reason(email) for email in requests}
