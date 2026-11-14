"""The shared applications fake writes, reads and projects as MongoDB does: every update, read and
projection case of ``tests/mongo_cases.py`` through ``FakeApplicationsCollection`` and
``mongo_project``, and the refusal of each case they do not model.

``FakeApplicationsCollection`` stands in for applications and every record beside a market in
every test, so a test through it that passes on an update the server would apply otherwise, a
count the server would not answer, or an order it would not hand back, passes on a lie. The same
tables run against a real server in ``real_mongo/test_the_collection_cases_on_the_server.py``,
which is what makes their answers the server's.
"""
import copy

import pytest
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from conftest import FakeApplicationsCollection, UnmodelledQuery, mongo_project
from mongo_cases import (
    PROJECTION_CASES, READ_CASES, SERVER_REFUSES, UPDATE_CASES, as_stored, assert_holds,
)

ANSWERED_UPDATES = [case for case in UPDATE_CASES if case.fake_refuses is None]
REFUSED_UPDATES = [case for case in UPDATE_CASES if case.fake_refuses is not None]
ANSWERED_READS = [case for case in READ_CASES if case.fake_refuses is None]
REFUSED_READS = [case for case in READ_CASES if case.fake_refuses is not None]
ANSWERED_PROJECTIONS = [case for case in PROJECTION_CASES if case.fake_refuses is None]
REFUSED_PROJECTIONS = [case for case in PROJECTION_CASES if case.fake_refuses is not None]


def _ids(cases):
    return [case.name for case in cases]


def _holding(case) -> FakeApplicationsCollection:
    collection = FakeApplicationsCollection()
    if case.document is not None:
        collection.insert_one(copy.deepcopy(case.document))
    return collection


@pytest.mark.parametrize("case", ANSWERED_UPDATES, ids=_ids(ANSWERED_UPDATES))
def test_update_one_answers_as_the_server(case):
    assert case.after is not SERVER_REFUSES, "an update the server refuses must be refused here"
    collection = _holding(case)

    result = collection.update_one(case.the_filter, case.update, upsert=case.upsert)

    assert (result.matched_count, result.modified_count) == (case.matched, case.modified)
    assert (result.upserted_id is not None) == case.upserted
    assert_holds(collection, case)


@pytest.mark.parametrize("case", ANSWERED_UPDATES, ids=_ids(ANSWERED_UPDATES))
def test_find_one_and_update_answers_as_the_server(case):
    collection = _holding(case)

    before = collection.find_one_and_update(case.the_filter, case.update, upsert=case.upsert)

    assert as_stored(before) == as_stored(case.document if case.matched else None)
    assert_holds(collection, case)

    collection = _holding(case)
    returned = collection.find_one_and_update(
        case.the_filter, case.update, upsert=case.upsert, return_document=ReturnDocument.AFTER)

    assert as_stored(returned) == as_stored(
        collection.find_one({}) if case.matched or case.upserted else None)
    assert_holds(collection, case)


@pytest.mark.parametrize("case", REFUSED_UPDATES, ids=_ids(REFUSED_UPDATES))
@pytest.mark.parametrize("write", ["update_one", "find_one_and_update"])
def test_an_update_it_does_not_model_is_refused_and_stores_nothing(case, write):
    collection = _holding(case)

    with pytest.raises(UnmodelledQuery) as refused:
        getattr(collection, write)(case.the_filter, case.update, upsert=case.upsert)

    assert case.fake_refuses in str(refused.value)
    assert as_stored(list(collection.find({}))) == as_stored(
        [case.document] if case.document else [])


def _read(collection, case):
    cursor = collection.find(case.the_filter)
    if case.sort and len(case.sort) == 1:
        cursor = cursor.sort(*case.sort[0])
    elif case.sort:
        cursor = cursor.sort(case.sort)
    if case.limit is not None:
        cursor = cursor.limit(case.limit)
    return tuple(document["_id"] for document in cursor)


