"""The shared organizations fake writes as MongoDB does (T283).

``FakeOrganizations`` in ``tests/conftest.py`` applies the filter a write is given and the update
it carries, and answers the server's matched and modified counts, so a write that holds what it
read is refused here when the stored organization no longer holds it, as the server refuses it.
Several of the organization tests' own fakes ignored their filter and stored a dotted ``$set`` key
literally, passing a write the server would refuse. The update table of ``tests/mongo_cases.py``
runs through it here, every case but the upserts, which no organization write makes; its
between-read-and-write hook and its cut are pinned too.
"""
import pytest

from conftest import FakeOrganizations, UnmodelledQuery, WriteCut
from mongo_cases import UPDATE_CASES, as_stored

UPDATES = [case for case in UPDATE_CASES if not case.upsert]
ANSWERED = [case for case in UPDATES if case.fake_refuses is None]
REFUSED = [case for case in UPDATES if case.fake_refuses is not None]


def holding(document):
    return FakeOrganizations(*([] if document is None else [document]))


@pytest.mark.parametrize("many", [False, True], ids=["update_one", "update_many"])
@pytest.mark.parametrize("case", ANSWERED, ids=[case.name for case in ANSWERED])
def test_an_update_case_answers_as_the_server(case, many):
    fake = holding(case.document)

    write = fake.update_many if many else fake.update_one
    result = write(case.the_filter, case.update)

    assert (result.matched_count, result.modified_count) == (case.matched, case.modified)
    assert as_stored(fake.docs) == as_stored([case.after])


@pytest.mark.parametrize("case", REFUSED, ids=[case.name for case in REFUSED])
def test_an_update_case_it_does_not_model_is_refused_and_stores_nothing(case):
    fake = holding(case.document)

    with pytest.raises(UnmodelledQuery) as refused:
        fake.update_one(case.the_filter, case.update)

    assert case.fake_refuses in str(refused.value)
    assert as_stored(fake.docs) == as_stored([case.document] if case.document else [])


def test_a_write_whose_filter_no_longer_holds_matches_nothing_and_stores_nothing():
    fake = FakeOrganizations({"id": "o1", "people": {"o": "owner"}})

    result = fake.update_one({"id": "o1", "people.u1": "member"}, {"$unset": {"people.u1": ""}})

    assert (result.matched_count, result.modified_count) == (0, 0)
    assert fake.doc == {"id": "o1", "people": {"o": "owner"}}


def test_update_many_writes_every_document_it_matches():
    fake = FakeOrganizations({"id": "o1", "members": ["u1"]}, {"id": "o2", "members": ["u1"]},
                             {"id": "o3", "members": []})

    result = fake.update_many({"members": "u1"}, {"$pull": {"members": "u1"}})

    assert (result.matched_count, result.modified_count) == (2, 2)
    assert [doc["members"] for doc in fake.docs] == [[], [], []]


def test_a_read_is_a_copy_a_caller_cannot_change_the_store_through():
    fake = FakeOrganizations({"id": "o1", "people": {"o": "owner"}, "admins": []})

    read = fake.find_one({"id": "o1"})
    read["people"]["u1"] = "admin"
    read["admins"].append("u1")

    assert fake.doc == {"id": "o1", "people": {"o": "owner"}, "admins": []}


def test_the_hook_runs_once_between_the_read_and_the_next_write():
    fake = FakeOrganizations({"id": "o1", "n": 0})
    calls = []

    def another_request():
        calls.append("ran")
        fake.update_one({"id": "o1"}, {"$inc": {"n": 1}})

    fake.before_write = another_request
    fake.update_one({"id": "o1", "n": 0}, {"$set": {"n": 10}})
    fake.update_one({"id": "o1"}, {"$inc": {"n": 100}})

    assert calls == ["ran"]
    assert fake.doc["n"] == 101, "the write judged on n == 0 met the other request's change"


def test_a_cut_raises_at_its_write_and_stores_nothing_of_it():
    fake = FakeOrganizations({"id": "o1", "n": 0})
    fake.cut_at = 2

    fake.update_one({"id": "o1"}, {"$inc": {"n": 1}})
    with pytest.raises(WriteCut):
        fake.update_one({"id": "o1"}, {"$inc": {"n": 1}})

    assert fake.doc["n"] == 1
    assert len(fake.writes) == 2


def test_an_insert_is_given_an_id_as_the_driver_gives_one():
    fake = FakeOrganizations()
    doc = {"id": "o1"}

    fake.insert_one(doc)

    assert "_id" in doc and fake.doc["_id"] == doc["_id"]
