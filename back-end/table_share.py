"""Who asked to share a table with whom, and whether each request can be met (E27).

The one statement of the rule, read by the solver (``assignment/assignment.py``), which seats the
pairs, and by the organizer's applications list (``api/applicants.py``), which says why a request
pairs nobody. Two copies would drift, and the drift would show as the review screen calling a
request fine that the solver then ignored. For the same reason addresses are compared here, in one
spelling, rather than by each caller.

The rule, decided in the November 2026 dry-run map, ticket 08:

- A pair needs both applicants to exist, identified by email, and both to accept a half table:
  half or either, never a whole table only.
- One-way is enough: A naming B pairs them whether or not B named anyone.
- A person's own request outranks a request about them: if A names B and B names C, B's stands.
"""
from dataclasses import dataclass
from enum import Enum
from typing import AbstractSet, Dict, Iterable, List, Optional

from essential_fields import TABLE_CHOICE_FULL


@dataclass(frozen=True)
class ShareRequest:
    """One applicant's side of it: who they are, what table they want, and whom they named."""

    email: str
    table_choice: Optional[str]
    # The address read out of their answer at the write (``essential_fields.partner_address``),
    # or "" when it held none.
    partner: str = ""
    # False once rejected or withdrawn: the solver seats approved applicants only, so nobody is
    # paired with them, and a request naming them must say so rather than look fine.
    taking_part: bool = True

    @property
    def wants_whole_table(self) -> bool:
        return self.table_choice == TABLE_CHOICE_FULL


class Reason(str, Enum):
    NO_ADDRESS = "no_address"
    NO_APPLICANT = "no_applicant"
    PARTNER_WANTS_FULL_TABLE = "partner_wants_full_table"
    PARTNER_NOT_ACCEPTED = "partner_not_accepted"
    PARTNER_ASKED_FOR_SOMEONE_ELSE = "partner_asked_for_someone_else"


@dataclass(frozen=True)
class Unpaired:
    """Why a request pairs nobody, and the address it is about (none when it held no address)."""

    reason: Reason
    address: Optional[str] = None

    def as_payload(self) -> Dict[str, str]:
        payload = {"reason": self.reason.value}
        if self.address is not None:
            payload["address"] = self.address
        return payload


def _spelling(email: str) -> str:
    """Applicant addresses are lowercased at import; this is the spelling they are compared in."""
    return str(email or "").strip().lower()


class _Market:
    """Every request in one market, keyed by address in one spelling."""

    def __init__(self, requests: Iterable[ShareRequest]):
        self.by_address = {_spelling(request.email): request for request in requests}

    def named(self, request: ShareRequest) -> Optional[ShareRequest]:
        """Whom this applicant named, when the two of them could share a table at all."""
        partner = self.by_address.get(_spelling(request.partner))
        if request.wants_whole_table or partner is None or partner is request:
            return None
        return None if partner.wants_whole_table or not partner.taking_part else partner

    def in_force(self) -> Dict[str, ShareRequest]:
        """Every request that stands: one stands when the person it names has no request of their
        own that stands, or named the asker back.

        So in A -> B -> C -> D, C's stands, B's gives way to it, and A's stands again. A ring with no
        such end (A -> B -> C -> A) is broken at its first address, so it still seats a pair.
        """
        stands: Dict[int, bool] = {}
        for request in self.by_address.values():
            self._resolve(request, stands)
        return {
            request.email: self.named(request)
            for request in self.by_address.values() if stands[id(request)]
        }

    def _resolve(self, start: ShareRequest, stands: Dict[int, bool]) -> None:
        path: List[ShareRequest] = []
        position: Dict[int, int] = {}
        request = start
        while id(request) not in stands:
            named = self.named(request)
            if named is None:
                stands[id(request)] = False
                break
            if self.named(named) is request:
                stands[id(request)] = stands[id(named)] = True
                break
            if id(request) in position:
                ring = path[position[id(request)]:]
                first = min(range(len(ring)), key=lambda i: _spelling(ring[i].email))
                for step in range(len(ring)):
                    # Every other request stands, and in a ring of odd length the last one cannot.
                    stands[id(ring[(first + step) % len(ring)])] = (
                        step % 2 == 0 and not (len(ring) % 2 and step == len(ring) - 1)
                    )
                break
            position[id(request)] = len(path)
            path.append(request)
            request = named
        for request in reversed(path):
            if id(request) not in stands:
                stands[id(request)] = not stands[id(self.named(request))]


def requests_in_force(requests: Iterable[ShareRequest]) -> Dict[str, str]:
    """Every request that stands, as ``asker email -> named email``, in the callers' spelling."""
    return {asker: named.email for asker, named in _Market(requests).in_force().items()}


def why_unpaired(
    requests: Iterable[ShareRequest], answered: AbstractSet[str],
) -> Dict[str, Optional[Unpaired]]:
    """Why each applicant's request pairs nobody, or None when it stands or they asked nobody.

    ``answered`` holds the addresses of everyone who answered the question at all, which is what
    tells an answer with no address in it from a question left blank.
    """
    market = _Market(requests)
    in_force = market.in_force()
    asked = {_spelling(email) for email in answered}

    def reason(request: ShareRequest) -> Optional[Unpaired]:
        if (request.wants_whole_table or not request.taking_part
                or _spelling(request.email) not in asked):
            return None
        partner = _spelling(request.partner)
        if not partner:
            return Unpaired(Reason.NO_ADDRESS)
        named = market.by_address.get(partner)
        if named is None or named is request:
            return Unpaired(Reason.NO_APPLICANT, partner)
        if not named.taking_part:
            return Unpaired(Reason.PARTNER_NOT_ACCEPTED, partner)
        if named.wants_whole_table:
            return Unpaired(Reason.PARTNER_WANTS_FULL_TABLE, partner)
        if request.email not in in_force:
            return Unpaired(Reason.PARTNER_ASKED_FOR_SOMEONE_ELSE, partner)
        return None

    return {request.email: reason(request) for request in market.by_address.values()}
