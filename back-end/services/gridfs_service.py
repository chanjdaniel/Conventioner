"""
GridFS storage service for floorplan images.

Provides upload, retrieval, and deletion of images using MongoDB GridFS
with the same MongoDB connection used by the rest of the application.
"""

from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from gridfs import GridFS
from gridfs.errors import NoFile

from db_config import get_database

# Reuse the same MongoDB connection pattern as the rest of the codebase
_db = get_database()
_fs = GridFS(_db, collection="floorplan_images")


def upload_image(image_data: bytes, filename: str, market_id: str) -> str:
    """Store an image in GridFS for a market and return its ObjectId as a string.

    Args:
        image_data: Raw image bytes to store.
        filename: The filename to associate with the stored file.
        market_id: The market the image is uploaded for, kept as ``metadata.marketId`` so every
            later action on the image is checked against that market.

    Returns:
        The GridFS file's ObjectId as a string.
    """
    file_id = _fs.put(image_data, filename=filename, metadata={"marketId": market_id})
    return str(file_id)


def get_image_market_id(gridfs_id: str) -> Optional[str]:
    """The id of the market an image was uploaded for.

    Returns None for an id that is not an ObjectId, an image that does not exist, and an image
    stored without a market (uploaded before images named one), so all three read the same.
    """
    try:
        oid = ObjectId(gridfs_id)
    except (InvalidId, TypeError):
        return None

    grid_out = _fs.find_one({"_id": oid})
    if grid_out is None:
        return None
    market_id = (grid_out.metadata or {}).get("marketId")
    return market_id if isinstance(market_id, str) and market_id else None


def get_image(gridfs_id: str) -> Optional[bytes]:
    """Retrieve an image from GridFS by its ObjectId string.

    Args:
        gridfs_id: The string representation of the GridFS file's ObjectId.

    Returns:
        The image bytes if found, or None if the id is invalid
        or the file does not exist.
    """
    try:
        oid = ObjectId(gridfs_id)
    except InvalidId:
        return None

    try:
        grid_out = _fs.get(oid)
        return grid_out.read()
    except NoFile:
        return None


def delete_image(gridfs_id: str) -> bool:
    """Delete an image from GridFS by its ObjectId string.

    Args:
        gridfs_id: The string representation of the GridFS file's ObjectId.

    Returns:
        True if the file was deleted, False if the id was invalid
        or the file did not exist.
    """
    try:
        oid = ObjectId(gridfs_id)
    except InvalidId:
        return False

    try:
        _fs.delete(oid)
        return True
    except NoFile:
        return False
