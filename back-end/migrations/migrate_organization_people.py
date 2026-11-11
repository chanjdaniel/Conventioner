#!/usr/bin/env python3
"""Fold every stored organization's three lists of people into its one map (T283, ADR 0025).

Why: an organization keeps its people as ``people``, one map from user id to ``owner``, ``admin``
or ``member``, so a person has one place. One stored before that map holds only ``owner``,
``admins`` and ``members``, where a person could stand in two lists; the release before the map
refused an organization whose owner was also an admin or a member, and every admin and member of it
lost their role on its markets. The build that ships the map reads such an organization by folding
its lists, the owner winning (``datatypes.organization_people_of``), and the first change to its
people folds it in; this writes the fold for the rest, so every organization holds its map.

What it writes, each organization with no ``people`` in one update conditional on what it read
(``people`` absent and ``owner``, ``admins`` and ``members`` as read, as a change's write holds,
``organization_people.folding_write``):

- ``people``, the fold of its lists (``datatypes.people_from_lists``): the owner, then each admin
  not yet placed, then each member not yet placed, in list order;
- ``owner``, ``admins`` and ``members`` as the fold's mirror, which the build keeps for a rollback
  to the release before it: no id twice, and the owner in neither list.

An organization with no owner is left as it is and listed, as is one holding an id that cannot be
a key of the map; one whose write matches nothing changed while this ran, is listed, and is folded
by running this again.

Safe to run repeatedly: a second run finds nothing to fold. ``--dry-run`` writes nothing and prints
each organization it would fold, what it holds, whether it does not parse today (its owner also an
admin or a member) and whether an admin is also listed as a member, then the counts.

Run it after the deploy that ships the map, whenever the operator likes, never before it: the build
before changes only the lists, so a map written earlier goes stale under its writes, and the build
after reads the map over the lists. That build reads both shapes, so the boot does not wait for it.

Usage, from ``back-end/`` (the production database address passed inline, never from ``.env``):
    MONGODB_URI='<production URI>' python migrations/migrate_organization_people.py --dry-run
    MONGODB_URI='<production URI>' python migrations/migrate_organization_people.py
"""
import argparse
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import OrganizationRole, people_from_lists  # noqa: E402
from organization_people import folding_write  # noqa: E402


def _ids(value: Any) -> List[Any]:
    return list(value) if isinstance(value, list) else []


def flags_of(doc: Dict[str, Any]) -> List[str]:
    """What the dry run says of a stored organization's lists beyond what they fold to."""
    owner, admins, members = doc.get("owner"), _ids(doc.get("admins")), _ids(doc.get("members"))
    flags = []
    if owner and (owner in admins or owner in members):
        flags.append("does not parse today")
    if set(admins) & set(members) - {owner}:
        flags.append("an admin also listed as a member")
    return flags


def _holds(people: Dict[str, str]) -> str:
    places = list(people.values())
    return (f"one owner, {places.count(OrganizationRole.ADMIN.value)} admin(s), "
            f"{places.count(OrganizationRole.MEMBER.value)} member(s)")


def migrate(db, dry_run: bool = False) -> Dict[str, int]:
    """Fold every organization, or say what would be folded. Returns the counts it printed."""
    organizations = db.organizations
    counts = {"folded": 0, "already_folded": 0, "does_not_parse": 0, "admin_also_member": 0,
              "no_owner": 0, "not_a_key": 0, "changed": 0}
    for doc in organizations.find({}):
        if "people" in doc:
            counts["already_folded"] += 1
            continue
        name = f"{doc.get('id')} {doc.get('name')!r}"
        people = people_from_lists(doc.get("owner"), doc.get("admins"), doc.get("members"))
        if not doc.get("owner"):
            counts["no_owner"] += 1
            print(f"  ! {name}: has no owner; left as it is")
            continue
        try:
            query, update = folding_write(doc, people)
        except RuntimeError:
            counts["not_a_key"] += 1
            print(f"  ! {name}: holds an id that cannot be a key of its people; left as it is")
            continue
        flags = flags_of(doc)
        counts["does_not_parse"] += "does not parse today" in flags
        counts["admin_also_member"] += "an admin also listed as a member" in flags
        print(f"  - {name}: {_holds(people)}" + (f" ({'; '.join(flags)})" if flags else ""))
        if dry_run:
            counts["folded"] += 1
            continue
        if organizations.update_one(query, update).matched_count:
            counts["folded"] += 1
        else:
            counts["changed"] += 1
            print(f"  ! {name}: changed during the run; run again")

    skipped = counts["no_owner"] + counts["not_a_key"] + counts["changed"]
    print(f"\n{'Would fold' if dry_run else 'Folded'} {counts['folded']} organization(s) into "
          f"their map of people; {counts['already_folded']} already folded.")
    print(f"Of those to fold, {counts['does_not_parse']} do not parse today (an owner also an "
          f"admin or a member) and {counts['admin_also_member']} list an admin also as a member.")
    print(f"Skipped {skipped}: {counts['no_owner']} with no owner, {counts['not_a_key']} holding "
          f"an id that cannot be a key, {counts['changed']} changed during the run.")
    if not counts["folded"] and not skipped:
        print("Nothing to fold: the migration has already run.")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="Say what would be folded; write nothing")
    args = parser.parse_args()

    from db_config import get_database

    migrate(get_database(), dry_run=args.dry_run)


if __name__ == "__main__":
    main()
