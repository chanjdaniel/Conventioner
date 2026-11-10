"""The applicant side's concurrency guarantees, each run on a real server with real threads.

Every guarantee here rests on the server: a unique index, or a write conditional on what it read.
The hermetic suite proves each one's logic through fakes; these run the losing branch, the one
each guarantee exists for, where it lives.
"""
from datetime import datetime, timedelta, timezone

import pytest

from datatypes import Application, ApplicationStatus, ApplicationType, MarketPerson, MarketPhase

import api.applicant_auth as ApplicantAuth
import api.applications as ApplicationsApi
import sign_in_limits
from real_mongo import harness

APPLICANT = "racing-applicant@example.com"
RIGHT_CODE = "246810"
WRONG_CODE = "135791"


def _application(market_id: str, email: str = APPLICANT, **fields) -> Application:
    return Application(
        market_id=market_id, applicant_email=email, form_data={"business": "Fixture Stall"},
        status=ApplicationStatus.OPEN, **fields)


def _reviewer(n: int) -> MarketPerson:
    return MarketPerson(user_id=f"reviewer-{n}", email=f"reviewer-{n}@example.com")


class TestOneApplicantIsOneApplication:
    def test_twenty_creates_at_once_leave_one_application_and_answer_it_to_every_one(
            self, boot_indexes, applications, race):
        """The create is an upsert on a public endpoint: twenty requests for one new address at
        once all read nothing, and only the unique identity index stops the second document."""
        harness.warm(applications, 20)
        answered = race(20, lambda _i: ApplicationsApi.find_or_create_application(
            _application("market-race")))

        assert [a for a in answered if isinstance(a, BaseException)] == []
        stored = list(applications.find({"market_id": "market-race", "applicant_email": APPLICANT}))
        assert len(stored) == 1
        assert {a.id for a in answered} == {stored[0]["id"]}

    def test_a_waitlist_application_beside_it_is_its_own(self, boot_indexes, applications, race):
        """The identity is (market, address, type), so the same racing creates of a main and a
        waitlist application leave one of each."""
        def create(i):
            kind = ApplicationType.MAIN if i % 2 else ApplicationType.WAITLIST
            return ApplicationsApi.find_or_create_application(
                _application("market-race", application_type=kind))

        harness.warm(applications, 20)
        answered = race(20, create)

        assert [a for a in answered if isinstance(a, BaseException)] == []
        stored = list(applications.find({"market_id": "market-race"}))
        assert sorted(doc["application_type"] for doc in stored) == ["main", "waitlist"]
        assert {a.id for a in answered} == {doc["id"] for doc in stored}


class TestTwoReviewersAreHandedDifferentCards:
    @pytest.fixture
    def ten_open(self, applications):
        base = datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc)
        ids = []
        for n in range(10):
            app = _application("market-review", email=f"vendor-{n}@example.com",
                               submitted_at=(base + timedelta(minutes=n)).isoformat())
            applications.insert_one(app.model_dump())
            ids.append(app.id)
        return ids

    def test_ten_reviewers_asking_at_once_are_handed_ten_different_cards(
            self, ten_open, applications, race):
        harness.warm(applications, 10)
        handed = race(10, lambda i: ApplicationsApi.claim_next_for_review(
            "market-review", _reviewer(i), after=None, include_follow_ups=False))

        assert [h for h in handed if not isinstance(h, dict)] == []
        assert sorted(h["id"] for h in handed) == sorted(ten_open)
        for i, card in enumerate(handed):
            stored = applications.find_one({"id": card["id"]})
            assert stored["held_by"] == _reviewer(i).model_dump()

    def test_a_renew_by_someone_else_than_the_holder_changes_nothing(self, ten_open, applications):
        holder, other = _reviewer(1), _reviewer(2)
        card = ApplicationsApi.claim_next_for_review(
            "market-review", holder, after=None, include_follow_ups=False)
        before = applications.find_one({"id": card["id"]})

        later = datetime.now(timezone.utc) + timedelta(minutes=1)
        assert ApplicationsApi.renew_claim(card["id"], other, now=later) is False
        assert applications.find_one({"id": card["id"]}) == before

        assert ApplicationsApi.renew_claim(card["id"], holder, now=later) is True
        renewed = applications.find_one({"id": card["id"]})
        assert renewed["held_by"] == holder.model_dump()
        assert renewed["held_until"] > before["held_until"]

    def test_a_release_by_the_holder_frees_the_card_and_a_release_by_another_does_not(
            self, ten_open, applications):
        holder, other = _reviewer(1), _reviewer(2)
        card = ApplicationsApi.claim_next_for_review(
            "market-review", holder, after=None, include_follow_ups=False)

        assert ApplicationsApi.release_claim(card["id"], other) is False
        assert applications.find_one({"id": card["id"]})["held_by"] == holder.model_dump()

        assert ApplicationsApi.release_claim(card["id"], holder) is True
        freed = applications.find_one({"id": card["id"]})
        assert "held_by" not in freed and "held_until" not in freed
        taken = ApplicationsApi.claim_next_for_review(
            "market-review", other, after=None, include_follow_ups=False, want=card["id"])
        assert taken["id"] == card["id"]


