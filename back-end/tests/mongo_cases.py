"""The cases that check the shared fakes against MongoDB: each a document, an operation, and the
answer MongoDB 8.0 gives, written down here.

Four tables: ``FILTER_CASES`` (``mongo_matches``), ``UPDATE_CASES`` (``mongo_update``, through
the fakes' writes), ``READ_CASES`` (``find`` with ``sort`` and ``limit``) and ``PROJECTION_CASES``
(``mongo_project``). Each is read twice. Hermetically, on every run, so the gate checks the fakes
of ``tests/conftest.py``: ``tests/test_the_shared_matcher.py`` runs the filters,
``tests/test_the_shared_applications_fake.py`` the updates, reads and projections through the
applications fake, and ``tests/test_the_shared_markets_fakes.py`` the updates through the markets
fakes. Against a real server, so CI checks the tables themselves:
``tests/real_mongo/test_the_filter_cases_on_the_server.py`` runs the filters and
``tests/real_mongo/test_the_collection_cases_on_the_server.py`` the other three. A case the fakes
do not model says what they refuse, and the hermetic tests assert that refusal; the server tests
still assert the server's answer.

Kept apart from ``conftest.py`` because all five tests import it and none owns it.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

#: The server's answer to a filter it refuses to run, such as an unknown operator.
SERVER_REFUSES = "the server refuses"


@dataclass(frozen=True)
class FilterCase:
    """One filter over one document, and whether MongoDB returns the document.

    ``matches`` is ``True``, ``False`` or ``SERVER_REFUSES``. ``fake_refuses`` names the operator
    ``mongo_matches`` refuses with ``UnmodelledQuery`` for this case, or is ``None`` when the fake
    answers it and must answer as the server does.
    """
    name: str
    document: dict
    filter: dict
    matches: bool | str
    fake_refuses: str | None = None


def _at(hour: int) -> datetime:
    """A moment of 2099-01-01, in UTC to the millisecond, as the server stores a date."""
    return datetime(2099, 1, 1, hour, 0, 0, tzinfo=timezone.utc)


FILTER_CASES = (
    # Plain equality.
    FilterCase("a scalar equals itself", {"a": 1}, {"a": 1}, True),
    FilterCase("a scalar does not equal another", {"a": 1}, {"a": 2}, False),
    FilterCase("a missing field equals no value", {}, {"a": 1}, False),
    FilterCase("an integer equals the same float", {"a": 1}, {"a": 1.0}, True),
    FilterCase("true does not equal 1", {"a": True}, {"a": 1}, False),
    FilterCase("1 does not equal true", {"a": 1}, {"a": True}, False),
    FilterCase("a string does not equal a number", {"a": "1"}, {"a": 1}, False),
    FilterCase("a date equals the same moment", {"a": _at(9)}, {"a": _at(9)}, True),
    FilterCase("$eq is plain equality", {"a": 1}, {"a": {"$eq": 1}}, True),
    FilterCase("$eq refuses another value", {"a": 1}, {"a": {"$eq": 2}}, False),
    FilterCase("an empty filter matches", {"a": 1}, {}, True),
    FilterCase("every field of the filter must hold", {"a": 1, "b": 2}, {"a": 1, "b": 3}, False),

    # Null against missing.
    FilterCase("null matches a missing field", {}, {"a": None}, True),
    FilterCase("null matches a null field", {"a": None}, {"a": None}, True),
    FilterCase("null does not match a value", {"a": 1}, {"a": None}, False),
    FilterCase("$eq null matches a missing field", {}, {"a": {"$eq": None}}, True),
    FilterCase("$in [null, 0] matches a missing field", {}, {"a": {"$in": [None, 0]}}, True),
    FilterCase("$in [null, 0] matches 0", {"a": 0}, {"a": {"$in": [None, 0]}}, True),
    FilterCase("$in [null] matches a missing field", {}, {"a": {"$in": [None]}}, True),
    FilterCase("$in [null] does not match a value", {"a": 2}, {"a": {"$in": [None]}}, False),
    FilterCase("$ne null does not match a missing field", {}, {"a": {"$ne": None}}, False),
    FilterCase("$ne null does not match a null field", {"a": None}, {"a": {"$ne": None}}, False),
    FilterCase("$ne null matches a value", {"a": 1}, {"a": {"$ne": None}}, True),
    FilterCase("$ne a value matches a missing field", {}, {"a": {"$ne": "draft"}}, True),
    FilterCase("$nin [null] does not match a missing field", {}, {"a": {"$nin": [None]}}, False),
    FilterCase("null matches a list holding null", {"a": [None, 1]}, {"a": None}, True),
    FilterCase("null does not match an empty list", {"a": []}, {"a": None}, False),
    FilterCase("$gte null matches a missing field", {}, {"a": {"$gte": None}}, True),
    FilterCase("$lte null matches a null field", {"a": None}, {"a": {"$lte": None}}, True),
    FilterCase("$gte null does not match a value", {"a": 1}, {"a": {"$gte": None}}, False),
    FilterCase("$gt null matches nothing, missing included", {}, {"a": {"$gt": None}}, False),
    FilterCase("$lt null matches nothing, null included", {"a": None}, {"a": {"$lt": None}}, False),

    # A value against a list field.
    FilterCase("a scalar matches a list holding it", {"a": [1, 2]}, {"a": 1}, True),
    FilterCase("a scalar does not match a list without it", {"a": [1, 2]}, {"a": 3}, False),
    FilterCase("a list equals the same list", {"a": [1, 2]}, {"a": [1, 2]}, True),
    FilterCase("a list does not equal its reverse", {"a": [1, 2]}, {"a": [2, 1]}, False),
    FilterCase("a list matches a list holding it", {"a": [[1, 2]]}, {"a": [1, 2]}, True),
    FilterCase("a nested list is not searched for a scalar", {"a": [[1, 2]]}, {"a": 1}, False),
    FilterCase("a scalar is not found in a list inside the list", {"a": [1, [2]]}, {"a": 2}, False),
    FilterCase("$in matches a list holding one of its values", {"a": [1, 2]},
               {"a": {"$in": [2, 3]}}, True),
    FilterCase("$in does not match a list holding none of them", {"a": [1, 2]},
               {"a": {"$in": [3, 4]}}, False),
    FilterCase("$in matches a list equal to one of its values", {"a": [1, 2]},
               {"a": {"$in": [[1, 2]]}}, True),
    FilterCase("$in of true does not match 1", {"a": 1}, {"a": {"$in": [True]}}, False),
    FilterCase("$ne does not match a list holding the value", {"a": [1, 2]},
               {"a": {"$ne": 1}}, False),
    FilterCase("$ne matches a list without the value", {"a": [1, 2]}, {"a": {"$ne": 3}}, True),
    FilterCase("$ne does not match a list equal to the value", {"a": [1, 2]},
               {"a": {"$ne": [1, 2]}}, False),
    FilterCase("$nin does not match a list holding one of its values", {"a": [1, 2]},
               {"a": {"$nin": [2]}}, False),
    FilterCase("$nin matches a list holding none of its values", {"a": [1, 2]},
               {"a": {"$nin": [3]}}, True),
    FilterCase("$nin matches a missing field", {}, {"a": {"$nin": [3]}}, True),
    FilterCase("$nin matches a scalar outside it", {"a": "x"}, {"a": {"$nin": ["y", "z"]}}, True),
    FilterCase("$nin does not match a scalar inside it", {"a": "y"},
               {"a": {"$nin": ["y", "z"]}}, False),
    FilterCase("$nin [null] matches a list", {"a": [1, 2]}, {"a": {"$nin": [None]}}, True),

    # Whole sub-documents.
    FilterCase("a sub-document equals itself in the same field order", {"a": {"x": 1, "y": 2}},
               {"a": {"x": 1, "y": 2}}, True),
    FilterCase("a sub-document does not equal itself in another field order",
               {"a": {"x": 1, "y": 2}}, {"a": {"y": 2, "x": 1}}, False),
    FilterCase("a sub-document does not equal one with a field more", {"a": {"x": 1, "y": 2}},
               {"a": {"x": 1}}, False),
    FilterCase("an empty sub-document equals an empty one", {"a": {}}, {"a": {}}, True),
    FilterCase("an empty sub-document does not equal a full one", {"a": {"b": 1}}, {"a": {}}, False),
    FilterCase("a sub-document matches a list holding it", {"a": [{"x": 1, "y": 2}]},
               {"a": {"x": 1, "y": 2}}, True),
    FilterCase("a sub-document's values compare by type", {"a": {"x": True}}, {"a": {"x": 1}},
               False),
    FilterCase("a sub-document in $in compares in field order", {"a": {"x": 1, "y": 2}},
               {"a": {"$in": [{"y": 2, "x": 1}]}}, False),
    FilterCase("a value whose first key is a field is a sub-document, not operators", {"a": 1},
               {"a": {"b": 1, "$gt": 0}}, False),

    # Dotted paths through sub-documents.
    FilterCase("a dotted path reaches into a sub-document", {"a": {"b": 1}}, {"a.b": 1}, True),
    FilterCase("a dotted path reads a deeper value", {"a": {"b": {"c": "x"}}}, {"a.b.c": "x"},
               True),
    FilterCase("a dotted path under a scalar finds no value", {"a": 5}, {"a.b": 1}, False),
    FilterCase("a dotted path under a scalar reads as missing", {"a": 5}, {"a.b": None}, True),
    FilterCase("a dotted path under a string is not an index", {"a": "abc"}, {"a.0": "a"}, False),
    FilterCase("a numeric key of a sub-document is a field", {"a": {"0": "x"}}, {"a.0": "x"}, True),
    FilterCase("a dotted $exists finds a role", {"roles": {"u1": "owner"}},
               {"roles.u1": {"$exists": True}}, True),
    FilterCase("a dotted $exists finds no role", {"roles": {"u1": "owner"}},
               {"roles.u2": {"$exists": True}}, False),

    # Dotted paths through lists.
    FilterCase("a dotted path reaches any element of a list", {"rows": [{"e": "x"}, {"e": "y"}]},
               {"rows.e": "y"}, True),
    FilterCase("a dotted path through a list finds no other value",
               {"rows": [{"e": "x"}, {"e": "y"}]}, {"rows.e": "z"}, False),
    FilterCase("a numeric index reads that element", {"rows": [{"e": "x"}, {"e": "y"}]},
               {"rows.1.e": "y"}, True),
    FilterCase("a numeric index reads no other element", {"rows": [{"e": "x"}, {"e": "y"}]},
               {"rows.0.e": "y"}, False),
    FilterCase("a numeric index into a list of scalars", {"a": [5, 6]}, {"a.1": 6}, True),
    FilterCase("a numeric index is also a field of each element", {"a": [{"0": "x"}]},
               {"a.0": "x"}, True),
    FilterCase("an index then a field of that element", {"a": [{"0": "x"}]}, {"a.0.0": "x"}, True),
    FilterCase("an index into a nested list, then a field", {"a": [[{"b": 1}]]}, {"a.0.b": 1},
               True),
    FilterCase("a dotted path is not followed into a nested list", {"a": [[{"b": 1}]]},
               {"a.b": 1}, False),
    FilterCase("a dotted path matches a list held by an element", {"a": [{"b": [1, 2]}]},
               {"a.b": 2}, True),
    FilterCase("a dotted path's index into a list held by an element", {"a": [{"b": [1, 2]}]},
               {"a.b.1": 2}, True),
    FilterCase("a dotted path through a sub-document then a list",
               {"a": {"b": [{"c": 1}, {"c": 2}]}}, {"a.b.c": 2}, True),
    FilterCase("a dotted path's values are not gathered into one list",
               {"a": [{"b": 1}, {"b": 2}]}, {"a.b": [1, 2]}, False),
    FilterCase("a range over an index", {"a": [1]}, {"a.0": {"$gt": 0}}, True),

    # Null and existence through lists.
    FilterCase("null matches when an element lacks the field", {"a": [{"b": 1}, {"c": 2}]},
               {"a.b": None}, True),
    FilterCase("null does not match when every element has it", {"a": [{"b": 1}]},
               {"a.b": None}, False),
    FilterCase("null does not count a scalar element as missing", {"a": [1, {"b": 2}]},
               {"a.b": None}, False),
    FilterCase("null does not match through an empty list", {"a": []}, {"a.b": None}, False),
    FilterCase("null matches a scalar reached through an element", {"a": [{"b": 5}]},
               {"a.b.c": None}, True),
    FilterCase("null matches an index an element lacks", {"a": [{"c": 1}]}, {"a.5": None}, True),
    FilterCase("null does not match an index past a list of scalars", {"a": [1, 2]},
               {"a.5": None}, False),
    FilterCase("null does not match a field under an indexed scalar", {"a": [1, 2]},
               {"a.0.b": None}, False),
    FilterCase("$in [null] matches when an element lacks the field", {"a": [{"b": 1}, {"c": 1}]},
               {"a.b": {"$in": [None]}}, True),
    FilterCase("$nin [null] does not match when an element lacks it", {"a": [{"b": 1}, {"c": 1}]},
               {"a.b": {"$nin": [None]}}, False),
    FilterCase("$ne does not match when one element holds the value", {"a": [{"b": 1}, {"c": 1}]},
               {"a.b": {"$ne": 1}}, False),
    FilterCase("$ne null does not match a null element's field", {"a": [{"b": None}]},
               {"a.b": {"$ne": None}}, False),
    FilterCase("$gte null matches when an element lacks the field", {"a": [{"b": 1}, {"c": 1}]},
               {"a.b": {"$gte": None}}, True),
    FilterCase("$gte null matches a list holding null", {"a": [None, 1]}, {"a": {"$gte": None}},
               True),
    FilterCase("$gte null does not match a list without null", {"a": [1]}, {"a": {"$gte": None}},
               False),
    FilterCase("$exists true through a list", {"a": [{"b": 1}]}, {"a.b": {"$exists": True}}, True),
    FilterCase("$exists false fails when one element has the field", {"a": [{"b": 1}, {"c": 1}]},
               {"a.b": {"$exists": False}}, False),
    FilterCase("$exists false holds through an empty list", {"a": []},
               {"a.b": {"$exists": False}}, True),
    FilterCase("$exists true on an index", {"a": [1, 2]}, {"a.1": {"$exists": True}}, True),

    # $exists.
    FilterCase("$exists true finds a field", {"a": 5}, {"a": {"$exists": True}}, True),
    FilterCase("$exists true finds a null field", {"a": None}, {"a": {"$exists": True}}, True),
    FilterCase("$exists true finds no missing field", {}, {"a": {"$exists": True}}, False),
    FilterCase("$exists false finds a missing field", {}, {"a": {"$exists": False}}, True),
    FilterCase("$exists false refuses a null field", {"a": None}, {"a": {"$exists": False}}, False),
    FilterCase("$exists takes 1 as true", {"a": 5}, {"a": {"$exists": 1}}, True),

    # Ranges.
    FilterCase("$gt above", {"a": 5}, {"a": {"$gt": 4}}, True),
    FilterCase("$gt at the bound", {"a": 5}, {"a": {"$gt": 5}}, False),
    FilterCase("$gte at the bound", {"a": 5}, {"a": {"$gte": 5}}, True),
    FilterCase("$gte below", {"a": 4}, {"a": {"$gte": 5}}, False),
    FilterCase("$lt below", {"a": 4}, {"a": {"$lt": 5}}, True),
    FilterCase("$lt at the bound", {"a": 5}, {"a": {"$lt": 5}}, False),
    FilterCase("$lte at the bound", {"a": 5}, {"a": {"$lte": 5}}, True),
    FilterCase("$lte above", {"a": 6}, {"a": {"$lte": 5}}, False),
    FilterCase("a range compares an integer with a float", {"a": 2}, {"a": {"$gt": 1.5}}, True),
    FilterCase("two bounds in one condition", {"a": 3}, {"a": {"$gt": 1, "$lt": 5}}, True),
    FilterCase("two bounds, one failing", {"a": 7}, {"a": {"$gt": 1, "$lt": 5}}, False),
    FilterCase("a range over a missing field", {}, {"a": {"$gt": 0}}, False),
    FilterCase("a range over a null field", {"a": None}, {"a": {"$lt": 5}}, False),
    FilterCase("a string is not above a number", {"a": "5"}, {"a": {"$gt": 1}}, False),
    FilterCase("a number is not above the empty string", {"a": 2}, {"a": {"$gt": ""}}, False),
    FilterCase("a date is not below a string", {"a": _at(9)}, {"a": {"$lt": "2100"}}, False),
    FilterCase("a boolean is not below a number", {"a": False}, {"a": {"$lt": 1}}, False),
    FilterCase("false is below true", {"a": False}, {"a": {"$lt": True}}, True),
    FilterCase("0 is not below true", {"a": 0}, {"a": {"$lt": True}}, False),
    FilterCase("strings compare by their characters", {"a": "2099-01-01T10:00:00+00:00"},
               {"a": {"$gt": "2099-01-01T09:00:00+00:00"}}, True),
    FilterCase("a string is above the empty string", {"slug": "spring-market"},
               {"slug": {"$gt": ""}}, True),
    FilterCase("the empty string is not above itself", {"slug": ""}, {"slug": {"$gt": ""}}, False),
    FilterCase("a date above an earlier one", {"a": _at(10)}, {"a": {"$gt": _at(9)}}, True),
    FilterCase("a date not above a later one", {"a": _at(8)}, {"a": {"$gt": _at(9)}}, False),
    FilterCase("a date at the bound of $gte", {"a": _at(9)}, {"a": {"$gte": _at(9)}}, True),
    FilterCase("a range matches a list with an element in it", {"a": [1, 5]},
               {"a": {"$gt": 4}}, True),
    FilterCase("two bounds may be met by two elements", {"a": [1, 5]},
               {"a": {"$gt": 2, "$lt": 4}}, True),
    FilterCase("a range does not read into a nested list", {"a": [[1]]}, {"a": {"$gt": 0}}, False),

    # $size.
    FilterCase("$size of a list's length", {"a": [1, 2]}, {"a": {"$size": 2}}, True),
    FilterCase("$size of another length", {"a": [1, 2]}, {"a": {"$size": 1}}, False),
    FilterCase("$size 0 of an empty list", {"a": []}, {"a": {"$size": 0}}, True),
    FilterCase("$size of a missing field", {}, {"a": {"$size": 0}}, False),
    FilterCase("$size of a sub-document", {"a": {"b": 1}}, {"a": {"$size": 1}}, False),
    FilterCase("$size counts the outer list only", {"a": [[1, 2]]}, {"a": {"$size": 2}}, False),
    FilterCase("$size takes a whole float", {"a": [1, 2]}, {"a": {"$size": 2.0}}, True),
    FilterCase("$size of a negative", {"a": []}, {"a": {"$size": -1}}, SERVER_REFUSES,
               fake_refuses="$size"),
    FilterCase("$size of a fraction", {"a": [1, 2]}, {"a": {"$size": 1.5}}, SERVER_REFUSES,
               fake_refuses="$size"),

    # $type "object".
    FilterCase("$type object finds a sub-document", {"a": {"b": 1}}, {"a": {"$type": "object"}},
               True),
    FilterCase("$type object finds an empty sub-document", {"a": {}}, {"a": {"$type": "object"}},
               True),
    FilterCase("$type object refuses a scalar", {"a": 1}, {"a": {"$type": "object"}}, False),
    FilterCase("$type object refuses null", {"a": None}, {"a": {"$type": "object"}}, False),
    FilterCase("$type object refuses a missing field", {}, {"a": {"$type": "object"}}, False),
    FilterCase("$type object finds a list holding a sub-document", {"a": [{"x": 1}]},
               {"a": {"$type": "object"}}, True),
    FilterCase("$type object refuses a list of scalars", {"a": [1, 2]},
               {"a": {"$type": "object"}}, False),

    # $and, $or and $nor.
    FilterCase("$or holds when one clause does", {"a": 1}, {"$or": [{"a": 2}, {"a": 1}]}, True),
    FilterCase("$or fails when no clause holds", {"a": 1}, {"$or": [{"a": 2}, {"a": 3}]}, False),
    FilterCase("$and holds when every clause does", {"a": 1, "b": 2},
               {"$and": [{"a": 1}, {"b": 2}]}, True),
    FilterCase("$and fails when one clause does", {"a": 1, "b": 2},
               {"$and": [{"a": 1}, {"b": 3}]}, False),
    FilterCase("$nor holds when no clause does", {"a": 1}, {"$nor": [{"a": 2}]}, True),
    FilterCase("$nor fails when a clause holds", {"a": 1}, {"$nor": [{"a": 2}, {"a": 1}]}, False),
    FilterCase("$nor over a range of a missing field holds", {},
               {"$nor": [{"until": {"$gt": "2099-01-01T09:00:00+00:00"}}]}, True),
    FilterCase("$nor over a live lease fails", {"until": "2099-01-01T10:00:00+00:00"},
               {"$nor": [{"until": {"$gt": "2099-01-01T09:00:00+00:00"}}]}, False),
    FilterCase("$and beside a field", {"a": 1, "b": 2}, {"a": 1, "$and": [{"b": 2}]}, True),
    FilterCase("$and of an $or of missing or empty", {"phase": "draft", "rows": []},
               {"phase": "draft",
                "$and": [{"$or": [{"rows": {"$exists": False}}, {"rows": {"$size": 0}}]}]}, True),
    FilterCase("$and of an $or of missing or empty refuses rows", {"phase": "draft", "rows": [1]},
               {"phase": "draft",
                "$and": [{"$or": [{"rows": {"$exists": False}}, {"rows": {"$size": 0}}]}]}, False),
    FilterCase("an $or of a range and a tie", {"at": _at(9), "id": "b"},
               {"$or": [{"at": {"$lt": _at(9)}}, {"at": _at(9), "id": {"$lt": "c"}}]}, True),
    FilterCase("an $or of a range and a tie, past the tie", {"at": _at(9), "id": "d"},
               {"$or": [{"at": {"$lt": _at(9)}}, {"at": _at(9), "id": {"$lt": "c"}}]}, False),
    FilterCase("a verdict's $nor of $in", {"status": "pending"},
               {"$nor": [{"status": {"$in": ["approved", "rejected"]}}]}, True),
    FilterCase("an empty $or", {"a": 1}, {"$or": []}, SERVER_REFUSES, fake_refuses="$or"),
    FilterCase("an empty $nor", {"a": 1}, {"$nor": []}, SERVER_REFUSES, fake_refuses="$nor"),

    # What the fake refuses.
    FilterCase("$regex", {"a": "spring"}, {"a": {"$regex": "^spr"}}, True, fake_refuses="$regex"),
    FilterCase("$elemMatch", {"a": [{"b": 1, "c": 2}]},
               {"a": {"$elemMatch": {"b": 1, "c": 2}}}, True, fake_refuses="$elemMatch"),
    FilterCase("$not", {"a": 5}, {"a": {"$not": {"$gt": 6}}}, True, fake_refuses="$not"),
    FilterCase("$type string", {"a": "x"}, {"a": {"$type": "string"}}, True, fake_refuses="$type"),
    FilterCase("$type by number", {"a": {"b": 1}}, {"a": {"$type": 3}}, True, fake_refuses="$type"),
    FilterCase("$all", {"a": [1, 2, 3]}, {"a": {"$all": [1, 3]}}, True, fake_refuses="$all"),
    FilterCase("$mod", {"a": 7}, {"a": {"$mod": [2, 1]}}, True, fake_refuses="$mod"),
    FilterCase("$expr", {"a": 2, "b": 1}, {"$expr": {"$gt": ["$a", "$b"]}}, True,
               fake_refuses="$expr"),
    FilterCase("an unknown field operator", {"a": 1}, {"a": {"$foo": 1}}, SERVER_REFUSES,
               fake_refuses="$foo"),
    FilterCase("an unknown top-level operator", {"a": 1}, {"$foo": 1}, SERVER_REFUSES,
               fake_refuses="$foo"),
    FilterCase("an operator beside a field in one condition", {"a": 1}, {"a": {"$gt": 0, "b": 1}},
               SERVER_REFUSES, fake_refuses="b"),
    FilterCase("an unmodelled operator inside $or, after a clause that holds", {"a": 1},
               {"$or": [{"a": 1}, {"a": {"$regex": "x"}}]}, True, fake_refuses="$regex"),
    FilterCase("an unmodelled operator after a field that fails", {"a": 1},
               {"a": 2, "b": {"$elemMatch": {"c": 1}}}, False, fake_refuses="$elemMatch"),
)


def as_stored(value, ordered: bool = True):
    """``value`` as the server tells two documents apart: every document's fields in their order,
    every number with its type, and a date in UTC without its zone, as the server hands one back.

    Python's ``==`` ignores a dict's field order and calls ``True`` equal to ``1``; the server does
    neither, so the update, read and projection cases compare through this. ``ordered=False``
    compares fields whatever their order, for the one document whose order the server does not
    keep steady: the one an upsert makes, whose filter terms it lays out in its query planner's
    order (``update_one`` and ``find_one_and_update`` lay out the same filter differently).
    """
    if isinstance(value, dict):
        fields = [(key, as_stored(item, ordered)) for key, item in value.items()]
        return ("document", fields if ordered else sorted(fields))
    if isinstance(value, list):
        return ("list", [as_stored(item, ordered) for item in value])
    if isinstance(value, datetime):
        moment = value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
        return ("date", moment)
    return (type(value).__name__, value)


@dataclass(frozen=True)
class UpdateCase:
    """One update sent to one stored document (``document``, ``None`` for none), and what MongoDB
    does: the document it then holds and the counts it answers.

    ``after`` is the stored document after the update, or ``SERVER_REFUSES`` when the server
    refuses the update and stores nothing. An upsert's new document is written without its
    ``_id`` when the filter names none, since the server makes an ``ObjectId`` for it, and is
    compared whatever its field order (``as_stored``).
    ``fake_refuses`` is text the shared fakes' ``UnmodelledQuery`` holds, for a case they do not
    model, the server refusing it or not.
    """
    name: str
    document: dict | None
    update: dict
    after: dict | str
    matched: int = 1
    modified: int = 1
    filter: dict = None
    upsert: bool = False
    fake_refuses: str | None = None

    @property
    def the_filter(self) -> dict:
        return {"_id": 1} if self.filter is None else self.filter

    @property
    def upserted(self) -> bool:
        return self.upsert and self.matched == 0 and self.after is not SERVER_REFUSES


def assert_holds(collection, case: UpdateCase):
    """``collection``, holding ``case``'s document before the update was sent, now holds its
    document after, and only it; one made by an upsert with the ``ObjectId`` it was given.
    After an update the server refuses, it still holds the document before.

    The hermetic tests read the fakes through this and the server test reads the server, so the
    two sides cannot drift in what they assert.
    """
    from bson import ObjectId

    held = list(collection.find({}))
    if case.after is SERVER_REFUSES:
        assert as_stored(held) == as_stored([case.document] if case.document else [])
        return
    assert len(held) == 1
    [document] = held
    if "_id" not in case.after:
        made = document.pop("_id")
        assert isinstance(made, ObjectId)
    ordered = not case.upserted
    assert as_stored(document, ordered) == as_stored(case.after, ordered)


def _update(name, document, update, after, modified=1, **rest) -> UpdateCase:
    return UpdateCase(name, document, update, after, modified=modified, **rest)


def _refused_update(name, document, update, fake_refuses) -> UpdateCase:
    return UpdateCase(name, document, update, SERVER_REFUSES, matched=0, modified=0,
                      fake_refuses=fake_refuses)


def _upsert(name, filter, update, after, **rest) -> UpdateCase:
    return UpdateCase(name, None, update, after, matched=0, modified=0, filter=filter,
                      upsert=True, **rest)


UPDATE_CASES = (
    # $set.
    _update("$set adds a field after the others", {"_id": 1, "a": 1}, {"$set": {"b": 2}},
            {"_id": 1, "a": 1, "b": 2}),
    _update("$set changes a field where it stands", {"_id": 1, "a": 1, "b": 2},
            {"$set": {"a": 3}}, {"_id": 1, "a": 3, "b": 2}),
    _update("$set of the value held modifies nothing", {"_id": 1, "a": 1}, {"$set": {"a": 1}},
            {"_id": 1, "a": 1}, modified=0),
    _update("$set of a float over the same integer modifies it", {"_id": 1, "a": 1},
            {"$set": {"a": 1.0}}, {"_id": 1, "a": 1.0}),
    _update("$set of true over 1 modifies it", {"_id": 1, "a": 1}, {"$set": {"a": True}},
            {"_id": 1, "a": True}),
    _update("$set of null over a missing field adds it", {"_id": 1}, {"$set": {"a": None}},
            {"_id": 1, "a": None}),
    _update("$set of null over null modifies nothing", {"_id": 1, "a": None},
            {"$set": {"a": None}}, {"_id": 1, "a": None}, modified=0),
    _update("$set adds new fields in the order of their names", {"_id": 1},
            {"$set": {"z": 1, "a": 2, "m": 3}}, {"_id": 1, "a": 2, "m": 3, "z": 1}),
    _update("$set of a dotted path into a sub-document", {"_id": 1, "a": {"x": 1}},
            {"$set": {"a.y": 2}}, {"_id": 1, "a": {"x": 1, "y": 2}}),
    _update("$set of a dotted path makes the sub-documents it needs", {"_id": 1},
            {"$set": {"a.b.c": 1}}, {"_id": 1, "a": {"b": {"c": 1}}}),
    _update("$set of a sub-document replaces it whole", {"_id": 1, "a": {"x": 1}},
            {"$set": {"a": {"y": 2}}}, {"_id": 1, "a": {"y": 2}}),
    _update("$set of a sub-document in another field order modifies it",
            {"_id": 1, "a": {"x": 1, "y": 2}}, {"$set": {"a": {"y": 2, "x": 1}}},
            {"_id": 1, "a": {"y": 2, "x": 1}}),
    _update("$set of the same sub-document modifies nothing", {"_id": 1, "a": {"x": 1, "y": 2}},
            {"$set": {"a": {"x": 1, "y": 2}}}, {"_id": 1, "a": {"x": 1, "y": 2}}, modified=0),
    _update("$set of a list element by its index", {"_id": 1, "a": [1, 2]},
            {"$set": {"a.1": 5}}, {"_id": 1, "a": [1, 5]}),
    _update("$set of an index past the end pads the list with null", {"_id": 1, "a": [1]},
            {"$set": {"a.2": 5}}, {"_id": 1, "a": [1, None, 5]}),
    _update("$set of a field of a list element by its index", {"_id": 1, "a": [{"b": 1}]},
            {"$set": {"a.0.b": 2}}, {"_id": 1, "a": [{"b": 2}]}),
    _update("$set of a numeric field of a sub-document is a field, not an index",
            {"_id": 1, "a": {"x": 1}}, {"$set": {"a.0": 2}}, {"_id": 1, "a": {"x": 1, "0": 2}}),
    _refused_update("$set of a field under a scalar", {"_id": 1, "a": 5}, {"$set": {"a.b": 1}},
                    "'a.b'"),
    _refused_update("$set of a named field of a list", {"_id": 1, "a": [1]},
                    {"$set": {"a.b": 1}}, "'a.b'"),
    _refused_update("one path under two operators", {"_id": 1, "a": 1},
                    {"$set": {"a": 2}, "$inc": {"a": 1}}, "'a'"),
    _refused_update("a path and its parent in one update", {"_id": 1, "a": {"b": 1}},
                    {"$set": {"a": {}, "a.b": 2}}, "'a.b'"),
    _refused_update("$set of an empty field name", {"_id": 1}, {"$set": {"a..b": 1}}, "'a..b'"),
    _update("$set of a document nothing matches", {"_id": 1, "a": 1}, {"$set": {"a": 2}},
            {"_id": 1, "a": 1}, matched=0, modified=0, filter={"_id": 2}),
    _update("$set and $inc in one update, as an assignment's write is",
            {"_id": 1, "assignmentObject": {"revision": 3, "rows": [1]}},
            {"$set": {"assignmentObject.rows": [2]}, "$inc": {"assignmentObject.revision": 1}},
            {"_id": 1, "assignmentObject": {"revision": 4, "rows": [2]}}),

    # $unset.
    _update("$unset removes a field", {"_id": 1, "a": 1, "b": 2}, {"$unset": {"a": ""}},
            {"_id": 1, "b": 2}),
    _update("$unset of a missing field modifies nothing", {"_id": 1, "b": 2},
            {"$unset": {"a": ""}}, {"_id": 1, "b": 2}, modified=0),
    _update("$unset of a dotted path", {"_id": 1, "a": {"x": 1, "y": 2}}, {"$unset": {"a.x": 1}},
            {"_id": 1, "a": {"y": 2}}),
    _update("$unset under a missing parent modifies nothing", {"_id": 1},
            {"$unset": {"a.x": ""}}, {"_id": 1}, modified=0),
    _update("$unset under a scalar modifies nothing", {"_id": 1, "a": 5}, {"$unset": {"a.x": ""}},
            {"_id": 1, "a": 5}, modified=0),
    _update("$unset of a list element sets it to null", {"_id": 1, "a": [1, 2]},
            {"$unset": {"a.0": ""}}, {"_id": 1, "a": [None, 2]}),
    _update("$unset of the last field of a sub-document leaves it empty", {"_id": 1, "a": {"x": 1}},
            {"$unset": {"a.x": ""}}, {"_id": 1, "a": {}}),

    # $inc.
    _update("$inc adds to an integer", {"_id": 1, "a": 1}, {"$inc": {"a": 1}}, {"_id": 1, "a": 2}),
    _update("$inc of a missing field sets it to the amount", {"_id": 1}, {"$inc": {"a": 5}},
            {"_id": 1, "a": 5}),
    _update("$inc by a negative amount", {"_id": 1, "a": 3}, {"$inc": {"a": -1}},
            {"_id": 1, "a": 2}),
    _update("$inc by zero modifies nothing", {"_id": 1, "a": 3}, {"$inc": {"a": 0}},
            {"_id": 1, "a": 3}, modified=0),
    _update("$inc of an integer by a float makes a float", {"_id": 1, "a": 1},
            {"$inc": {"a": 0.5}}, {"_id": 1, "a": 1.5}),
    _update("$inc of a dotted path", {"_id": 1, "a": {"n": 1}}, {"$inc": {"a.n": 2}},
            {"_id": 1, "a": {"n": 3}}),
    _update("$inc of a missing dotted path makes it", {"_id": 1}, {"$inc": {"a.n": 1}},
            {"_id": 1, "a": {"n": 1}}),
    _refused_update("$inc of a string", {"_id": 1, "a": "1"}, {"$inc": {"a": 1}}, "'a'"),
    _refused_update("$inc of null", {"_id": 1, "a": None}, {"$inc": {"a": 1}}, "'a'"),
    _refused_update("$inc by a string", {"_id": 1, "a": 1}, {"$inc": {"a": "1"}}, "'a'"),
    _refused_update("$inc by true", {"_id": 1, "a": 1}, {"$inc": {"a": True}}, "'a'"),

    # $push.
    _update("$push appends a value", {"_id": 1, "a": [1]}, {"$push": {"a": 2}},
            {"_id": 1, "a": [1, 2]}),
    _update("$push of a value already held appends it again", {"_id": 1, "a": [1]},
            {"$push": {"a": 1}}, {"_id": 1, "a": [1, 1]}),
    _update("$push onto a missing field makes the list", {"_id": 1}, {"$push": {"a": 1}},
            {"_id": 1, "a": [1]}),
    _update("$push of a list appends it as one element", {"_id": 1, "a": [1]},
            {"$push": {"a": [2, 3]}}, {"_id": 1, "a": [1, [2, 3]]}),
    _update("$push of a sub-document, as a payment's trail is", {"_id": 1, "changes": []},
            {"$push": {"changes": {"by": "x", "what": "edited"}}},
            {"_id": 1, "changes": [{"by": "x", "what": "edited"}]}),
    _update("$push with $each appends each value", {"_id": 1, "a": [1]},
            {"$push": {"a": {"$each": [2, 3]}}}, {"_id": 1, "a": [1, 2, 3]}),
    _update("$push with $each onto a missing field makes the list", {"_id": 1},
            {"$push": {"a": {"$each": [1, 2]}}}, {"_id": 1, "a": [1, 2]}),
    _update("$push with an empty $each onto a list modifies nothing", {"_id": 1, "a": [1]},
            {"$push": {"a": {"$each": []}}}, {"_id": 1, "a": [1]}, modified=0),
    _update("$push with an empty $each onto a missing field makes an empty list", {"_id": 1},
            {"$push": {"a": {"$each": []}}}, {"_id": 1, "a": []}),
    _update("$push onto a dotted path", {"_id": 1, "a": {"b": [1]}}, {"$push": {"a.b": 2}},
            {"_id": 1, "a": {"b": [1, 2]}}),
    _refused_update("$push onto a scalar", {"_id": 1, "a": 1}, {"$push": {"a": 2}}, "'a'"),
    _update("$push with $slice", {"_id": 1, "a": [1, 2]},
            {"$push": {"a": {"$each": [3], "$slice": -2}}}, {"_id": 1, "a": [2, 3]},
            fake_refuses="'$slice'"),
    _update("$push with $position", {"_id": 1, "a": [1, 2]},
            {"$push": {"a": {"$each": [0], "$position": 0}}}, {"_id": 1, "a": [0, 1, 2]},
            fake_refuses="'$position'"),

    # $addToSet.
    _update("$addToSet adds a value not held", {"_id": 1, "a": [1]}, {"$addToSet": {"a": 2}},
            {"_id": 1, "a": [1, 2]}),
    _update("$addToSet of a value held modifies nothing", {"_id": 1, "a": [1, 2]},
            {"$addToSet": {"a": 2}}, {"_id": 1, "a": [1, 2]}, modified=0),
    _update("$addToSet onto a missing field makes the list", {"_id": 1},
            {"$addToSet": {"a": "m"}}, {"_id": 1, "a": ["m"]}),
    _update("$addToSet of 1 beside true adds it", {"_id": 1, "a": [True]},
            {"$addToSet": {"a": 1}}, {"_id": 1, "a": [True, 1]}),
    _update("$addToSet of 1.0 beside 1 adds nothing", {"_id": 1, "a": [1]},
            {"$addToSet": {"a": 1.0}}, {"_id": 1, "a": [1]}, modified=0),
    _update("$addToSet of a sub-document held in another field order adds it",
            {"_id": 1, "a": [{"x": 1, "y": 2}]}, {"$addToSet": {"a": {"y": 2, "x": 1}}},
            {"_id": 1, "a": [{"x": 1, "y": 2}, {"y": 2, "x": 1}]}),
    _update("$addToSet of a list adds it as one element", {"_id": 1, "a": [1]},
            {"$addToSet": {"a": [1]}}, {"_id": 1, "a": [1, [1]]}),
    _update("$addToSet with $each adds each value not held, once", {"_id": 1, "a": [1]},
            {"$addToSet": {"a": {"$each": [1, 2, 2, 3]}}}, {"_id": 1, "a": [1, 2, 3]}),
    _update("$addToSet with $each of values all held modifies nothing", {"_id": 1, "a": [1, 2]},
            {"$addToSet": {"a": {"$each": [2, 1]}}}, {"_id": 1, "a": [1, 2]}, modified=0),
    _refused_update("$addToSet onto a scalar", {"_id": 1, "a": 1}, {"$addToSet": {"a": 2}},
                    "'a'"),
    _update("$addToSet through the positional operator, as the fake Discord's is",
            {"_id": 1, "members": [{"id": "u1", "roles": []}, {"id": "u2", "roles": []}]},
            {"$addToSet": {"members.$.roles": "r1"}},
            {"_id": 1, "members": [{"id": "u1", "roles": []}, {"id": "u2", "roles": ["r1"]}]},
            filter={"_id": 1, "members.id": "u2"}, fake_refuses="'members.$.roles'"),

    # $pull.
    _update("$pull removes every element equal to the value", {"_id": 1, "a": [1, 2, 1]},
            {"$pull": {"a": 1}}, {"_id": 1, "a": [2]}),
    _update("$pull of a value not held modifies nothing", {"_id": 1, "a": [1, 2]},
            {"$pull": {"a": 3}}, {"_id": 1, "a": [1, 2]}, modified=0),
    _update("$pull from a missing field modifies nothing", {"_id": 1}, {"$pull": {"a": 1}},
            {"_id": 1}, modified=0),
    _update("$pull from two fields at once, as removing a person does",
            {"_id": 1, "admins": ["u1", "u2"], "members": ["u1", "u3"]},
            {"$pull": {"admins": "u1", "members": "u1"}},
            {"_id": 1, "admins": ["u2"], "members": ["u3"]}),
    _update("$pull of 1 leaves true", {"_id": 1, "a": [True, 1]}, {"$pull": {"a": 1}},
            {"_id": 1, "a": [True]}),
    _update("$pull of 1 takes 1.0", {"_id": 1, "a": [1.0, 2]}, {"$pull": {"a": 1}},
            {"_id": 1, "a": [2]}),
    _update("$pull of a list removes an equal list element", {"_id": 1, "a": [[1, 2], 1]},
            {"$pull": {"a": [1, 2]}}, {"_id": 1, "a": [1]}),
    _update("$pull of an equality condition removes the sub-documents meeting it",
            {"_id": 1, "a": [{"b": 1, "c": 1}, {"b": 2}]}, {"$pull": {"a": {"b": 1}}},
            {"_id": 1, "a": [{"b": 2}]}),
    _update("$pull of an equality condition leaves the scalars",
            {"_id": 1, "a": [1, {"b": 1}]}, {"$pull": {"a": {"b": 1}}}, {"_id": 1, "a": [1]}),
    _update("$pull of an operator condition", {"_id": 1, "a": [1, 5, 9]},
            {"$pull": {"a": {"$gte": 5}}}, {"_id": 1, "a": [1]}, fake_refuses="'$gte'"),
    _refused_update("$pull from a scalar", {"_id": 1, "a": 1}, {"$pull": {"a": 1}}, "'a'"),
    _update("$pull from a dotted path", {"_id": 1, "a": {"b": [1, 2]}}, {"$pull": {"a.b": 1}},
            {"_id": 1, "a": {"b": [2]}}),

    # $setOnInsert, and the document an upsert makes.
    _update("$setOnInsert on a document that matched modifies nothing", {"_id": 1, "a": 1},
            {"$setOnInsert": {"b": 2}}, {"_id": 1, "a": 1}, modified=0, upsert=True),
    _update("$setOnInsert beside $inc on a document that matched, as a counter is",
            {"_id": 1, "n": 1}, {"$inc": {"n": 1}, "$setOnInsert": {"expires": 9}},
            {"_id": 1, "n": 2}, upsert=True),
    _update("an upsert that matches a document updates it", {"_id": 1, "a": 1},
            {"$set": {"a": 2}}, {"_id": 1, "a": 2}, upsert=True),
    _upsert("an upsert makes the filter's equality terms and $setOnInsert",
            {"market_id": "m1", "email": "x@example.com"},
            {"$setOnInsert": {"status": "new", "answers": {"q": "a"}}},
            {"market_id": "m1", "email": "x@example.com", "answers": {"q": "a"},
             "status": "new"}),
    _upsert("an upsert's $set and $inc join the filter's terms, as a sign-in code's does",
            {"market_id": "m1", "email": "x@example.com"},
            {"$set": {"code": "h", "attempts": 0}, "$inc": {"sequence": 1}},
            {"market_id": "m1", "email": "x@example.com", "attempts": 0, "code": "h",
             "sequence": 1}),
    _upsert("an upsert drops the filter's operator terms",
            {"market_id": "m1", "n": {"$gt": 1}, "e": {"$exists": True}},
            {"$set": {"b": 1}}, {"market_id": "m1", "b": 1}),
    _upsert("an upsert takes $eq as equality", {"a": {"$eq": 1}}, {"$set": {"b": 1}},
            {"a": 1, "b": 1}),
    _upsert("an upsert expands a dotted equality into its sub-document",
            {"a.b": 1, "a.c": 2}, {"$set": {"d": 1}}, {"a": {"b": 1, "c": 2}, "d": 1}),
    _upsert("an upsert keeps the filter's _id", {"_id": "k", "n": 1},
            {"$inc": {"count": 1}}, {"_id": "k", "n": 1, "count": 1}),
    _upsert("an upsert's $set over a filter term wins", {"a": 1}, {"$set": {"a": 2}}, {"a": 2}),
    _upsert("an upsert of a sub-document equality keeps it whole", {"a": {"y": 1, "x": 2}},
            {"$set": {"b": 1}}, {"a": {"y": 1, "x": 2}, "b": 1}),
    _upsert("an upsert takes the terms of a top-level $and", {"$and": [{"a": 1}, {"b": 2}]},
            {"$set": {"c": 3}}, {"a": 1, "b": 2, "c": 3}, fake_refuses="'$and'"),
    _upsert("an upsert of a one-value $in", {"a": {"$in": [1]}}, {"$set": {"c": 3}},
            {"a": 1, "c": 3}, fake_refuses="'$in'"),
    _update("an upsert with $setOnInsert and $set of one path", None,
            {"$set": {"a": 1}, "$setOnInsert": {"a": 2}}, SERVER_REFUSES, matched=0, modified=0,
            filter={"k": 1}, upsert=True, fake_refuses="'a'"),

    # What the fakes do not model.
    _update("$rename", {"_id": 1, "a": 1}, {"$rename": {"a": "b"}}, {"_id": 1, "b": 1},
            fake_refuses="'$rename'"),
    _update("$min", {"_id": 1, "a": 5}, {"$min": {"a": 3}}, {"_id": 1, "a": 3},
            fake_refuses="'$min'"),
    _update("$max", {"_id": 1, "a": 5}, {"$max": {"a": 7}}, {"_id": 1, "a": 7},
            fake_refuses="'$max'"),
    _update("$mul", {"_id": 1, "a": 5}, {"$mul": {"a": 2}}, {"_id": 1, "a": 10},
            fake_refuses="'$mul'"),
    _update("$pop", {"_id": 1, "a": [1, 2]}, {"$pop": {"a": 1}}, {"_id": 1, "a": [1]},
            fake_refuses="'$pop'"),
    _update("$pullAll", {"_id": 1, "a": [1, 2, 3]}, {"$pullAll": {"a": [1, 3]}},
            {"_id": 1, "a": [2]}, fake_refuses="'$pullAll'"),
    _update("$set through all elements", {"_id": 1, "a": [{"b": 1}, {"b": 2}]},
            {"$set": {"a.$[].b": 0}}, {"_id": 1, "a": [{"b": 0}, {"b": 0}]},
            fake_refuses="'a.$[].b'"),
    _refused_update("an unknown update operator", {"_id": 1, "a": 1}, {"$foo": {"a": 1}},
                    "'$foo'"),
)


@dataclass(frozen=True)
class ReadCase:
    """A ``find`` over stored documents, sorted and limited, and the ``_id`` of each document
    MongoDB hands back, in its order.

    ``sort`` is a list of ``(field, direction)``; one pair is sent as ``sort(field, direction)``,
    several as the list. ``limit`` is ``None`` for none. ``found`` is the ``_id``s in order, or
    ``SERVER_REFUSES``. ``fake_refuses`` is text the shared fakes' refusal holds, for a case they
    do not model.
    """
    name: str
    documents: tuple
    found: tuple | str
    sort: list | None = None
    limit: int | None = None
    filter: dict = None
    fake_refuses: str | None = None

    @property
    def the_filter(self) -> dict:
        return {} if self.filter is None else self.filter


def _by(field, *values) -> tuple:
    """Documents ``_id`` 1, 2, ... each holding ``field`` as the value given, or missing for
    ``_MISSING_VALUE``."""
    return tuple({"_id": index, **({} if value is _MISSING_VALUE else {field: value})}
                 for index, value in enumerate(values, start=1))


_MISSING_VALUE = object()


READ_CASES = (
    ReadCase("a sort ascending", _by("a", 3, 1, 2), (2, 3, 1), sort=[("a", 1)]),
    ReadCase("a sort descending", _by("a", 3, 1, 2), (1, 3, 2), sort=[("a", -1)]),
    ReadCase("a sort puts a missing field first", _by("a", 2, _MISSING_VALUE, 1), (2, 3, 1),
             sort=[("a", 1)]),
    ReadCase("a sort descending puts a missing field last", _by("a", 2, _MISSING_VALUE, 1),
             (1, 3, 2), sort=[("a", -1)]),
    ReadCase("a sort reads null and missing alike", _by("a", None, _MISSING_VALUE, 0),
             (2, 1, 3), sort=[("a", 1), ("_id", -1)]),
    ReadCase("a sort by two keys, both descending, as the history's newest first is",
             ({"_id": 1, "at": "t1", "id": "a"}, {"_id": 2, "at": "t2", "id": "a"},
              {"_id": 3, "at": "t2", "id": "b"}, {"_id": 4, "at": "t1", "id": "b"}),
             (3, 2, 4, 1), sort=[("at", -1), ("id", -1)]),
    ReadCase("a sort by two keys in two directions",
             ({"_id": 1, "a": 1, "b": 1}, {"_id": 2, "a": 2, "b": 1},
              {"_id": 3, "a": 1, "b": 2}),
             (3, 1, 2), sort=[("a", 1), ("b", -1)]),
    ReadCase("a sort by a dotted path", ({"_id": 1, "a": {"b": 2}}, {"_id": 2, "a": {"b": 1}},
                                          {"_id": 3, "a": {}}),
             (3, 2, 1), sort=[("a.b", 1)]),
    ReadCase("a sort compares strings by code point", _by("a", "b", "B", "a"), (2, 3, 1),
             sort=[("a", 1)]),
    ReadCase("a sort compares integers and floats as numbers", _by("a", 2, 1.5, 1), (3, 2, 1),
             sort=[("a", 1)]),
    ReadCase("a sort puts numbers before strings", _by("a", "1", 2), (2, 1), sort=[("a", 1)]),
    ReadCase("a sort puts strings before booleans", _by("a", True, "z"), (2, 1),
             sort=[("a", 1)]),
    ReadCase("a sort puts false before true", _by("a", True, False), (2, 1), sort=[("a", 1)]),
    ReadCase("a sort puts booleans before dates", _by("a", _at(9), False), (2, 1),
             sort=[("a", 1)]),
    ReadCase("a sort orders dates", _by("a", _at(10), _at(9)), (2, 1), sort=[("a", 1)]),
    ReadCase("a sort of a submission's time, newest first",
             _by("submitted_at", "2099-01-02T00:00:00", "2099-01-03T00:00:00",
                 "2099-01-01T00:00:00"),
             (2, 1, 3), sort=[("submitted_at", -1)]),
    ReadCase("a limit after a sort", _by("a", 3, 1, 2), (1, 3), sort=[("a", -1)], limit=2),
    ReadCase("a limit of 1, as a page's one more is", _by("a", 3, 1, 2), (1,),
             sort=[("a", -1)], limit=1),
    ReadCase("a limit of 0 is no limit", _by("a", 3, 1, 2), (2, 3, 1), sort=[("a", 1)],
             limit=0),
    ReadCase("a limit past the documents", _by("a", 3, 1), (2, 1), sort=[("a", 1)], limit=5),
    ReadCase("a sort and a limit over a filter", _by("a", 3, 1, 2, 4), (3, 1),
             sort=[("a", 1)], limit=2, filter={"a": {"$gt": 1}}),
    ReadCase("a sort over a list field", _by("a", [3, 1], [2]), (1, 2), sort=[("a", 1)],
             fake_refuses="a list"),
    ReadCase("a sort over a sub-document", _by("a", {"x": 2}, {"x": 1}), (2, 1),
             sort=[("a", 1)], fake_refuses="a document"),
)


@dataclass(frozen=True)
class ProjectionCase:
    """One projection over one stored document, and the document MongoDB hands back, in its
    field order, or ``SERVER_REFUSES``. ``fake_refuses`` is text the refusal of
    ``mongo_project`` holds, for a case it does not model."""
    name: str
    document: dict
    projection: dict
    projected: dict | str
    fake_refuses: str | None = None


PROJECTION_CASES = (
    ProjectionCase("an empty projection keeps every field", {"_id": 1, "a": 1}, {},
                   {"_id": 1, "a": 1}),
    ProjectionCase("an inclusion keeps the field and the _id", {"_id": 1, "a": 1, "b": 2},
                   {"a": 1}, {"_id": 1, "a": 1}),
    ProjectionCase("an inclusion without the _id", {"_id": 1, "a": 1, "b": 2},
                   {"a": 1, "_id": 0}, {"a": 1}),
    ProjectionCase("an inclusion by true", {"_id": 1, "a": 1, "b": 2}, {"a": True},
                   {"_id": 1, "a": 1}),
    ProjectionCase("an inclusion keeps the document's field order", {"_id": 1, "a": 1, "b": 2},
                   {"b": 1, "a": 1}, {"_id": 1, "a": 1, "b": 2}),
    ProjectionCase("an inclusion of a missing field keeps the _id alone", {"_id": 1, "a": 1},
                   {"z": 1}, {"_id": 1}),
    ProjectionCase("an inclusion of the _id alone", {"_id": 1, "a": 1}, {"_id": 1}, {"_id": 1}),
    ProjectionCase("an inclusion of a dotted path keeps that part", {"_id": 1, "a": {"x": 1, "y": 2}},
                   {"a.y": 1}, {"_id": 1, "a": {"y": 2}}),
    ProjectionCase("an inclusion of two dotted paths keeps the document's order",
                   {"_id": 1, "a": {"x": 1, "y": 2, "z": 3}}, {"a.z": 1, "a.x": 1},
                   {"_id": 1, "a": {"x": 1, "z": 3}}),
    ProjectionCase("an inclusion of a dotted path a sub-document lacks keeps it empty",
                   {"_id": 1, "a": {"x": 1}}, {"a.y": 1}, {"_id": 1, "a": {}}),
    ProjectionCase("an inclusion of a dotted path under a scalar drops it", {"_id": 1, "a": 5},
                   {"a.y": 1}, {"_id": 1}),
    ProjectionCase("an inclusion of a dotted path narrows each element of a list",
                   {"_id": 1, "rows": [{"e": "x", "n": 1}, {"e": "y"}, {"n": 2}]},
                   {"rows.e": 1}, {"_id": 1, "rows": [{"e": "x"}, {"e": "y"}, {}]}),
    ProjectionCase("an inclusion through a list drops its scalar elements",
                   {"_id": 1, "a": [1, {"b": 1, "c": 2}]}, {"a.b": 1},
                   {"_id": 1, "a": [{"b": 1}]}),
    ProjectionCase("an inclusion through a list of lists", {"_id": 1, "a": [[{"b": 1, "c": 2}], 3]},
                   {"a.b": 1}, {"_id": 1, "a": [[{"b": 1}]]}),
    ProjectionCase("an exclusion drops the field", {"_id": 1, "a": 1, "b": 2}, {"a": 0},
                   {"_id": 1, "b": 2}),
    ProjectionCase("an exclusion by false", {"_id": 1, "a": 1, "b": 2}, {"a": False},
                   {"_id": 1, "b": 2}),
    ProjectionCase("an exclusion of the _id and another field, as the history reads",
                   {"_id": 1, "market_id": "m", "at": "t"}, {"_id": 0, "market_id": 0},
                   {"at": "t"}),
    ProjectionCase("an exclusion of the _id alone keeps the rest", {"_id": 1, "a": 1},
                   {"_id": 0}, {"a": 1}),
    ProjectionCase("an exclusion of a dotted path drops that part",
                   {"_id": 1, "a": {"x": 1, "y": 2}}, {"a.x": 0}, {"_id": 1, "a": {"y": 2}}),
    ProjectionCase("an exclusion of a dotted path through a list drops it from each element",
                   {"_id": 1, "a": [{"x": 1, "y": 2}, 3, {"y": 4}]}, {"a.x": 0},
                   {"_id": 1, "a": [{"y": 2}, 3, {"y": 4}]}),
    ProjectionCase("an exclusion through a list of lists",
                   {"_id": 1, "a": [[{"x": 1, "y": 2}], 3]}, {"a.x": 0},
                   {"_id": 1, "a": [[{"y": 2}], 3]}),
    ProjectionCase("an exclusion of a dotted path under a scalar keeps the scalar",
                   {"_id": 1, "a": 5}, {"a.x": 0}, {"_id": 1, "a": 5}),
    ProjectionCase("an inclusion beside an exclusion", {"_id": 1, "a": 1, "b": 2},
                   {"a": 1, "b": 0}, SERVER_REFUSES, fake_refuses="'b'"),
    ProjectionCase("a path beside its parent", {"_id": 1, "a": {"b": 1}}, {"a": 1, "a.b": 1},
                   SERVER_REFUSES, fake_refuses="'a.b'"),
    ProjectionCase("$slice", {"_id": 1, "a": [1, 2, 3]}, {"a": {"$slice": 1}},
                   {"_id": 1, "a": [1]}, fake_refuses="the value {'$slice': 1}"),
    ProjectionCase("$elemMatch", {"_id": 1, "a": [{"b": 1}, {"b": 2}]},
                   {"a": {"$elemMatch": {"b": 2}}}, {"_id": 1, "a": [{"b": 2}]},
                   fake_refuses="the value {'$elemMatch': {'b': 2}}"),
    ProjectionCase("a literal value", {"_id": 1, "a": 1}, {"a": "x"}, {"_id": 1, "a": "x"},
                   fake_refuses="the value 'x'"),
    ProjectionCase("an inclusion by 2", {"_id": 1, "a": 1, "b": 2}, {"a": 2},
                   {"_id": 1, "a": 1}, fake_refuses="the value 2"),
)
