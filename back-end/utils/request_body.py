"""How a handler reads a string from a request body.

A JSON body may hold an object, a list, a number or a boolean wherever a string belongs, and a
value handed to PyMongo as it came is part of the filter, where an object is read as query syntax.
So a handler that looks something up by a body value reads it here, and a value of any other type
reads as absent: the handler then answers it as it answers a missing value, and no query is made.
See docs/implementation/conventions/a-request-value-is-a-string.md.
"""
from typing import Any, Optional


def string_field(body: Any, key: str) -> Optional[str]:
    """The body's ``key`` when it is a string, else None.

    A body that is not a JSON object, a missing key and a value of any other type all read as None.
    """
    if not isinstance(body, dict):
        return None
    value = body.get(key)
    return value if isinstance(value, str) else None
