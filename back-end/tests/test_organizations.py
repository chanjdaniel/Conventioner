"""
Unit tests for organization CRUD operations and role management.
"""
import pytest
import sys
import os
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import Organization


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

    def test_organization_owner_not_in_other_roles(self):
        """Test that owner cannot be in admins or members lists."""
        org = Organization(
            id=_new_id(),
            name="Test Org",
            owner="owner-id",
            admins=["admin-id"],
            members=["member-id"],
            markets=[]
        )
        assert org.owner not in org.admins
        assert org.owner not in org.members

        with pytest.raises(ValueError, match="Owner cannot be in admins"):
            Organization(
                id=_new_id(),
                name="Test Org",
                owner="owner-id",
                admins=["owner-id"],
                members=[],
                markets=[]
            )

        with pytest.raises(ValueError, match="Owner cannot be in members"):
            Organization(
                id=_new_id(),
                name="Test Org",
                owner="owner-id",
                admins=[],
                members=["owner-id"],
                markets=[]
            )

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