class TestASignInCodeIsTriedAtMostFiveTimesAndSignsInOnce:
    """Tries go through ``POST /public/markets/<slug>/applicant-login/verify-code``, each thread on a
    client of its own. A code allows ``MAX_CODE_ATTEMPTS`` tries, every one counted by one atomic
    ``$inc`` held on "tries left", and a right try signs in only by a write held on "not yet used"."""

    @pytest.fixture
    def code_sent(self, boot_indexes, signed_in, market_in):
        signed_in("organizer@example.com")
        market = market_in(MarketPhase.APPLICATIONS, intakeMode="form")
        ApplicantAuth._store_challenge(
            market["id"], APPLICANT, RIGHT_CODE,
            datetime.now(timezone.utc) + timedelta(minutes=ApplicantAuth.CODE_EXPIRY_MINUTES))
        return market

    @staticmethod
    def _tries(market, codes, race):
        import app as app_module

        url = f"/public/markets/{market['slug']}/applicant-login/verify-code"
        clients = [app_module.app.test_client() for _ in codes]
        harness.warm(ApplicantAuth.challenges_collection, len(codes))

        def attempt(i):
            response = clients[i].post(url, json={"email": APPLICANT, "code": codes[i]})
            body = response.get_json()
            return "signed in" if response.status_code == 200 else body["codeState"]

        return race(len(codes), attempt)

    @staticmethod
    def _challenge(market):
        return ApplicantAuth.challenges_collection.find_one(
            {"market_id": market["id"], "email": APPLICANT})

    def test_five_right_tries_at_once_sign_in_exactly_once(self, code_sent, race):
        """The one right code, sent from five tabs at once: one signs in, and the code is then
        used, so the other four are told so."""
        answered = self._tries(code_sent, [RIGHT_CODE] * 5, race)

        assert sorted(answered) == ["signed in"] + ["spent"] * 4
        assert self._challenge(code_sent)["consumed"] is True

    def test_ten_wrong_tries_at_once_count_exactly_five_and_spend_the_code(self, code_sent, race):
        """However many tries arrive together, no more than five are counted: the fifth spends the
        code, and the rest find no tries left."""
        answered = self._tries(code_sent, [WRONG_CODE] * 10, race)

        assert sorted(answered) == ["retry"] * 4 + ["spent"] * 6
        challenge = self._challenge(code_sent)
        assert challenge["attempts"] == ApplicantAuth.MAX_CODE_ATTEMPTS
        assert challenge["consumed"] is True

    def test_a_right_try_among_three_wrong_ones_signs_in_and_every_wrong_try_counted_is_kept(
            self, code_sent, race):
        """Within the five tries, the right one always signs in. A wrong try counted before it is
        answered "try again" and kept in the count; one arriving after it finds the code used and
        is not counted. No count is lost between them."""
        answered = self._tries(code_sent, [RIGHT_CODE] + [WRONG_CODE] * 3, race)

        assert answered[0] == "signed in"
        assert set(answered[1:]) <= {"retry", "spent"}
        challenge = self._challenge(code_sent)
        assert challenge["attempts"] == 1 + answered.count("retry")
        assert challenge["consumed"] is True

    def test_a_right_try_among_nine_wrong_ones_never_signs_in_twice_or_counts_past_five(
            self, code_sent, race):
        """Ten tries at once, one of them right. Whether the right one is among the five counted,
        and whether it lands before a fifth wrong try spends the code, is the race's to decide; what
        holds either way is at most one sign-in, at most five tries counted, and a spent code. With
        no sign-in, five tries were counted: the right one was never counted, or it was and lost to
        the fifth wrong one, so a count that stopped early fails here."""
        answered = self._tries(code_sent, [RIGHT_CODE] + [WRONG_CODE] * 9, race)

        assert answered.count("signed in") <= 1
        assert "signed in" not in answered[1:]
        challenge = self._challenge(code_sent)
        assert answered.count("retry") + answered.count("signed in") <= challenge["attempts"]
        assert challenge["attempts"] <= ApplicantAuth.MAX_CODE_ATTEMPTS
        if "signed in" not in answered:
            assert challenge["attempts"] == ApplicantAuth.MAX_CODE_ATTEMPTS
        assert challenge["consumed"] is True


class TestTheRateLimitCountsEveryAttempt:
    def test_twenty_attempts_at_once_count_twenty(self, sign_in_attempts, race):
        """The counter is one ``$inc`` upsert; twenty at once on a new window make one document
        counting twenty, and exactly the limit's five are let through."""
        limit = sign_in_limits.REQUEST_CODE_PER_ADDRESS
        harness.warm(sign_in_attempts, 20)
        now = datetime.now(timezone.utc)  # one window for every thread

        answered = race(20, lambda _i: sign_in_limits.count_attempt(limit, APPLICANT, now=now))

        assert [a for a in answered if isinstance(a, BaseException)] == []
        assert answered.count(None) == limit.attempts
        counters = list(sign_in_attempts.find({}))
        assert len(counters) == 1
        assert counters[0]["count"] == 20
