"""The export's money columns and its payment filter (E42/F01/S04).

A payment reminder is one export: the vendors who still owe, with their name, address and the
amount still owed. The columns are the vendor's price group, the amount owed, the amount paid and
the difference, each read from the same account the drawer's Payment tab reads
(``api.payments.vendor_account``), so a file and a Payment tab never disagree; the filter is the
Payment tab's own reading of the two, "Owes", "Paid in full" or "Paid more than owed".

A money cell is written by the server from whole cents, never from anyone's text, so it is not
escaped as text: a negative difference, "-$15", reaches the spreadsheet as the number it is.
"""
import copy
import csv
import io

import pytest

from conftest import FakeMarketsCollection, stored_market

import api.market_actions as Actions
import api.markets as MarketsApi
import api.payments as PaymentsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.vendor_export as VendorExport
import essential_fields as EF
import payments as Payments
import pricing as Pricing
from assignment.csv_output import FORMULA_LEADS
from client_errors import BadRequestError
from datatypes import MarketPhase, PaymentEntry
from test_price_groups import CLUBS, EXAMPLE_TABLE, FIELDS, STUDENT

MARKET = "market-123"
EDITOR = "editor@example.com"
SAT, SUN = "2099-05-07", "2099-05-08"
ANA, BEN, CY, DEE, EVE = (f"{name}@example.com" for name in ("ana", "ben", "cy", "dee", "eve"))

