"""An Admin changes the amount owed and the amount paid; freeing a table asks (E44/F01/S02).

The pricing sets what a table-day owes, and an Admin may change it: $0 is how a fee is waived
(Daniel, T92 Q26: "instead of a button to waive, the admin will set amount owed to zero"). Freeing
a table asks whether it is still owed, so a refund to issue shows as paid more than owed; once the
refund is given back, an Admin records it, and the account squares. Each change confirms on screen
and is recorded in the market's history.
"""
import pytest

import api.markets as MarketsApi
import api.payments as PaymentsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import history as History
from client_errors import BadRequestError, ForbiddenError, NotFoundError
from datatypes import MarketPhase, MarketRole
from test_a_vendors_payments import ANA, EDITOR, MARKET, SAT, SUN, market, stores  # noqa: F401

ADMIN = "admin@example.com"


@pytest.fixture
def holding(monkeypatch):
    """The asker holds this role, every check asking its row of it."""
    def hold(role):
        monkeypatch.setattr(
            PermissionsApi, "user_has_permission",
            lambda _u, _m, required, *_a, **_k: PermissionsApi.role_reaches(role, required))
    return hold


@pytest.fixture
def admin(market, holding):  # noqa: F811
    holding(MarketRole.ADMIN)
    return market


def account():
    return PaymentsApi.vendor_account(MARKET, ANA, ADMIN)


def line(date):
    return next(line for line in account()["lines"] if line["date"] == date)


def pay(cents, by=EDITOR):
    return PaymentsApi.record_payment(
        MARKET, ANA, {"cents": cents, "method": "cash", "paidOn": "2099-04-01"}, by)


def entries(stores, action):  # noqa: F811
    return [entry for entry in stores.history.documents if entry["action"] == action]


class TestChangingTheAmountOwed:
    def test_an_admin_sets_a_line_to_zero_and_the_total_drops(self, admin):
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 0}, ADMIN)

        got = account()
        assert got["owedCents"] == 3500
        sunday = line(SUN)
        assert (sunday["owedCents"], sunday["priceCents"]) == (0, 3500)
        assert sunday["owedSetBy"] == ADMIN
        assert sunday["owedSetAt"]

    def test_the_calculated_price_comes_back(self, admin):
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 1000}, ADMIN)

        got = PaymentsApi.use_calculated_price(MARKET, ANA, SUN, ADMIN)

        assert got["owedCents"] == 7000
        assert line(SUN)["owedSetBy"] is None

    def test_each_change_is_recorded_with_who_and_before_and_after(self, admin, stores):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 0}, ADMIN)
        PaymentsApi.use_calculated_price(MARKET, ANA, SUN, ADMIN)

        set_, back = entries(stores, "change-owed")
        assert (set_["kind"], set_["actor"], set_["vendors"], set_["subject"]) == (
            History.OWED_SET, ADMIN, [ANA], {"date": SUN})
        assert set_["detail"] == {"before": {"owed_cents": 3500}, "after": {"owed_cents": 0}}
        assert back["kind"] == History.OWED_CALCULATED
        assert back["detail"] == {"before": {"owed_cents": 0}, "after": {"owed_cents": 3500}}

    def test_taking_back_an_amount_nobody_set_records_nothing(self, admin, stores):  # noqa: F811
        PaymentsApi.use_calculated_price(MARKET, ANA, SUN, ADMIN)

        assert entries(stores, "change-owed") == []

    def test_a_day_with_no_line_is_refused(self, admin):
        with pytest.raises(NotFoundError):
            PaymentsApi.set_amount_owed(MARKET, "ben@example.com", SUN, {"cents": 0}, ADMIN)

    @pytest.mark.parametrize("body", [
        {"cents": -1}, {"cents": "0"}, {"cents": 1.5}, {"cents": True}, {"cents": 10_000_001}, {},
    ])
    def test_an_amount_that_is_not_one_is_refused(self, admin, body):
        with pytest.raises(BadRequestError):
            PaymentsApi.set_amount_owed(MARKET, ANA, SUN, body, ADMIN)
        assert line(SUN)["owedCents"] == 3500


class TestFreeingATableAsks:
    def test_ticked_the_line_owes_nothing_and_paid_stays(self, admin, stores):  # noqa: F811
        pay(7000)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["priceCents"]) == (True, 0, 3500)
        got = account()
        assert (got["owedCents"], got["paidCents"]) == (3500, 7000)
        [deducted] = entries(stores, "change-owed")
        assert deducted["detail"] == {"before": {"owed_cents": 3500}, "after": {"owed_cents": 0}}

    def test_a_refund_then_squares_the_account(self, admin, stores):  # noqa: F811
        pay(7000)
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        got = PaymentsApi.record_refund(
            MARKET, ANA, {"cents": 3500, "method": "e-transfer", "paidOn": "2099-04-10",
                          "note": "Cancelled before the deadline"}, ADMIN)

        assert (got["owedCents"], got["paidCents"]) == (3500, 3500)
        refund = got["payments"][0]
        assert (refund["kind"], refund["cents"]) == ("refund", -3500)
        [recorded] = entries(stores, "adjust-paid")
        assert recorded["kind"] == History.REFUND_RECORDED
        assert recorded["detail"]["after"]["cents"] == -3500

    def test_unticked_the_line_stays_owed(self, admin):
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"]) == (True, 3500)

    def test_an_editor_may_not_deduct_and_nothing_is_freed(self, market, holding, stores):  # noqa: F811
        holding(MarketRole.EDITOR)

        with pytest.raises(ForbiddenError):
            PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR, deduct_owed=True)

        assert len(market.doc["assignmentObject"]["vendorAssignments"]) == 2
        assert stores.owed.documents == []