def _storing(documents) -> FakeApplicationsCollection:
    collection = FakeApplicationsCollection()
    for document in documents:
        collection.insert_one(copy.deepcopy(document))
    return collection


@pytest.mark.parametrize("case", ANSWERED_READS, ids=_ids(ANSWERED_READS))
def test_find_sorts_and_limits_as_the_server(case):
    assert case.found is not SERVER_REFUSES

    assert _read(_storing(case.documents), case) == case.found


@pytest.mark.parametrize("case", REFUSED_READS, ids=_ids(REFUSED_READS))
def test_a_sort_it_does_not_model_is_refused(case):
    with pytest.raises(UnmodelledQuery) as refused:
        _read(_storing(case.documents), case)

    assert case.fake_refuses in str(refused.value)


@pytest.mark.parametrize("case", ANSWERED_PROJECTIONS, ids=_ids(ANSWERED_PROJECTIONS))
def test_a_projection_answers_as_the_server(case):
    assert case.projected is not SERVER_REFUSES
    document = copy.deepcopy(case.document)

    assert as_stored(mongo_project(document, case.projection)) == as_stored(case.projected)
    assert document == case.document, "projecting must not change the document"
    assert as_stored(_storing([case.document]).find_one({}, case.projection)) == as_stored(
        case.projected)


@pytest.mark.parametrize("case", REFUSED_PROJECTIONS, ids=_ids(REFUSED_PROJECTIONS))
def test_a_projection_it_does_not_model_is_refused(case):
    with pytest.raises(UnmodelledQuery) as refused:
        mongo_project(copy.deepcopy(case.document), case.projection)

    assert case.fake_refuses in str(refused.value)


def test_every_case_has_a_name_of_its_own():
    for cases in (UPDATE_CASES, READ_CASES, PROJECTION_CASES):
        names = [case.name for case in cases]

        assert len(names) == len(set(names))


def test_insert_one_gives_the_callers_document_an_object_id():
    collection = FakeApplicationsCollection()
    document = {"a": 1}

    result = collection.insert_one(document)

    assert isinstance(document["_id"], ObjectId)
    assert result.inserted_id == document["_id"]
    assert collection.find_one({"_id": document["_id"]}) == document


def test_insert_one_keeps_the_callers_id():
    collection = FakeApplicationsCollection()

    assert collection.insert_one({"_id": "k"}).inserted_id == "k"


def test_insert_one_refuses_an_id_already_held():
    collection = FakeApplicationsCollection()
    collection.insert_one({"_id": 1, "a": 1})

    with pytest.raises(DuplicateKeyError):
        collection.insert_one({"_id": 1, "a": 2})

    assert list(collection.find({})) == [{"_id": 1, "a": 1}]


def test_two_inserts_get_two_ids():
    collection = FakeApplicationsCollection()

    first = collection.insert_one({"a": 1}).inserted_id
    second = collection.insert_one({"a": 1}).inserted_id

    assert first != second
    assert collection.count_documents({}) == 2


def test_a_stored_document_is_apart_from_the_callers():
    collection = FakeApplicationsCollection()
    document = {"_id": 1, "a": {"b": [1]}}
    collection.insert_one(document)

    document["a"]["b"].append(2)
    read = collection.find_one({"_id": 1})
    read["a"]["b"].append(3)
    [found] = list(collection.find({}))
    found["a"]["b"].append(4)
    returned = collection.find_one_and_update({"_id": 1}, {"$set": {"c": 1}})
    returned["a"]["b"].append(5)

    assert collection.find_one({"_id": 1}) == {"_id": 1, "a": {"b": [1]}, "c": 1}


def test_sort_with_one_field_and_no_direction_is_ascending():
    collection = _storing([{"_id": 1, "a": 2}, {"_id": 2, "a": 1}])

    assert [document["_id"] for document in collection.find({}).sort("a")] == [2, 1]


