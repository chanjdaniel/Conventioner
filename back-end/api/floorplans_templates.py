"""
Floorplan Template CRUD endpoints.

Uses MongoDB collection ``floorplan_templates`` with camelCase keys.
Templates store table-type presets and aisle configuration that can be
reused across floorplan layouts.
"""

import uuid
import logging
from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_login import login_required
from bson import ObjectId

from db_config import get_database

logger = logging.getLogger(__name__)

db = get_database()
templates_collection = db["floorplan_templates"]
organizations_collection = db["organizations"]

floorplans_templates_bp = Blueprint("floorplans_templates", __name__)

# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_request_user():
    """Resolve the authenticated user from the X-Owner-Email header.

    Returns a dict with user info or None.
    """
    email = request.headers.get("X-Owner-Email")
    if not email:
        return None
    users_collection = db["users"]
    user_doc = users_collection.find_one({"email": email})
    if user_doc:
        user_doc["_id"] = str(user_doc["_id"])
    return user_doc


def _doc_to_response(doc: dict) -> dict:
    """Convert a MongoDB document to an API-safe response dict."""
    doc["_id"] = str(doc["_id"])
    return doc


def _check_ownership(template_doc: dict, requesting_user) -> bool:
    """Return True if *requesting_user* is allowed to modify the template.

    Allowed if:
    - user is the template's ``ownerUserId``, OR
    - the template has an ``organizationId`` and the user is the org owner.
    """
    if not requesting_user:
        return False

    if template_doc.get("ownerUserId") == requesting_user.get("id"):
        return True

    org_id = template_doc.get("organizationId")
    if org_id:
        org = organizations_collection.find_one({"id": org_id})
        if org and org.get("owner") == requesting_user.get("id"):
            return True

    return False


# ── POST /templates ─────────────────────────────────────────────────────────

@floorplans_templates_bp.route("/templates", methods=["POST"])
@login_required
def create_template():
    """Create a new floorplan template.

    Expects JSON body with:
    - **name** (required, str)
    - **tableTypes** (list of dicts, default [])
    - **aisles** (dict, default {})
    - **organizationId** (optional, str)

    The ``ownerUserId`` is set from the current authenticated user.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        name = data.get("name")
        if not name:
            return jsonify({"error": "Template name is required"}), 400

        user = _get_request_user()
        if not user:
            return jsonify({"error": "User not found"}), 401

        template_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        doc = {
            "id": template_id,
            "name": name,
            "ownerUserId": user.get("id"),
            "organizationId": data.get("organizationId"),
            "tableTypes": data.get("tableTypes", []),
            "aisles": data.get("aisles", {
                "wallBufferMm": 1500.0,
                "tableSpacingMm": 1200.0,
                "walkwayWidthMm": 2000.0,
            }),
            "createdAt": now,
            "updatedAt": now,
        }

        result = templates_collection.insert_one(doc)
        doc["_id"] = str(result.inserted_id)

        return jsonify({
            "message": "Template created successfully",
            "template": doc,
        }), 201

    except Exception as exc:
        logger.error(f"Error creating template: {exc}")
        return jsonify({"error": "Internal server error"}), 500


# ── GET /templates ──────────────────────────────────────────────────────────

@floorplans_templates_bp.route("/templates", methods=["GET"])
@login_required
def list_templates():
    """List templates accessible to the current user.

    Query params:
    - **organizationId** — filter by organization ID (requires org membership)
    """
    try:
        user = _get_request_user()
        if not user:
            return jsonify({"error": "User not found"}), 401

        org_id = request.args.get("organizationId")
        if org_id:
            org = organizations_collection.find_one({"id": org_id})
            if not org:
                return jsonify({"error": "Organization not found"}), 404
            owner_id = org.get("owner")
            members = org.get("members", [])
            admins = org.get("admins", [])
            user_id = user.get("id")
            if user_id != owner_id and user_id not in members and user_id not in admins:
                return jsonify({"error": "User does not belong to this organization"}), 403
            query = {"organizationId": org_id}
        else:
            query = {"ownerUserId": user.get("id")}

        cursor = templates_collection.find(query)
        templates = [_doc_to_response(doc) for doc in cursor]

        return jsonify({"templates": templates}), 200

    except Exception as exc:
        logger.error(f"Error listing templates: {exc}")
        return jsonify({"error": "Internal server error"}), 500


# ── GET /templates/<template_id> ────────────────────────────────────────────

@floorplans_templates_bp.route("/templates/<template_id>", methods=["GET"])
@login_required
def get_template(template_id: str):
    """Get a single template by its UUID id. Requires ownership or org membership."""
    try:
        doc = templates_collection.find_one({"id": template_id})
        if not doc:
            return jsonify({"error": "Template not found"}), 404

        user = _get_request_user()
        if not _check_ownership(doc, user):
            return jsonify({"error": "You do not have permission to view this template"}), 403

        return jsonify({"template": _doc_to_response(doc)}), 200

    except Exception as exc:
        logger.error(f"Error getting template {template_id}: {exc}")
        return jsonify({"error": "Internal server error"}), 500


# ── PUT /templates/<template_id> ────────────────────────────────────────────

@floorplans_templates_bp.route("/templates/<template_id>", methods=["PUT"])
@login_required
def update_template(template_id: str):
    """Update an existing template.  Requires ownership.

    Accepts JSON body with any updatable fields:
    - **name**, **tableTypes**, **aisles**, **organizationId**
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        doc = templates_collection.find_one({"id": template_id})
        if not doc:
            return jsonify({"error": "Template not found"}), 404

        user = _get_request_user()
        if not _check_ownership(doc, user):
            return jsonify({"error": "You do not have permission to update this template"}), 403

        # Build the $set payload from allowed fields only
        allowed_fields = {"name", "tableTypes", "aisles", "organizationId"}
        updates = {k: v for k, v in data.items() if k in allowed_fields}
        updates["updatedAt"] = datetime.now().isoformat()

        if not updates:
            return jsonify({"error": "No updatable fields provided"}), 400

        result = templates_collection.update_one(
            {"id": template_id},
            {"$set": updates},
        )

        return jsonify({
            "message": "Template updated successfully",
            "modified_count": result.modified_count,
        }), 200

    except Exception as exc:
        logger.error(f"Error updating template {template_id}: {exc}")
        return jsonify({"error": "Internal server error"}), 500


# ── DELETE /templates/<template_id> ─────────────────────────────────────────

@floorplans_templates_bp.route("/templates/<template_id>", methods=["DELETE"])
@login_required
def delete_template(template_id: str):
    """Delete a template.  Requires ownership."""
    try:
        doc = templates_collection.find_one({"id": template_id})
        if not doc:
            return jsonify({"error": "Template not found"}), 404

        user = _get_request_user()
        if not _check_ownership(doc, user):
            return jsonify({"error": "You do not have permission to delete this template"}), 403

        result = templates_collection.delete_one({"id": template_id})

        return jsonify({
            "message": "Template deleted successfully",
            "deleted_count": result.deleted_count,
        }), 200

    except Exception as exc:
        logger.error(f"Error deleting template {template_id}: {exc}")
        return jsonify({"error": "Internal server error"}), 500
