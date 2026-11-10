"""A payment is recorded once per press of Record, however often it is pressed (T270).

An organizer on a slow network presses Record payment, the answer never arrives, and they press it
again: each press was a new entry, so the vendor read as paid twice. The dialog now sends a key it
made when it opened, the same on every press of that opening, and a repeat of the key records
nothing new: the entry first recorded with it answers. A repeat that differs from that entry is
refused with a sentence saying so, and the account as it stands, so the dialog shows the entry
behind it. Two openings of the dialog make two keys and still record two payments.

That the database itself refuses a second entry with the key is the E2E spec's, on the stack's real
MongoDB (``one-record-for-a-vendors-day.spec.ts``); here the fake raises the refusal it would.
"""
import logging

import pytest
from pymongo.errors import DuplicateKeyError

import api.payments as PaymentsApi
import app as app_module
import payments as Payments
import unique_indexes as UniqueIndexes
from client_errors import BadRequestError, ConflictError
from test_a_vendors_payments import ANA, EDITOR, MARKET, market, stores  # noqa: F401
from test_changing_owed_and_paid import ADMIN, admin, holding  # noqa: F401
from test_one_record_for_a_vendors_day import VendorDays

KEY = "0b6f6c55-2a59-4b8e-9f5e-6d1c2a7f3e10"
OTHER_KEY = "5d0c4f8e-7c1a-4f6b-8a2e-1f9b3c6d4e21"
FIELDS = {"cents": 3500, "method": "e-transfer", "paidOn": "2099-04-01", "note": ""}
ALREADY_PAID = ("This payment was already recorded, as it was first sent. Close this and edit it "
                "if it should read differently.")
ALREADY_REFUNDED = ("This refund was already recorded, as it was first sent. Close this and edit "
                    "it if it should read differently.")
NOT_A_UUID = "A payment's request key must be a UUID."


def pay(key=KEY, by=EDITOR, **fields):
    return PaymentsApi.record_payment(MARKET, ANA, {**FIELDS, **fields, "requestKey": key}, by)


def refund(key=KEY, **fields):
    return PaymentsApi.record_refund(MARKET, ANA, {**FIELDS, **fields, "requestKey": key}, ADMIN)


def recorded(stores, action):  # noqa: F811
    return [entry for entry in stores.history.documents if entry["action"] == action]


class TestARepeatOfTheKey:
    def test_the_same_press_again_records_nothing_new_and_answers_the_account(
            self, market, stores):  # noqa: F811
        first = pay()

        again = pay()

        assert again == first
        assert len(again["payments"]) == 1
        assert again["paidCents"] == 3500
        assert len(stores.payments.documents) == 1
        assert len(recorded(stores, "record-payment")) == 1

    def test_a_refund_pressed_again_is_recorded_once(self, admin, stores):  # noqa: F811
        refund()

        again = refund()

        assert len(again["payments"]) == 1
        assert again["paidCents"] == -3500
        assert len(recorded(stores, "adjust-paid")) == 1

    @pytest.mark.parametrize("change", [
        {"cents": 3000}, {"method": "cash"}, {"paidOn": "2099-04-02"}, {"note": "the rest"},
    ], ids=["cents", "method", "paid on", "note"])
    def test_a_repeat_that_differs_is_refused_with_the_account_as_it_stands(
            self, market, stores, change):  # noqa: F811
        pay()

        with pytest.raises(ConflictError) as refused:
            pay(**change)

        assert refused.value.status == 409
        body = refused.value.body()
        assert body["error"] == ALREADY_PAID
        assert [entry["cents"] for entry in body["account"]["payments"]] == [3500]
        assert body["account"]["paidCents"] == 3500
        assert len(stores.payments.documents) == 1
        assert len(recorded(stores, "record-payment")) == 1

    def test_a_refund_that_differs_is_refused_in_a_refunds_words(self, admin, stores):  # noqa: F811
        refund()

        with pytest.raises(ConflictError) as refused:
            refund(cents=1000)

        assert refused.value.body()["error"] == ALREADY_REFUNDED

    def test_a_refund_sent_with_a_payments_key_differs_in_kind(self, admin, stores):  # noqa: F811
        pay(by=ADMIN)

        with pytest.raises(ConflictError) as refused:
            refund()

        assert refused.value.body()["error"] == ALREADY_REFUNDED
        assert [entry["kind"] for entry in refused.value.body()["account"]["payments"]] == [
            "payment"]

    def test_the_key_is_one_key_however_it_is_cased(self, market, stores):  # noqa: F811
        pay()

        pay(key=KEY.upper())

        assert len(stores.payments.documents) == 1


