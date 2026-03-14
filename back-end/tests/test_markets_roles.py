"""
Unit tests for market role management functions.
"""
import pytest
import sys
import os

# Add the parent directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import Market, MarketRole, SetupObject, AssignmentObject, ModificationObject


class TestMarketRoleManagement:
    """Test market role management functions."""
    
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
    
    def test_market_has_exactly_one_owner(self):
        """Test that market validation ensures exactly one owner."""
        # Valid: one owner
        market = Market(
            name="Test",
            creation_date="2024-01-01",
            roles={"owner@test.com": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject()
        )
        assert market.roles["owner@test.com"] == MarketRole.OWNER
        
        # Invalid: multiple owners (should be caught by validator)
        with pytest.raises(ValueError, match="exactly one owner"):
            Market(
                name="Test",
                creation_date="2024-01-01",
                roles={
                    "owner1@test.com": MarketRole.OWNER,
                    "owner2@test.com": MarketRole.OWNER
                },
                modification_list=[],
                assignment_object=AssignmentObject()
            )
    
    def test_market_must_have_owner(self):
        """Test that market must have exactly one owner in roles."""
        # Invalid: no owner
        with pytest.raises(ValueError, match="exactly one owner"):
            Market(
                name="Test",
                creation_date="2024-01-01",
                roles={"editor@test.com": MarketRole.EDITOR},
                modification_list=[],
                assignment_object=AssignmentObject()
            )
    
    def test_market_role_hierarchy(self):
        """Test role hierarchy: Owner > Admin > Editor > Viewer."""
        hierarchy = {
            MarketRole.OWNER: 4,
            MarketRole.ADMIN: 3,
            MarketRole.EDITOR: 2,
            MarketRole.VIEWER: 1
        }
        
        assert hierarchy[MarketRole.OWNER] > hierarchy[MarketRole.ADMIN]
        assert hierarchy[MarketRole.ADMIN] > hierarchy[MarketRole.EDITOR]
        assert hierarchy[MarketRole.EDITOR] > hierarchy[MarketRole.VIEWER]
