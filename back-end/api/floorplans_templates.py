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

from utils.identity import authenticated_email
from utils.request_body import json_object, string_field
import api.users as UsersApi
from bson import ObjectId

from db_config import get_database
import history as History

logger = logging.getLogger(__name__)

db = get_database()
templates_collection = db["floorplan_templates"]
organizations_collection = db["organizations"]

floorplans_templates_bp = Blueprint("floorplans_templates", __name__)

# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_request_user():
    """Resolve the signed-in user from the session.

    Returns their user document, or None when no such user exists. Every route that calls this
    carries ``@login_required``, so the session is always present by the time it runs.
    """
    return UsersApi.get_user_raw(authenticated_email())


def _doc_to_response(doc: dict) -> dict:
    """Convert a MongoDB document to an API-safe response dict."""
    doc["_id"] = str(doc["_id"])
    return doc


def _organization_refusal(org_id: str, user: dict):
    """None when *user* is the organization's owner, one of its admins or one of its members.

    Otherwise the JSON body and status to answer: 404 for an organization nobody has, 403 for one
    the user is not in.
    """
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        return {"error": "Organization not found"}, 404
    user_id = user.get("id")
    if user_id != org.get("owner") and user_id not in org.get("members", []) \
            and user_id not in org.get("admins", []):
        return {"error": "User does not belong to this organization"}, 403
    return None


def _requested_organization_refusal(data: dict, user: dict):
    """None when the body names no organization, or one *user* is in; else the refusal to answer.

    ``organizationId`` is a string or null; any other type answers 400 before anything is looked up.
    """
    if data.get("organizationId") is None:
        return None
    org_id = string_field(data, "organizationId")
    if org_id is None:
        return {"error": "organizationId must be a string"}, 400
    return _organization_refusal(org_id, user)


def _template_field_refusal(data: dict):
    """None when each template field the body holds has its type; else the 400 to answer.

    ``name`` is a string that is not blank, ``tableTypes`` a list of objects and ``aisles`` an
    object; ``organizationId`` is checked by `_requested_organization_refusal`.
    """
    if "name" in data:
        name = string_field(data, "name")
        if not name or not name.strip():
            return {"error": "Template name is required"}, 400
    if "tableTypes" in data:
        table_types = data["tableTypes"]
        if not isinstance(table_types, list) or not all(isinstance(t, dict) for t in table_types):
            return {"error": "tableTypes must be a list of objects"}, 400
    if "aisles" in data and not isinstance(data["aisles"], dict):
        return {"error": "aisles must be an object"}, 400
    return None


# The fields a template's change records, before and after, by the names the history words them
# with: what it is, never its bookkeeping. Where it is filed is said by the entry's kind.
_RECORDED_FIELDS = {"name": "name", "tableTypes": "table_types", "aisles": "aisles"}


def _organization_of(template_doc: dict):
    """The organization a template is filed under, or None; a stored id that is not a non-empty
    string reads as none, as ``_check_ownership`` reads it."""
    org_id = template_doc.get("organizationId")
    return org_id if isinstance(org_id, str) and org_id else None


def _record(org_id, template_doc: dict, kind: str, before: dict, after: dict) -> None:
    """A template's change, in the history of the organization ``org_id`` (E40/F02/S01); a
    template of no organization is its creator's alone and records nothing. Its subject names it
    as it is after the change, as it was for one removed, so a change that kept its name still
    reads by it. A move records even when nothing else changed: where it is filed is its kind."""
    if not org_id:
        return
    moved = kind in (History.TEMPLATE_MOVED_OUT, History.TEMPLATE_MOVED_IN)
    History.record_for_organization(
        org_id, authenticated_email(), History.MANAGE_FLOORPLAN_TEMPLATES, kind=kind,
        subject={"template_id": template_doc.get("id"), "name": template_doc.get("name")},
        detail=lambda: History.changes(before, after) or ({} if moved else None),
    )


def _record_update(stored: dict, updates: dict) -> None:
    """An update, in the organization it is filed under; or, when it moved the template, as
    leaving the one and arriving in the other."""
    changed = {key: name for key, name in _RECORDED_FIELDS.items() if key in updates}
    before = {name: stored.get(key) for key, name in changed.items()}
    after = {name: updates[key] for key, name in changed.items()}
    now = {**stored, **updates}
    was_in, is_in = _organization_of(stored), _organization_of(now)
    if was_in == is_in:
        _record(is_in, now, History.TEMPLATE_CHANGED, before, after)
        return
    _record(was_in, now, History.TEMPLATE_MOVED_OUT, before, after)
    _record(is_in, now, History.TEMPLATE_MOVED_IN, before, after)


def _check_ownership(template_doc: dict, requesting_user) -> bool:
    """Return True if *requesting_user* is allowed to modify the template.

    Allowed if:
    - user is the template's ``ownerUserId``, OR
    - the template has an ``organizationId`` and the user is the org owner.

    A stored ``organizationId`` that is not a non-empty string reads as no organization.
    """
    if not requesting_user:
        return False

    if template_doc.get("ownerUserId") == requesting_user.get("id"):
        return True

    org_id = template_doc.get("organizationId")
    if isinstance(org_id, str) and org_id:
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
    - **organizationId** (optional, str): an organization the user is in

    The ``ownerUserId`` is set from the current authenticated user.
    """
    data = json_object(required=True)
    try:
        if "name" not in data:
            return jsonify({"error": "Template name is required"}), 400
        refusal = _template_field_refusal(data)
        if refusal:
            return refusal

        user = _get_request_user()
        if not user:
            return jsonify({"error": "User not found"}), 401

        refusal = _requested_organization_refusal(data, user)
        if refusal:
            return refusal

        template_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        doc = {
            "id": template_id,
            "name": data["name"],
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
        _record(_organization_of(doc), doc, History.TEMPLATE_ADDED, {"name": None},
                {"name": doc["name"]})

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
    - **organizationId** - filter by organization ID (requires org membership)
    """
    try:
        user = _get_request_user()
        if not user:
            return jsonify({"error": "User not found"}), 401

        org_id = request.args.get("organizationId")
        if org_id:
            refusal = _organization_refusal(org_id, user)
            if refusal:
                return refusal
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
    """Get a single template by its id. Requires its creator or the organization's owner."""
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
    - **name**, **tableTypes**, **aisles**, **organizationId** (an organization the user is in)
    """
    data = json_object(required=True)
    try:
        doc = templates_collection.find_one({"id": template_id})
        if not doc:
            return jsonify({"error": "Template not found"}), 404

        user = _get_request_user()
        if not _check_ownership(doc, user):
            return jsonify({"error": "You do not have permission to update this template"}), 403

        refusal = _requested_organization_refusal(data, user) or _template_field_refusal(data)
        if refusal:
            return refusal

        # Build the $set payload from allowed fields only
        allowed_fields = {"name", "tableTypes", "aisles", "organizationId"}
        updates = {k: v for k, v in data.items() if k in allowed_fields}
        if not updates:
            return jsonify({"error": "No updatable fields provided"}), 400
        updates["updatedAt"] = datetime.now().isoformat()

        result = templates_collection.update_one(
            {"id": template_id},
            {"$set": updates},
        )
        _record_update(doc, updates)

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
        if result.deleted_count:
            _record(_organization_of(doc), doc, History.TEMPLATE_REMOVED,
                    {"name": doc.get("name")}, {"name": None})

        return jsonify({
            "message": "Template deleted successfully",
            "deleted_count": result.deleted_count,
        }), 200

    except Exception as exc:
        logger.error(f"Error deleting template {template_id}: {exc}")
        return jsonify({"error": "Internal server error"}), 500
