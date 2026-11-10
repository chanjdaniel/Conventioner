"""Every filter case of ``tests/mongo_cases.py`` on the server: the document stored, the case's
filter sent with ``find``, and the answer the table writes down, for every case, the ones the
shared matcher refuses included. This is what makes the table the server's word, and so what
makes the hermetic check of the shared matcher against it mean anything."""
import copy

import pytest
from pymongo.errors import OperationFailure

from mongo_cases import FILTER_CASES, SERVER_REFUSES


@pytest.mark.parametrize("case", FILTER_CASES, ids=[case.name for case in FILTER_CASES])
def test_the_server_answers_as_the_table(case, real_db):
    collection = real_db["filter_cases"]
    collection.insert_one(copy.deepcopy(case.document))

    if case.matches is SERVER_REFUSES:
        with pytest.raises(OperationFailure):
            list(collection.find(case.filter))
        return
    found = list(collection.find(case.filter))

    assert len(found) == (1 if case.matches else 0)
