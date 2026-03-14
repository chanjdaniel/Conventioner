"""
Unit tests for organization CRUD operations and role management.
"""
import pytest
import sys
import os

# Add the parent directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import Organization


class TestOrganizationStructure:
    """Test organization structure and validation."""
    
    def test_organization_has_owner(self):
        """Test that organization has exactly one owner."""
        org = Organization(
            name="Test Org",
            owner="owner@test.com",
            admins=[],
            members=[],
            markets=[]
        )
        assert org.owner == "owner@test.com"
        assert isinstance(org.admins, list)
        assert isinstance(org.members, list)
    
    def test_organization_owner_not_in_other_roles(self):
        """Test that owner cannot be in admins or members lists."""
        # Valid: owner not in other lists
        org = Organization(
            name="Test Org",
            owner="owner@test.com",
            admins=["admin@test.com"],
            members=["member@test.com"],
            markets=[]
        )
        assert org.owner not in org.admins
        assert org.owner not in org.members
        
        # Invalid: owner in admins (should be caught by validator)
        with pytest.raises(ValueError, match="Owner cannot be in admins"):
            Organization(
                name="Test Org",
                owner="owner@test.com",
                admins=["owner@test.com"],
                members=[],
                markets=[]
            )
        
        # Invalid: owner in members (should be caught by validator)
        with pytest.raises(ValueError, match="Owner cannot be in members"):
            Organization(
                name="Test Org",
                owner="owner@test.com",
                admins=[],
                members=["owner@test.com"],
                markets=[]
            )
    
    def test_organization_role_structure(self):
        """Test organization role structure."""
        org = Organization(
            name="Test Org",
            owner="owner@test.com",
            admins=["admin1@test.com", "admin2@test.com"],
            members=["member1@test.com", "member2@test.com"],
            markets=["Market1", "Market2"]
        )
        
        assert len(org.admins) == 2
        assert len(org.members) == 2
        assert len(org.markets) == 2
        assert "admin1@test.com" in org.admins
        assert "member1@test.com" in org.members
