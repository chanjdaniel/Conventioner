"""The shared matcher answers every filter case of ``tests/mongo_cases.py`` as MongoDB does, and
refuses the cases it does not model, so a test of a filter through the shared fakes cannot pass
on a filter the server would read otherwise.

The same table runs against a real server in ``real_mongo/test_the_filter_cases_on_the_server.py``,
which is what makes its answers the server's.
"""
import copy

import pytest

from conftest import UnmodelledQuery, mongo_matches
from mongo_cases import FILTER_CASES, SERVER_REFUSES

ANSWERED = [case for case in FILTER_CASES if case.fake_refuses is None]
REFUSED = [case for case in FILTER_CASES if case.fake_refuses is not None]


@pytest.mark.parametrize("case", ANSWERED, ids=[case.name for case in ANSWERED])
def test_the_matcher_answers_as_the_server(case):
    assert case.matches is not SERVER_REFUSES, "a filter the server refuses must be refused here"
    document = copy.deepcopy(case.document)

    assert mongo_matches(document, case.filter) is case.matches
    assert document == case.document, "matching must not change the document"


@pytest.mark.parametrize("case", REFUSED, ids=[case.name for case in REFUSED])
def test_the_matcher_refuses_what_it_does_not_model(case):
    with pytest.raises(UnmodelledQuery) as refused:
        mongo_matches(copy.deepcopy(case.document), case.filter)

    assert repr(case.fake_refuses) in str(refused.value)


def test_a_refusal_is_a_failed_assertion_not_an_error():
    assert issubclass(UnmodelledQuery, AssertionError)


def test_every_case_has_a_name_of_its_own():
    names = [case.name for case in FILTER_CASES]

    assert len(names) == len(set(names))