class TestAdjustingTheAmountPaid:
    def test_an_edit_keeps_what_the_entry_read_before(self, admin, stores):  # noqa: F811
        paid = pay(3000)["payments"][0]

        got = PaymentsApi.edit_payment(
            MARKET, paid["id"], {"cents": 3500, "method": "cash", "paidOn": "2099-04-01",
                                 "note": "Miscounted"}, ADMIN)

        edited = got["payments"][0]
        assert (edited["cents"], edited["note"], edited["editedBy"]) == (3500, "Miscounted", ADMIN)
        assert got["paidCents"] == 3500
        [kept] = stores.payments.documents[0]["changes"]
        assert (kept["by"], kept["what"], kept["before"]["cents"]) == (ADMIN, "edited", 3000)
        [recorded] = entries(stores, "adjust-paid")
        assert recorded["kind"] == History.PAYMENT_EDITED
        assert recorded["subject"] == {"payment_id": paid["id"]}
        assert recorded["detail"] == {"before": {"cents": 3000, "note": None},
                                      "after": {"cents": 3500, "note": "Miscounted"}}

    def test_a_removal_takes_it_out_of_what_is_paid_and_keeps_it(self, admin, stores):  # noqa: F811
        paid = pay(3500)["payments"][0]

        got = PaymentsApi.remove_payment(MARKET, paid["id"], ADMIN)

        assert got["paidCents"] == 0
        removed = got["payments"][0]
        assert (removed["removedBy"], bool(removed["removedAt"])) == (ADMIN, True)
        [recorded] = entries(stores, "adjust-paid")
        assert recorded["kind"] == History.PAYMENT_REMOVED
        assert recorded["detail"]["after"] == {"cents": None, "method": None, "paid_on": None}

    def test_a_removed_entry_is_not_changed_again(self, admin):
        paid = pay(3500)["payments"][0]
        PaymentsApi.remove_payment(MARKET, paid["id"], ADMIN)

        with pytest.raises(NotFoundError):
            PaymentsApi.remove_payment(MARKET, paid["id"], ADMIN)
        with pytest.raises(NotFoundError):
            PaymentsApi.edit_payment(
                MARKET, paid["id"], {"cents": 1, "method": "cash", "paidOn": "2099-04-01"}, ADMIN)

    def test_another_markets_entry_is_not_found(self, admin, stores):  # noqa: F811
        paid = pay(3500)["payments"][0]
        stores.payments.documents[0]["market_id"] = "another-market"

        with pytest.raises(NotFoundError):
            PaymentsApi.remove_payment(MARKET, paid["id"], ADMIN)

    def test_a_refund_refuses_what_a_payment_refuses(self, admin):
        with pytest.raises(BadRequestError):
            PaymentsApi.record_refund(
                MARKET, ANA, {"cents": 0, "method": "cash", "paidOn": "2099-04-01"}, ADMIN)


class TestAnEditorChangesNeither:
    @pytest.fixture
    def editor(self, market, holding):  # noqa: F811
        paid = pay(3500)["payments"][0]
        holding(MarketRole.EDITOR)
        return paid

    @pytest.mark.parametrize("write", [
        lambda paid: PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 0}, EDITOR),
        lambda paid: PaymentsApi.use_calculated_price(MARKET, ANA, SUN, EDITOR),
        lambda paid: PaymentsApi.record_refund(
            MARKET, ANA, {"cents": 100, "method": "cash", "paidOn": "2099-04-01"}, EDITOR),
        lambda paid: PaymentsApi.edit_payment(
            MARKET, paid["id"], {"cents": 1, "method": "cash", "paidOn": "2099-04-01"}, EDITOR),
        lambda paid: PaymentsApi.remove_payment(MARKET, paid["id"], EDITOR),
    ], ids=["set owed", "calculated price", "refund", "edit", "remove"])
    def test_the_write_refuses_them(self, editor, stores, write):  # noqa: F811
        with pytest.raises(ForbiddenError) as refused:
            write(editor)

        assert str(refused.value).startswith("Only an Admin or the owner may")
        assert stores.owed.documents == []
        assert len(stores.payments.documents) == 1
        assert "changes" not in stores.payments.documents[0]

    def test_the_market_tells_the_screen_neither_is_theirs(self, editor):
        refusals = MarketsApi.role_action_refusals(MarketRole.EDITOR, MarketPhase.MARKET_DAYS, {})

        assert refusals["change-owed"] and refusals["adjust-paid"]
        assert refusals["record-payment"] is None
