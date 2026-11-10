"""Every update, read and projection case of ``tests/mongo_cases.py`` on the server: the documents
stored, the case's operation sent, and the answer the table writes down, for every case, the ones
the shared fakes refuse included. This is what makes those tables the server's word, and so what
makes the hermetic check of ``FakeApplicationsCollection`` and ``mongo_project`` against them mean
anything."""
import copy

import pytest
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

from mongo_cases import (
    PROJECTION_CASES, READ_CASES, SERVER_REFUSES, UPDATE_CASES, as_stored,
)


def _stored(collection, case):
    if case.document is not None:
        collection.insert_one(copy.deepcopy(case.document))


def _assert_holds(collection, case):
    """The collection holds the case's document after, and only it."""
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


@pytest.mark.parametrize("case", UPDATE_CASES, ids=[case.name for case in UPDATE_CASES])
def test_update_one_answers_as_the_table(case, real_db):
    collection = real_db["update_cases"]
    _stored(collection, case)

    if case.after is SERVER_REFUSES:
        with pytest.raises(OperationFailure):
            collection.update_one(case.the_filter, case.update, upsert=case.upsert)
        _assert_holds(collection, case)
        return
    result = collection.update_one(case.the_filter, case.update, upsert=case.upsert)

    assert (result.matched_count, result.modified_count) == (case.matched, case.modified)
    assert (result.upserted_id is not None) == case.upserted
    _assert_holds(collection, case)


@pytest.mark.parametrize("case", UPDATE_CASES, ids=[case.name for case in UPDATE_CASES])
def test_find_one_and_update_answers_as_the_table(case, real_db):
    collection = real_db["update_cases"]
    _stored(collection, case)

    if case.after is SERVER_REFUSES:
        with pytest.raises(OperationFailure):
            collection.find_one_and_update(case.the_filter, case.update, upsert=case.upsert)
        _assert_holds(collection, case)
        return
    before = collection.find_one_and_update(case.the_filter, case.update, upsert=case.upsert)

    assert as_stored(before) == as_stored(case.document if case.matched else None)
    _assert_holds(collection, case)

    collection.delete_many({})
    _stored(collection, case)
    returned = collection.find_one_and_update(
        case.the_filter, case.update, upsert=case.upsert, return_document=ReturnDocument.AFTER)

    assert as_stored(returned) == as_stored(
        collection.find_one({}) if case.matched or case.upserted else None)
    _assert_holds(collection, case)


@pytest.mark.parametrize("case", READ_CASES, ids=[case.name for case in READ_CASES])
def test_find_sorts_and_limits_as_the_table(case, real_db):
    collection = real_db["read_cases"]
    collection.insert_many(copy.deepcopy(list(case.documents)))

    cursor = collection.find(case.the_filter)
    if case.sort and len(case.sort) == 1:
        cursor = cursor.sort(*case.sort[0])
    elif case.sort:
        cursor = cursor.sort(case.sort)
    if case.limit is not None:
        cursor = cursor.limit(case.limit)

    assert tuple(document["_id"] for document in cursor) == case.found


@pytest.mark.parametrize("case", PROJECTION_CASES, ids=[case.name for case in PROJECTION_CASES])
def test_a_projection_answers_as_the_table(case, real_db):
    collection = real_db["projection_cases"]
    collection.insert_one(copy.deepcopy(case.document))

    if case.projected is SERVER_REFUSES:
        with pytest.raises(OperationFailure):
            collection.find_one({}, case.projection)
        return

    assert as_stored(collection.find_one({}, case.projection)) == as_stored(case.projected)


def test_insert_one_gives_the_callers_document_an_object_id(real_db):
    document = {"a": 1}

    result = real_db["inserts"].insert_one(document)

    assert isinstance(document["_id"], ObjectId)
    assert result.inserted_id == document["_id"]


def test_insert_one_refuses_an_id_already_held(real_db):
    real_db["inserts"].insert_one({"_id": 1, "a": 1})

    with pytest.raises(DuplicateKeyError):
        real_db["inserts"].insert_one({"_id": 1, "a": 2})

    assert list(real_db["inserts"].find({})) == [{"_id": 1, "a": 1}]


def test_a_stored_document_is_apart_from_the_callers(real_db):
    document = {"_id": 1, "a": {"b": [1]}}
    real_db["inserts"].insert_one(document)

    document["a"]["b"].append(2)
    read = real_db["inserts"].find_one({"_id": 1})
    read["a"]["b"].append(3)
    [found] = list(real_db["inserts"].find({}))
    found["a"]["b"].append(4)

    assert real_db["inserts"].find_one({"_id": 1}) == {"_id": 1, "a": {"b": [1]}}
