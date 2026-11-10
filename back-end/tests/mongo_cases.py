"""The cases that check the shared fakes against MongoDB: each a document, an operation, and the
answer MongoDB 8.0 gives, written down here.

Two tests read this table. ``tests/test_the_shared_matcher.py`` runs every case through the fakes
of ``tests/conftest.py`` on every run, hermetically, so the gate checks the fakes; and
``tests/real_mongo/test_the_filter_cases_on_the_server.py`` runs every case through a real server,
so CI checks the table itself. A case the fakes do not model says which operator they refuse, and
the hermetic test asserts that refusal; the server test still asserts the server's answer.

Kept apart from ``conftest.py`` because both tests import it and neither owns it.
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
