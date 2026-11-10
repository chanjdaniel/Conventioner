"""A deleted market takes its floorplan images (bug 47's last record kind).

Each image a market's floorplan uploads is stored in GridFS with ``metadata.marketId`` naming the
market, and nothing outside the market points at it (a template holds no image id), so an image
left behind when its market goes is a file nobody can reach any more.
"""
from types import SimpleNamespace

import market_deletion
import services.gridfs_service as GridfsService


def _markets():
    return SimpleNamespace(delete_one=lambda _q: SimpleNamespace(deleted_count=1))


def test_deleting_a_market_deletes_its_floorplan_images(market_records):
    hall = GridfsService.upload_image(b"hall", "hall.png", "m1")
    annex = GridfsService.upload_image(b"annex", "annex.png", "m1")
    other = GridfsService.upload_image(b"other", "other.png", "m2")

    market_deletion.delete_market_and_records(_markets(), "m1")

    assert GridfsService.get_image(hall) is None
    assert GridfsService.get_image(annex) is None
    assert GridfsService.get_image(other) == b"other"


def test_a_market_with_no_images_is_deleted_all_the_same(market_records):
    other = GridfsService.upload_image(b"other", "other.png", "m2")

    result = market_deletion.delete_market_and_records(_markets(), "m1")

    assert result.deleted_count == 1
    assert GridfsService.get_image(other) == b"other"
