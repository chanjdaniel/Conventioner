"""How a handler reads a request body, and a string from it.

A route in `app.py` reads its body with `json_object`, so each such route refuses a body that is not
a JSON object in the same words, and a library's failure to read it never reaches the client as a
415 or a 500.

A JSON body may hold an object, a list, a number or a boolean wherever a string belongs, and a
value handed to PyMongo as it came is part of the filter, where an object is read as query syntax.
So a handler that looks something up by a body value reads it here, and a value of any other type
reads as absent: the handler then answers it as it answers a missing value, and no query is made.
See docs/implementation/conventions/a-request-value-is-a-string.md.
"""
from typing import Any, Dict, Optional

from flask import request

from client_errors import BadRequestError

NO_DATA_PROVIDED = "No data provided"
NOT_AN_OBJECT = "A JSON object is required"


def json_object(*, required: bool) -> Dict[str, Any]:
    """The request's body when it is a JSON object, else a `BadRequestError` the client reads.

    No body, and a body that is not JSON, are no body: a ``required`` one is refused as
    `NO_DATA_PROVIDED`, as is an empty object, and an optional one reads as ``{}``.
    JSON that is not an object (a list, a string, a number, a boolean) is refused as
    `NOT_AN_OBJECT` either way.
    """
    body = request.get_json(silent=True)
    if body is None:
        if required:
            raise BadRequestError(NO_DATA_PROVIDED)
        return {}
    if not isinstance(body, dict):
        raise BadRequestError(NOT_AN_OBJECT)
    if required and not body:
        raise BadRequestError(NO_DATA_PROVIDED)
    return body


def string_field(body: Any, key: str) -> Optional[str]:
    """The body's ``key`` when it is a string, else None.

    A body that is not a JSON object, a missing key and a value of any other type all read as None.
    """
    if not isinstance(body, dict):
        return None
    value = body.get(key)
    return value if isinstance(value, str) else None
