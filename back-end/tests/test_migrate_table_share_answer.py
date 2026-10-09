"""Stored applications are brought into the shape the table-share write produces (E27/F01/S01).

Before E27 the answer was stored as typed under ``essential_table_share_email``. The write now
stores the partner's address there and the words beside it. The answer is solver-relevant, so an
application left in the old shape would read as changed on the next import of an unchanged file and
an approved vendor would be sent back to review for nothing.
"""
import copy
from types import SimpleNamespace

import essential_fields as EssentialFields
from datatypes import EssentialFormOptions
from migrate_table_share_answer import migrate


class FakeApplications:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query):
        assert query == {
            "form_data.essential_table_share_email": {"$exists": True},
            "form_data.essential_table_share_answer": {"$exists": False},
        }
        return [
            copy.deepcopy(doc) for doc in self.docs
            if "essential_table_share_email" in doc["form_data"]
            and "essential_table_share_answer" not in doc["form_data"]
        ]

    def update_one(self, query, update):
        for doc in self.docs:
            if doc["_id"] == query["_id"]:
                for path, value in update["$set"].items():
                    doc["form_data"][path.split(".", 1)[1]] = value
                return SimpleNamespace(modified_count=1)
        raise AssertionError(f"no such document: {query}")


def application(_id, share_answer):
    return {"_id": _id, "id": f"app-{_id}", "form_data": {
        "essential_full_name": "Ana Rivera",
        "essential_table_share_email": share_answer,
    }}


def database(*docs):
    return SimpleNamespace(applications=FakeApplications(list(docs)))


def form_data(db, _id):
    return next(doc["form_data"] for doc in db.applications.docs if doc["_id"] == _id)


def test_the_address_is_read_out_of_the_stored_words_and_the_words_are_kept():
    db = database(application(1, "I want to share with Buddy@Example.com"))

    migrate(db)

    assert form_data(db, 1)["essential_table_share_email"] == "buddy@example.com"
    assert form_data(db, 1)["essential_table_share_answer"] == "I want to share with Buddy@Example.com"


def test_words_with_no_address_name_no_partner():
    db = database(application(1, "N/A"))

    migrate(db)

    assert form_data(db, 1)["essential_table_share_email"] == ""
    assert form_data(db, 1)["essential_table_share_answer"] == "N/A"


def test_a_migrated_application_matches_what_the_write_stores_now():
    """What makes a re-import of an unchanged file change nothing after the migration."""
    words = "  Pair me with buddy@example.com. "
    db = database(application(1, words))

    migrate(db)

    error, written = EssentialFields.validated_essential_answers(
        {
            "essential_full_name": "Ana Rivera",
            "essential_available_dates": ["2026-11-18"],
            "essential_table_choice": "half",
            "essential_table_share_email": words,
        },
        EssentialFormOptions(dates=["2026-11-18"]),
        limit_required=False,
    )
    assert error is None
    for key in ("essential_table_share_email", "essential_table_share_answer"):
        assert form_data(db, 1)[key] == written[key]


def test_running_it_again_changes_nothing():
    db = database(application(1, "Buddy@Example.com"), application(2, ""))

    first = migrate(db)
    after_first = copy.deepcopy(db.applications.docs)
    second = migrate(db)

    assert first == 2
    assert second == 0
    assert db.applications.docs == after_first


def test_a_dry_run_writes_nothing():
    db = database(application(1, "Buddy@Example.com"))
    before = copy.deepcopy(db.applications.docs)

    assert migrate(db, dry_run=True) == 1
    assert db.applications.docs == before


def test_only_the_table_share_answer_is_touched():
    db = database(application(1, "Buddy@Example.com"))

    migrate(db)

    assert form_data(db, 1)["essential_full_name"] == "Ana Rivera"
