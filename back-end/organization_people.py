"""An organization's people, one map from user id to place (T283, ADR 0025).

An organization keeps its people as ``people``, ``{user_id: "owner" | "admin" | "member"}``, with
exactly one ``"owner"``, so a person has one place by construction. Until every stored organization
is folded into that map, one stored before it still holds only ``owner``, ``admins`` and
``members``, and is read by ``datatypes.organization_people_of``, its lists folded with the owner
winning.

This module builds the one filter that finds the organizations a person is in, ``of_person``, in
either shape; nothing else spells that query. ``people_key`` is the one spelling of a person's path
in the map.
"""
from typing import Any, Dict


def _checked(user_id: Any) -> str:
    """A user id fit to be a key of the map and a part of a dotted path: a non-empty string with
    no ``.`` that does not start with ``$``. Any other is a programming error, never a client's:
    an id reaches here only from a stored account or the stored map, never from request text."""
    if not isinstance(user_id, str) or not user_id or "." in user_id or user_id.startswith("$"):
        raise RuntimeError(f"Not a user id to read an organization's people by: {user_id!r}")
    return user_id


def people_key(user_id: str) -> str:
    """The dotted path of this person's place in the people map."""
    return f"people.{_checked(user_id)}"


def of_person(user_id: str) -> Dict[str, Any]:
    """The filter for the organizations this person owns, administers or belongs to.

    An organization with ``people`` is found by the person's key in it, served by the
    ``people.$**`` wildcard index; one stored before the map, by any of its three lists, each
    indexed. An organization with ``people`` is never found by its lists, which only mirror it.
    """
    key = people_key(user_id)
    unfolded = {"people": {"$exists": False}}
    return {"$or": [
        {key: {"$exists": True}},
        {**unfolded, "owner": user_id},
        {**unfolded, "admins": user_id},
        {**unfolded, "members": user_id},
    ]}