class TestTwoPressesAtOnce:
    """Both look the key up and find nothing; the second insert is refused by the unique index,
    and it answers as a repeat does."""

    @staticmethod
    def _the_other_lands_first(monkeypatch, stores, other):  # noqa: F811
        the_insert = stores.payments.insert_one

        def raced(*_args, **_kwargs):
            monkeypatch.setattr(stores.payments, "insert_one", the_insert)
            other()
            raise DuplicateKeyError("E11000 duplicate key error")

        monkeypatch.setattr(stores.payments, "insert_one", raced)

    def test_the_same_press_lands_once(self, market, stores, monkeypatch):  # noqa: F811
        self._the_other_lands_first(monkeypatch, stores, pay)

        answer = pay()

        assert len(answer["payments"]) == 1
        assert len(stores.payments.documents) == 1
        assert len(recorded(stores, "record-payment")) == 1

    def test_a_press_that_differs_is_refused(self, market, stores, monkeypatch):  # noqa: F811
        self._the_other_lands_first(monkeypatch, stores, pay)

        with pytest.raises(ConflictError) as refused:
            pay(cents=1000)

        assert refused.value.body()["error"] == ALREADY_PAID
        assert len(stores.payments.documents) == 1

    def test_a_refusal_with_no_entry_behind_it_is_the_error_it_is(
            self, market, stores, monkeypatch):  # noqa: F811
        def refused(*_args, **_kwargs):
            raise DuplicateKeyError("E11000 duplicate key error")

        monkeypatch.setattr(stores.payments, "insert_one", refused)

        with pytest.raises(DuplicateKeyError):
            pay()
        assert recorded(stores, "record-payment") == []


class TestKeysAndNoKey:
    def test_two_openings_of_the_dialog_record_two_payments(self, market, stores):  # noqa: F811
        pay()

        answer = pay(key=OTHER_KEY)

        assert len(answer["payments"]) == 2
        assert answer["paidCents"] == 7000
        assert len(recorded(stores, "record-payment")) == 2

    @pytest.mark.parametrize("body", [dict(FIELDS), {**FIELDS, "requestKey": None}],
                             ids=["absent", "null"])
    def test_with_no_key_each_press_is_recorded_as_before(self, market, stores, body):  # noqa: F811
        PaymentsApi.record_payment(MARKET, ANA, dict(body), EDITOR)

        answer = PaymentsApi.record_payment(MARKET, ANA, dict(body), EDITOR)

        assert len(answer["payments"]) == 2
        assert all("request_key" not in doc for doc in stores.payments.documents)

    @pytest.mark.parametrize("key", ["", "not-a-key", "0b6f6c55", 5, True, ["a"], {"$ne": ""}])
    def test_a_key_that_is_not_a_uuid_is_refused(self, market, stores, key):  # noqa: F811
        with pytest.raises(BadRequestError) as refused:
            pay(key=key)

        assert refused.value.message == NOT_A_UUID
        assert stores.payments.documents == []

    def test_a_refund_refuses_a_key_that_is_not_one(self, admin, stores):  # noqa: F811
        with pytest.raises(BadRequestError) as refused:
            refund(key="not-a-key")

        assert refused.value.message == NOT_A_UUID

    def test_the_key_is_kept_and_never_answered_or_recorded(self, market, stores):  # noqa: F811
        answer = pay()

        [doc] = stores.payments.documents
        assert doc["request_key"] == KEY
        [entry] = answer["payments"]
        assert not {"requestKey", "request_key"} & set(entry)
        [written] = recorded(stores, "record-payment")
        assert KEY not in repr(written)

    def test_the_body_it_was_sent_in_is_left_as_it_was(self, market):  # noqa: F811
        body = {**FIELDS, "requestKey": KEY}

        PaymentsApi.record_payment(MARKET, ANA, body, EDITOR)

        assert body["requestKey"] == KEY


class TestTheIndex:
    def test_the_boot_builds_it_partial_to_string_keys(self, monkeypatch):
        payments = VendorDays(name="payments")
        monkeypatch.setattr(Payments, "payments_collection", payments)
        monkeypatch.setattr(Payments, "amounts_owed_collection", VendorDays(name="amounts_owed"))

        app_module.verify_payment_indexes()

        [(keys, options)] = payments.built
        assert keys == [("market_id", 1), ("request_key", 1)]
        assert options == {"unique": True, "name": "payments_request_key_unique",
                           "partialFilterExpression": {"request_key": {"$type": "string"}}}

    def test_a_boot_that_cannot_build_it_refuses_naming_no_address(self, monkeypatch, caplog):
        monkeypatch.setattr(Payments, "payments_collection",
                            VendorDays(name="payments", build_fails=True))
        monkeypatch.setattr(Payments, "amounts_owed_collection", VendorDays(name="amounts_owed"))

        with caplog.at_level(logging.CRITICAL), pytest.raises(UniqueIndexes.UniqueIndexError):
            app_module.verify_payment_indexes()

        [logged] = [r for r in caplog.records if r.levelno == logging.CRITICAL]
        assert logged.getMessage().startswith(
            "Refusing to start: The unique index payments_request_key_unique on payments ")
        assert ANA not in caplog.text
