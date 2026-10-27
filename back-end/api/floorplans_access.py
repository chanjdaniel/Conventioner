"""
The one place a floorplan route decides who may use it.

Every floorplan action is checked against the caller's role on the floorplan's market: a route that
names a market checks that market, and a route that takes an image id checks the market the image
was uploaded for. Each function answers None when the caller may go on, or the refusal to answer
with (a JSON body and a status), in the order save-to-market answers: unknown market or image 404,
then no role 403, then an archived market 403 for a route that changes something.

Call these only from a route carrying ``@login_required``.
"""

from typing import Any, Dict, Optional, Tuple

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import MarketRole
from services.gridfs_service import get_image_market_id
from utils.identity import authenticated_email

Refusal = Tuple[Dict[str, Any], int]

_WHAT_THE_ROLE_ALLOWS = {MarketRole.VIEWER: "view", MarketRole.EDITOR: "edit"}


def market_refusal(
    market_id: Optional[str], required_role: MarketRole, *, edits: bool
) -> Optional[Refusal]:
    """Why the caller may not use a floorplan route on this market, or None when they may.

    ``edits`` marks a route that changes the market's floorplan, which an archived market refuses.
    """
    if not market_id:
        return {"error": "market_id is required"}, 400

    context = MarketsApi.load_market_context(market_id)
    if context is None:
        return {"error": "Market not found"}, 404
    if context.market is None:
        return {"error": "Invalid market data"}, 400

    if not PermissionsApi.user_has_permission(
        authenticated_email(), context.market, required_role, context.organization
    ):
        action = _WHAT_THE_ROLE_ALLOWS[required_role]
        return {"error": f"User does not have permission to {action} this market"}, 403

    if edits:
        archived = MarketsApi.archived_refusal(context.market)
        if archived:
            return {"error": archived}, 403
    return None


def image_refusal(
    gridfs_id: Optional[str], required_role: MarketRole, *, edits: bool
) -> Optional[Refusal]:
    """Why the caller may not use a floorplan route on this image, or None when they may.

    The image is checked against the market it was uploaded for. An unknown image and an image
    stored without a market both answer "Image not found": no route treats an unowned image as
    anyone's.
    """
    market_id = get_image_market_id(gridfs_id) if gridfs_id else None
    if market_id is None:
        return {"error": "Image not found"}, 404
    return market_refusal(market_id, required_role, edits=edits)
