"""
Unit tests for organization CRUD operations and role management.
"""
import pytest
import sys
import os
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import Organization, organization_people_of, people_from_lists


def _new_id() -> str:
    return str(uuid.uuid4())


class TestOrganizationStructure:
    """Test organization structure and validation."""

    def test_organization_has_owner(self):
        """Test that organization has exactly one owner."""
        org = Organization(
            id=_new_id(),
            name="Test Org",
            owner="owner-id",
            admins=[],
            members=[],
            markets=[]
        )
        assert org.owner == "owner-id"
        assert isinstance(org.admins, list)
        assert isinstance(org.members, list)

    def test_an_owner_also_in_admins_or_members_parses_with_the_owner_winning(self):
        """Stored before the people map, an organization whose owner also stood in ``admins`` or
        ``members`` failed the model and granted nothing on its markets (T283): it parses now."""
        org = Organization(
            id=_new_id(), name="Test Org", owner="owner-id",
            admins=["owner-id", "admin-id"], members=["owner-id", "member-id"], markets=[],
        )

        assert org.people == {"owner-id": "owner", "admin-id": "admin", "member-id": "member"}
        assert (org.owner, org.admins, org.members) == ("owner-id", ["admin-id"], ["member-id"])

    def test_an_admin_also_listed_as_a_member_is_an_admin_once(self):
        org = Organization(
            id=_new_id(), name="Test Org", owner="owner-id",
            admins=["admin-id"], members=["admin-id", "member-id"], markets=[],
        )

        assert org.admins == ["admin-id"]
        assert org.members == ["member-id"]

    def test_a_people_map_overrides_the_lists(self):
        org = Organization(
            id=_new_id(), name="Test Org",
            people={"new-owner": "owner", "old-owner": "admin", "member-id": "member"},
            owner="old-owner", admins=["new-owner"], members=[], markets=[],
        )

        assert (org.owner, org.admins, org.members) == ("new-owner", ["old-owner"], ["member-id"])

    def test_the_lists_follow_the_maps_order(self):
        org = Organization(
            id=_new_id(), name="Test Org", markets=[],
            people={"b": "admin", "owner-id": "owner", "c": "member", "a": "admin"},
        )

        assert org.admins == ["b", "a"]
        assert org.members == ["c"]

    @pytest.mark.parametrize("people", [
        {"admin-id": "admin", "member-id": "member"},
        {"one": "owner", "two": "owner"},
        {},
    ])
    def test_a_map_with_no_owner_or_two_is_refused(self, people):
        with pytest.raises(ValueError, match="An organization has exactly one owner"):
            Organization(id=_new_id(), name="Test Org", people=people, markets=[])

    def test_lists_with_no_owner_are_refused(self):
        with pytest.raises(ValueError, match="An organization has exactly one owner"):
            Organization(id=_new_id(), name="Test Org", owner="", admins=["a"], markets=[])

    def test_a_place_that_is_not_one_of_the_three_is_refused(self):
        with pytest.raises(ValueError):
            Organization(
                id=_new_id(), name="Test Org", markets=[],
                people={"owner-id": "owner", "someone": "superuser"},
            )

    def test_a_people_that_is_not_a_map_is_refused(self):
        with pytest.raises(ValueError):
            Organization(id=_new_id(), name="Test Org", markets=[], people=["owner-id"])


    def test_organization_role_structure(self):
        """Test organization role structure."""
        org = Organization(
            id=_new_id(),
            name="Test Org",
            owner="owner-id",
            admins=["admin1-id", "admin2-id"],
            members=["member1-id", "member2-id"],
            markets=["market1-id", "market2-id"]
        )

        assert len(org.admins) == 2
        assert len(org.members) == 2
        assert len(org.markets) == 2
        assert "admin1-id" in org.admins
        assert "member1-id" in org.members


class TestTheFold:
    """``people_from_lists`` and ``organization_people_of``, the one rule every reader reads by."""

    def test_the_owner_then_the_admins_then_the_members_in_list_order(self):
        assert list(people_from_lists("o", ["a2", "a1"], ["m2", "m1"]).items()) == [
            ("o", "owner"), ("a2", "admin"), ("a1", "admin"), ("m2", "member"), ("m1", "member"),
        ]

    def test_the_owner_wins_over_both_lists(self):
        assert people_from_lists("o", ["o"], ["o"]) == {"o": "owner"}

    def test_an_admin_wins_over_the_members(self):
        assert people_from_lists("o", ["a"], ["a", "m"]) == {"o": "owner", "a": "admin", "m": "member"}

    def test_a_person_listed_twice_in_one_list_is_placed_once(self):
        assert people_from_lists("o", ["a", "a"], []) == {"o": "owner", "a": "admin"}

    @pytest.mark.parametrize("not_a_list", [None, "a", {"a": 1}, 3])
    def test_a_value_that_is_not_a_list_reads_as_empty(self, not_a_list):
        assert people_from_lists("o", not_a_list, not_a_list) == {"o": "owner"}

    @pytest.mark.parametrize("owner", [None, ""])
    def test_no_owner_gives_a_map_with_no_owner(self, owner):
        assert people_from_lists(owner, ["a"], ["m"]) == {"a": "admin", "m": "member"}

    def test_a_document_with_people_reads_its_map(self):
        people = {"x": "owner", "o": "admin"}
        assert organization_people_of({"people": people, "owner": "o", "admins": ["x"]}) == people

    def test_a_document_without_people_reads_its_lists_folded(self):
        assert organization_people_of({"owner": "o", "admins": ["o", "a"]}) == {
            "o": "owner", "a": "admin"}

    def test_a_document_missing_its_lists_reads_its_owner_alone(self):
        assert organization_people_of({"owner": "o"}) == {"o": "owner"}