PLAN = {
    "priority": [],
    "marketDates": [{"date": SAT}, {"date": SUN}],
    "tiers": [{"id": 1, "name": "Gold"}, {"id": 2, "name": "Silver"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [
        {"name": "North Wing", "location": {"name": "Main Hall"}, "tier": {"id": 1, "name": "Gold"},
         "count": 4},
        {"name": "Landing", "location": {"name": "Main Hall"},
         "tier": {"id": 2, "name": "Silver"}, "count": 4},
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
    "pricing": {"currency": "CAD", "halfTablePercent": 50,
                "everyoneElse": [{"tier": "Gold", "cents": 3500}, {"tier": "Silver", "cents": 3000}]},
}

NAMES = {ANA: "Ana Lima", BEN: "Ben Okafor", CY: "Cy Tan", DEE: "Dee Park", EVE: "Eve Moss"}


class LiveMarket(FakeMarketsCollection):
    """The one market, applying each ``$set`` as Mongo does, so a placement written is read back."""

    def update_one(self, _filter, update):
        result = super().update_one(_filter, update)
        for key, value in (update.get("$set") or {}).items():
            *parents, last = key.split(".")
            target = self.doc
            for part in parents:
                target = target.setdefault(part, {})
            target[last] = copy.deepcopy(value)
        return result


def _seat(email, date, table_code, choice="Full Table"):
    PlacementsApi.write_placement(
        MARKET, {"email": email, "date": date, "table_code": table_code, "table_choice": choice},
        EDITOR)


def _pay(email, cents, kind=Payments.PAYMENT):
    Payments.record_payment(
        MARKET, email, PaymentEntry(cents=cents, method="cash", paid_on="2099-04-01"), EDITOR, kind)


@pytest.fixture
def market(monkeypatch, applications):
    """A priced market in assignment, each vendor in one of the payment states:

    - Ana, a Gold full table on both days, nothing paid: owes $70.
    - Ben, a Gold full table on Saturday, $35 paid: paid in full.
    - Cy, a Silver half table on Sunday ($15), $30 paid: paid $15 more than owed.
    - Dee, no table and nothing paid: nothing owed.
    - Eve, a Gold table freed on Saturday, its $35 line kept, $10 paid: owes $25.
    """
    live = LiveMarket(stored_market(
        phase=MarketPhase.ASSIGNMENT, setupObject=copy.deepcopy(PLAN),
        applicationForm={"fields": copy.deepcopy(FIELDS)}))
    monkeypatch.setattr(MarketsApi, "markets_collection", live)
    monkeypatch.setattr(MarketsApi, "_load_organization", lambda _org_id: None)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    for email, name in NAMES.items():
        applications.insert_one({
            "id": f"app-{email}", "market_id": MARKET, "applicant_email": email,
            "form_data": {EF.FULL_NAME_KEY: name}, "status": "reviewer_approved",
            "application_type": "main", "submitted_at": "2026-10-01T00:00:00Z"})
    _seat(ANA, SAT, "North Wing 1")
    _seat(ANA, SUN, "North Wing 1")
    _seat(BEN, SAT, "North Wing 2")
    _seat(CY, SUN, "Landing 1", "Half Table (Left)")
    _seat(EVE, SAT, "North Wing 3")
    PlacementsApi.remove_placement(MARKET, EVE, SAT, EDITOR)
    _pay(BEN, 3500)
    _pay(CY, 3000)
    _pay(EVE, 1000)
    return live


def _export(filters=None, columns=("email", "owed", "paid", "stillOwed")):
    body = {"filters": filters or {}, "columns": list(columns)}
    content, _name = VendorExport.export(MARKET, body, EDITOR)
    return list(csv.reader(io.StringIO(content.lstrip("﻿"))))


def _by_email(rows):
    return {row[0]: row[1:] for row in rows[1:]}


class TestTheMoneyColumns:
    def test_they_are_offered_under_payment(self, market):
        offered, _ = VendorExport.preview(MARKET, {"filters": {}}, EDITOR)
        money = [(c["id"], c["label"]) for c in offered["offered"]["columns"]
                 if c["group"] == "payment"]

        assert money == [("priceGroup", "Price group"), ("owed", "Amount owed"),
                         ("paid", "Amount paid"), ("stillOwed", "Still owed")]
        assert {"id": "payment", "label": "Payment"} in offered["offered"]["groups"]

    def test_each_vendor_exports_what_their_payment_tab_reads(self, market):
        rows = _export()

        assert rows[0] == ["Email", "Amount owed", "Amount paid", "Still owed"]
        assert _by_email(rows) == {
            ANA: ["$70", "$0", "$70"],
            BEN: ["$35", "$35", "$0"],
            CY: ["$15", "$30", "-$15"],
            DEE: ["$0", "$0", "$0"],
            EVE: ["$35", "$10", "$25"],
        }
        for email, (owed, paid, _still) in _by_email(rows).items():
            account = PaymentsApi.vendor_account(MARKET, email, EDITOR)
            assert owed == Pricing.money_text(account["owedCents"], "CAD")
            assert paid == Pricing.money_text(account["paidCents"], "CAD")

    def test_an_amount_set_by_hand_and_a_refund_count_as_on_the_payment_tab(self, market):
        Payments.set_amount_owed(MARKET, ANA, SAT, 0, "admin@example.com")
        _pay(CY, 1500, kind=Payments.REFUND)

        got = _by_email(_export())
        assert got[ANA] == ["$35", "$0", "$35"]
        assert got[CY] == ["$15", "$15", "$0"]

    def test_a_negative_difference_is_a_number_not_text(self, market):
        """T103 review note 4: the escape quotes a cell beginning with "-", and a spreadsheet then
        shows the quote or reads text where a number belongs. A money cell is the server's own,
        from whole cents, so it is written as it is."""
        assert _by_email(_export())[CY][2] == "-$15"

    def test_the_price_group_is_the_one_each_seat_is_priced_by(self, market, applications):
        market.doc["setupObject"]["pricing"] = copy.deepcopy(EXAMPLE_TABLE)
        for doc in applications.documents:
            if doc["applicant_email"] == ANA:
                doc["form_data"].update({"affiliation": [STUDENT], "clubs": [CLUBS[0]]})

        got = _by_email(_export(columns=("email", "priceGroup", "owed")))
        assert got[ANA] == ["Example College student + club member", "$24"]
        assert got[BEN][0] == Pricing.EVERYONE_ELSE
        assert got[DEE] == ["", "$0"]

    def test_a_market_with_no_prices_has_no_price_group_and_reads_its_payments(self, market):
        del market.doc["setupObject"]["pricing"]

        got = _by_email(_export(columns=("email", "priceGroup", "owed", "paid", "stillOwed")))
        assert got[ANA] == ["", "$0", "$0", "$0"]
        assert got[BEN] == ["", "$0", "$35", "-$35"]

    def test_an_export_without_money_reads_no_account(self, market, monkeypatch):
        def refuse(_market):
            raise AssertionError("an export with no money column read the accounts")

        monkeypatch.setattr(PaymentsApi, "accounts", refuse)

        assert len(_export(columns=("email", "status"))) == 1 + len(NAMES)

    def test_accounts_answers_every_vendor_as_the_payment_tab_does(self, market):
        market_doc = MarketsApi._load_market_for(MARKET, EDITOR, Actions.READ)
        every = PaymentsApi.accounts(market_doc)

        assert set(every) == {ANA, BEN, CY, EVE}
        for email, account in every.items():
            assert account == PaymentsApi.vendor_account(MARKET, email, EDITOR)

    def test_a_price_group_that_reads_like_a_formula_is_written_as_text(self, market, applications):
        table = copy.deepcopy(EXAMPLE_TABLE)
        table["groups"][0]["name"] = "=SUM(A1)"
        market.doc["setupObject"]["pricing"] = table
        for doc in applications.documents:
            if doc["applicant_email"] == ANA:
                doc["form_data"].update({"affiliation": [STUDENT], "clubs": [CLUBS[0]]})

        assert _by_email(_export(columns=("email", "priceGroup")))[ANA] == ["'=SUM(A1)"]

    @pytest.mark.parametrize("currency, text", [
        ("AUD", "−A$15"), ("USD", "−US$15"), ("NZD", "−NZ$15")])
    def test_a_negative_amount_is_never_a_cell_reference(self, market, currency, text):
        """T154 review finding 1: "-A$15" is a minus and the cell A$15, which Excel opening a CSV
        evaluates, so a refund due would show another row's number. The minus sign, U+2212, is no
        formula lead anywhere."""
        market.doc["setupObject"]["pricing"]["currency"] = currency

        assert _by_email(_export({"payment": "over"}, columns=("email", "stillOwed"))) == {
            CY: [text]}

    def test_only_the_three_amounts_skip_the_escape(self, market):
        """T154 review finding 2: a column written as it is must be one the server writes from its
        own numbers, never anyone's text."""
        market_doc = MarketsApi._load_market_for(MARKET, EDITOR, Actions.READ)

        assert {c.id for c in VendorExport.offered_columns(market_doc) if c.as_is} == {
            "owed", "paid", "stillOwed"}

    def test_a_typed_answer_is_escaped_beside_an_amount_that_is_not(self, market, applications):
        for doc in applications.documents:
            if doc["applicant_email"] == CY:
                doc["form_data"]["business"] = "-1+1"
            if doc["applicant_email"] == ANA:
                doc["form_data"]["business"] = "+1 604 555 0100"

        got = _by_email(_export(columns=("email", "answer:business", "stillOwed")))
        assert got[CY] == ["'-1+1", "-$15"]
        assert got[ANA] == ["'+1 604 555 0100", "$70"]


class TestThePaymentFilter:
    @pytest.mark.parametrize("state, emails", [
        ("owes", {ANA, EVE}),
        ("paid", {BEN}),
        ("over", {CY}),
        ("", {ANA, BEN, CY, DEE, EVE}),
    ])
    def test_it_keeps_the_vendors_in_that_state(self, market, state, emails):
        assert set(_by_email(_export({"payment": state}))) == emails

    def test_owes_is_exactly_the_vendors_whose_payment_tab_reads_owes(self, market):
        owing = {email for email in NAMES
                 if Payments.balance_state(PaymentsApi.vendor_account(MARKET, email, EDITOR))
                 == Payments.OWES}

        assert set(_by_email(_export({"payment": "owes"}))) == owing == {ANA, EVE}

    def test_a_payment_reminder_is_one_export(self, market):
        rows = _export({"payment": "owes"}, columns=("name", "email", "stillOwed"))

        assert rows == [["Name", "Email", "Still owed"],
                        ["Ana Lima", ANA, "$70"], ["Eve Moss", EVE, "$25"]]

    def test_the_preview_offers_the_states_in_the_payment_tabs_words(self, market):
        offered, _ = VendorExport.preview(MARKET, {"filters": {"payment": "over"}}, EDITOR)

        assert offered["offered"]["paymentStates"] == [
            {"id": "owes", "label": "Owes"}, {"id": "paid", "label": "Paid in full"},
            {"id": "over", "label": "Paid more than owed"}]
        assert offered["count"] == 1

    def test_a_state_the_dialog_could_not_have_sent_is_refused(self, market):
        with pytest.raises(BadRequestError):
            _export({"payment": "refund due"})


class TestTheMoneyText:
    @pytest.mark.parametrize("cents, currency, text", [
        (3500, "CAD", "$35"), (1501, "CAD", "$15.01"), (123456750, "CAD", "$1,234,567.50"),
        (-1500, "CAD", "-$15"), (0, "CAD", "$0"), (3500, "USD", "US$35"), (3500, "EUR", "€35"),
        (3500, "GBP", "£35"), (-1500, "AUD", "-A$15"), (3500, "NZD", "NZ$35"),
    ])
    def test_it_reads_as_the_payment_tab_writes_it(self, cents, currency, text):
        """``formatPrice`` in ``front-end/src/utils/pricing.ts``, en-CA, and ``money`` for a
        negative amount: the same text in the file as on screen."""
        assert Pricing.money_text(cents, currency) == text

    def test_every_offered_currency_has_its_symbol(self):
        for currency in Pricing.CURRENCIES:
            assert Pricing.money_text(100, currency).endswith("1")

    @pytest.mark.parametrize("cents, currency, cell", [
        (-1500, "CAD", "-$15"), (-1500, "EUR", "-€15"), (-1500, "GBP", "-£15"),
        (-1500, "AUD", "−A$15"), (-1500, "USD", "−US$15"), (-150050, "NZD", "−NZ$1,500.50"),
        (3500, "AUD", "A$35"), (0, "USD", "US$0"),
    ])
    def test_a_file_writes_it_so_no_spreadsheet_reads_a_formula(self, cents, currency, cell):
        """A file's amount is the screen's, but where a minus would lead a currency's letters, a
        cell reference ("-A$15", "-US$15", "-NZ$15"), it is the minus sign U+2212 (finding 1)."""
        assert VendorExport.money_cell(cents, currency) == cell

    @pytest.mark.parametrize("currency", [*Pricing.CURRENCIES, None])
    @pytest.mark.parametrize("cents", [-123456750, -1500, -1, 0, 1, 3500])
    def test_no_amount_in_a_file_begins_a_formula(self, cents, currency):
        """Why a money column may skip ``as_text_cell``: it begins with no formula lead, or with a
        minus before a sign that is no letter, a number to a spreadsheet ("-$15")."""
        cell = VendorExport.money_cell(cents, currency)

        assert not cell.startswith(FORMULA_LEADS) or (
            cell.startswith("-") and not cell[1].isalpha() and not cell[1:].startswith(FORMULA_LEADS))