def test_a_limit_before_a_sort_still_sorts_first():
    collection = _storing([{"_id": 1, "a": 2}, {"_id": 2, "a": 1}, {"_id": 3, "a": 3}])

    found = collection.find({}).limit(2).sort("a", -1)

    assert [document["_id"] for document in found] == [3, 1]


def test_a_sort_reads_the_field_a_projection_leaves_out():
    collection = _storing([{"_id": 1, "a": 2}, {"_id": 2, "a": 1}])

    assert list(collection.find({}, {"_id": 1}).sort("a", 1)) == [{"_id": 2}, {"_id": 1}]


def test_a_cursor_is_an_iterator():
    collection = _storing([{"_id": 1}])

    assert next(collection.find({})) == {"_id": 1}
    assert next(collection.find({"_id": 2}), None) is None


@pytest.mark.parametrize("direction", [0, 2, "text"])
def test_a_sort_direction_it_does_not_model_is_refused(direction):
    with pytest.raises(UnmodelledQuery):
        list(_storing([{"_id": 1}]).find({}).sort("a", direction))


def test_a_negative_limit_is_refused():
    with pytest.raises(UnmodelledQuery):
        list(_storing([{"_id": 1}]).find({}).limit(-1))


def test_find_one_and_update_takes_the_first_by_its_sort():
    collection = _storing([{"_id": 1, "a": 2}, {"_id": 2, "a": 1}])

    before = collection.find_one_and_update({}, {"$set": {"b": 1}}, sort=[("a", 1)])

    assert before == {"_id": 2, "a": 1}
    assert collection.find_one({"b": 1})["_id"] == 2


def test_an_unmodelled_filter_is_refused_with_nothing_stored():
    collection = FakeApplicationsCollection()

    with pytest.raises(UnmodelledQuery):
        collection.find_one({"a": {"$regex": "x"}})
    with pytest.raises(UnmodelledQuery):
        collection.update_one({"a": {"$regex": "x"}}, {"$set": {"b": 1}}, upsert=True)
    assert collection.count_documents({}) == 0


def test_an_update_of_the_id_is_refused():
    collection = _storing([{"_id": 1}])

    with pytest.raises(UnmodelledQuery):
        collection.update_one({"_id": 1}, {"$set": {"_id": 2}})


def test_a_replacement_document_is_refused_as_the_driver_refuses_it():
    collection = _storing([{"_id": 1}])

    with pytest.raises(ValueError):
        collection.update_one({"_id": 1}, {"a": 1})


def test_a_held_document_is_updated_in_place():
    """A test may hold a document it reads from ``documents``; an update keeps that same dict."""
    collection = _storing([{"_id": 1, "a": 1}])
    [held] = collection.documents

    collection.update_one({"_id": 1}, {"$set": {"a": 2}})

    assert held == {"_id": 1, "a": 2}


def test_delete_one_takes_the_matching_document_not_an_equal_one():
    collection = FakeApplicationsCollection()
    collection.documents.extend([{"a": 1}, {"a": 1}])
    [first, second] = collection.documents

    collection.delete_one({"a": 1})

    assert collection.documents == [{"a": 1}]
    assert collection.documents[0] is second and first is not second


def test_find_one_and_delete_answers_the_document_it_deleted():
    collection = _storing([{"_id": 1, "a": 1}, {"_id": 2, "a": 2}])

    deleted = collection.find_one_and_delete({"a": 2})

    assert deleted == {"_id": 2, "a": 2}
    assert collection.documents == [{"_id": 1, "a": 1}]
    assert collection.find_one_and_delete({"a": 3}) is None
    assert collection.documents == [{"_id": 1, "a": 1}]


def test_an_id_equal_as_a_number_is_a_duplicate():
    collection = FakeApplicationsCollection()
    collection.insert_one({"_id": 1})

    with pytest.raises(DuplicateKeyError):
        collection.insert_one({"_id": 1.0})
