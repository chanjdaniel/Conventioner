"""
Unit tests for permission resolution logic.
"""
import pytest
import sys
import os

# Add the parent directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import Market, MarketRole, Organization, SetupObject, AssignmentObject, ModificationObject
from api.permissions import (
    get_user_market_role,
    user_has_permission,
    can_manage_roles,
    get_user_organizations
)


class TestPermissionResolution:
    """Test permission resolution functions."""
    
    @pytest.fixture
    def sample_market(self):
        """Create a sample market for testing."""
        return Market(
            name="Test Market",
            creation_date="2024-01-01",
            roles={"owner@test.com": MarketRole.OWNER},
            organization=None,
            theme=None,
            setup_object=None,
            modification_list=[],
            assignment_object=AssignmentObject()
        )
    
    @pytest.fixture
    def sample_organization(self):
        """Create a sample organization for testing."""
        return Organization(
            name="Test Org",
            owner="org_owner@test.com",
            admins=["admin@test.com"],
            members=["member@test.com"],
            markets=["Test Market"],
            theme=None
        )
    
    def test_get_user_market_role_explicit(self, sample_market):
        """Test getting explicit market role."""
        role = get_user_market_role("owner@test.com", sample_market)
        assert role == MarketRole.OWNER
    
    def test_get_user_market_role_no_access(self, sample_market):
        """Test getting role when user has no access."""
        role = get_user_market_role("unknown@test.com", sample_market)
        assert role is None
    
    def test_get_user_market_role_organization_access(self, sample_market, sample_organization):
        """Test getting role via organization membership."""
        sample_market.organization = "Test Org"
        sample_market.roles = {}  # No explicit role
        
        # Member should get VIEWER role
        role = get_user_market_role("member@test.com", sample_market, sample_organization)
        assert role == MarketRole.VIEWER
    
    def test_user_has_permission_owner(self, sample_market):
        """Test permission check for owner."""
        sample_market.roles = {
            "user@test.com": MarketRole.OWNER
        }
        assert user_has_permission("user@test.com", sample_market, MarketRole.VIEWER)
        assert user_has_permission("user@test.com", sample_market, MarketRole.EDITOR)
        assert user_has_permission("user@test.com", sample_market, MarketRole.ADMIN)
        assert user_has_permission("user@test.com", sample_market, MarketRole.OWNER)
    
    def test_user_has_permission_viewer(self, sample_market):
        """Test permission check for viewer."""
        sample_market.roles = {
            "user@test.com": MarketRole.VIEWER
        }
        assert user_has_permission("user@test.com", sample_market, MarketRole.VIEWER)
        assert not user_has_permission("user@test.com", sample_market, MarketRole.EDITOR)
        assert not user_has_permission("user@test.com", sample_market, MarketRole.ADMIN)
        assert not user_has_permission("user@test.com", sample_market, MarketRole.OWNER)
    
    def test_can_manage_roles_owner(self, sample_market):
        """Test role management permission for owner."""
        sample_market.roles = {
            "user@test.com": MarketRole.OWNER
        }
        assert can_manage_roles("user@test.com", sample_market, MarketRole.OWNER)
        assert can_manage_roles("user@test.com", sample_market, MarketRole.ADMIN)
        assert can_manage_roles("user@test.com", sample_market, MarketRole.EDITOR)
        assert can_manage_roles("user@test.com", sample_market, MarketRole.VIEWER)
    
    def test_can_manage_roles_admin(self, sample_market):
        """Test role management permission for admin."""
        sample_market.roles = {
            "user@test.com": MarketRole.ADMIN
        }
        assert not can_manage_roles("user@test.com", sample_market, MarketRole.OWNER)
        assert not can_manage_roles("user@test.com", sample_market, MarketRole.ADMIN)
        assert can_manage_roles("user@test.com", sample_market, MarketRole.EDITOR)
        assert can_manage_roles("user@test.com", sample_market, MarketRole.VIEWER)
    
    def test_can_manage_roles_editor(self, sample_market):
        """Test role management permission for editor."""
        sample_market.roles = {
            "user@test.com": MarketRole.EDITOR
        }
        assert not can_manage_roles("user@test.com", sample_market, MarketRole.OWNER)
        assert not can_manage_roles("user@test.com", sample_market, MarketRole.ADMIN)
        assert not can_manage_roles("user@test.com", sample_market, MarketRole.EDITOR)
        assert not can_manage_roles("user@test.com", sample_market, MarketRole.VIEWER)
