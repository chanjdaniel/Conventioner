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


def upload_image(image_data: bytes, filename: str) -> str:
    """Store an image in GridFS and return its ObjectId as a string.

    Args:
        image_data: Raw image bytes to store.
        filename: The filename to associate with the stored file.

    Returns:
        The GridFS file's ObjectId as a string.
    """
    file_id = _fs.put(image_data, filename=filename)
    return str(file_id)


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
