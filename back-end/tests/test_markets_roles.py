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
            roles={"owner@example.com": MarketRole.OWNER},
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
            roles={"owner@example.com": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject()
        )
        assert market.roles["owner@example.com"] == MarketRole.OWNER
        
        # Invalid: multiple owners (should be caught by validator)
        with pytest.raises(ValueError, match="exactly one owner"):
            Market(
                name="Test",
                creation_date="2024-01-01",
                roles={
                    "owner1@example.com": MarketRole.OWNER,
                    "owner2@example.com": MarketRole.OWNER
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
                roles={"editor@example.com": MarketRole.EDITOR},
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


class TestTheOwnerRefusalsNameTransferringOwnership:
    """A market has one Owner, and it changes only when ownership is transferred (T283, T315).

    The refusals that meet the Owner role name that action as Manage market names it, "transfer
    ownership", so the product names one action one way.
    """

    @pytest.fixture
    def market(self, monkeypatch):
        from conftest import FakeMarketsCollection, stored_market
        import api.markets as MarketsApi
        import api.permissions as PermissionsApi

        fake = FakeMarketsCollection(
            stored_market(roles={"user-owner": "owner", "user-admin": "admin"}))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)
        return MarketsApi

    def test_adding_an_owner_to_a_market_that_has_one(self, market):
        from client_errors import BadRequestError

        with pytest.raises(BadRequestError) as refused:
            market.add_market_role(
                "market-123", "new@example.com", MarketRole.OWNER, "owner@example.com")
        assert str(refused.value) == (
            "This market already has an Owner. To make someone else its Owner, "
            "transfer ownership to them.")

    def test_changing_someone_to_owner_while_the_market_has_one(self, market):
        from client_errors import BadRequestError

        with pytest.raises(BadRequestError) as refused:
            market.update_market_role(
                "market-123", "user-admin", MarketRole.OWNER, "owner@example.com")
        assert str(refused.value) == (
            "This market already has an Owner. To make someone else its Owner, "
            "transfer ownership to them.")

    def test_removing_the_only_owner(self, market):
        from client_errors import BadRequestError

        with pytest.raises(BadRequestError) as refused:
            market.remove_market_role("market-123", "user-owner", "owner@example.com")
        assert str(refused.value) == (
            "The market's only Owner can't be removed. Transfer ownership first.")
