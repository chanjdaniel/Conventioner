"""An exception never reaches a client: the one place the back end turns one into a response.

A refusal meant for the client is a **client error**: raised where the refusal is decided, carrying
the HTTP status and the copy our code wrote. Copy is a literal, or a sentence our code composes from
values it chose (a field's label, a market's name, a phase); it is never ``str()`` of an exception,
nor a library's message wrapped in our sentence.

Anything else that escapes a route is the server's fault. It is logged once, with its traceback,
and answered ``{"error": "Internal server error"}``, 500 - never its text, its type or where it was
raised, because that is noise to an organizer.

The rule, the types and what breaks it: docs/implementation/conventions/an-exception-never-reaches-a-client.md.
"""
import logging
from typing import Any, Dict, Tuple

from flask import Flask, Response, jsonify, request
from pydantic import ValidationError
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)

INTERNAL_SERVER_ERROR = "Internal server error"

# What a 500's log line may name to find the market or organization it concerned. Never the path,
# the query string, the body or `vendor_email`: each of those can hold an applicant's address.
_LOGGED_VIEW_ARGS = ("market_id", "market_slug", "org_id")


class ClientError(Exception):
    """A refusal the client is meant to read, in copy our code wrote, with the status it answers."""

    status = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    def body(self) -> Dict[str, Any]:
        """The JSON the client reads. A refusal with more to say than a sentence overrides this,
        with its keys camelCased as the front end reads them."""
        return {"error": self.message}


# During the expand each type also keeps the builtin base its raise sites raised before, so a route
# ladder not yet migrated (`except ValueError`, `except PermissionError`) still catches it and answers
# as it did. The contract drops them once no route catches to answer.


class BadRequestError(ClientError, ValueError):
    status = 400


class ForbiddenError(ClientError, PermissionError):
    status = 403


class NotFoundError(ClientError, ValueError):
    status = 404


class ConflictError(ClientError):
    status = 409


def field_named_copy(heading: str, error: ValidationError) -> str:
    """The copy for a body a model refused: ``heading``, then each failing field by its dotted
    location and pydantic's short message.

    Never the error's ``input`` (whatever the body held), ``ctx``, ``url`` (a link to pydantic's
    docs) or ``type``: they describe the library, and the input may be anyone's words.
    """
    problems = "; ".join(
        f"{_dotted(problem['loc'])}: {problem['msg']}" if problem["loc"] else problem["msg"]
        for problem in error.errors(include_url=False, include_context=False, include_input=False)
    )
    return f"{heading}: {problems}"


def parse_failure_detail(error: Exception) -> str:
    """What a log line may say of a failed parse: each failing location and pydantic's error type.

    Never the input, which may hold an applicant's answer or address; anything but a
    ``ValidationError`` by its type alone, since its message may quote the input too.
    """
    if not isinstance(error, ValidationError):
        return type(error).__name__
    return "; ".join(
        f"{_dotted(problem['loc'])} ({problem['type']})"
        for problem in error.errors(include_url=False, include_context=False, include_input=False)
    )


def _dotted(location: Tuple[Any, ...]) -> str:
    return ".".join(str(part) for part in location)


def answer_client_error(error: ClientError) -> Tuple[Response, int]:
    return jsonify(error.body()), error.status


def answer_unexpected(error: Exception) -> HTTPException | Tuple[Response, int]:
    """Log what escaped a route and answer nothing of it.

    Flask finds this handler for its own answers too, an `HTTPException` being an `Exception`: a
    404 or 405, an `abort()`, Flask-Login's 401. Those are answers already, and pass unchanged.
    """
    if isinstance(error, HTTPException):
        return error
    concerning = "".join(
        f" {name}={request.view_args[name]}"
        for name in _LOGGED_VIEW_ARGS
        if request.view_args and name in request.view_args
    )
    logger.exception(
        "Unexpected exception answering %s %s%s", request.method, request.endpoint, concerning,
        exc_info=error,
    )
    return jsonify({"error": INTERNAL_SERVER_ERROR}), 500


def install_error_answers(app: Flask) -> None:
    """Answer every exception a route raises, on the app and every blueprint.

    On `Exception`, not `InternalServerError`: under `TESTING` or debug Flask propagates an
    unhandled exception rather than calling a 500 handler, so only this is exercised by the suite
    the way it runs in production. Flask picks the handler nearest the raised class, so a client
    error reaches `answer_client_error` first.
    """
    app.register_error_handler(ClientError, answer_client_error)
    app.register_error_handler(Exception, answer_unexpected)
