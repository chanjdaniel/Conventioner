"""Unit tests for PR 1 data-model foundation: MarketPhase, ApplicationForm, Application,
backward compatibility, and migration idempotency."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import (
    Application, ApplicationForm, ApplicationStatus, ApplicationType,
    AssignmentObject, AssignmentOptionObject,
    FormField, Market, MarketDateObject, MarketPhase, MarketRole,
    PriorityObject, SetupObject,
)


class TestMarketPhaseEnum:
    def test_all_eight_values(self):
        assert MarketPhase.DRAFT == "draft"
        assert MarketPhase.APPLICATIONS_OPEN == "applications_open"
        assert MarketPhase.APPLICATIONS_CLOSED == "applications_closed"
        assert MarketPhase.REVIEW == "review"
        assert MarketPhase.ASSIGNMENT == "assignment"
        assert MarketPhase.OFFERS == "offers"
        assert MarketPhase.MARKET_DAYS == "market_days"
        assert MarketPhase.ARCHIVED == "archived"
        assert len(MarketPhase) == 8

    def test_is_string_enum(self):
        assert isinstance(MarketPhase.DRAFT, str)


class TestApplicationStatusEnum:
    def test_all_ten_values(self):
        assert ApplicationStatus.OPEN == "open"
        assert ApplicationStatus.UNDER_REVIEW == "under_review"
        assert ApplicationStatus.REVIEWER_APPROVED == "reviewer_approved"
        assert ApplicationStatus.REVIEWER_REJECTED == "reviewer_rejected"
        assert ApplicationStatus.UNASSIGNED == "unassigned"
        assert ApplicationStatus.ASSIGNED == "assigned"
        assert ApplicationStatus.ASSIGNMENT_SENT == "assignment_sent"
        assert ApplicationStatus.VENDOR_ACCEPTED == "vendor_accepted"
        assert ApplicationStatus.VENDOR_REFUSED == "vendor_refused"
        assert ApplicationStatus.CANCELLED == "cancelled"
        assert len(ApplicationStatus) == 10


class TestApplicationTypeEnum:
    def test_values(self):
        assert ApplicationType.MAIN == "main"
        assert ApplicationType.WAITLIST == "waitlist"


class TestFormField:
    def test_minimal_construction(self):
        field = FormField(key="name", label="Name", type="text")
        assert field.key == "name"
        assert field.label == "Name"
        assert field.type == "text"

    def test_defaults(self):
        field = FormField(key="email", label="Email", type="email")
        assert field.required is False
        assert field.options == []
        assert field.help_text is None
        assert field.order == 0

    def test_full_construction(self):
        field = FormField(
            key="size", label="Size", type="select",
            required=True,
            options=["Small", "Medium", "Large"],
            help_text="Choose your booth size",
            order=3,
        )
        assert field.required is True
        assert field.options == ["Small", "Medium", "Large"]
        assert field.help_text == "Choose your booth size"
        assert field.order == 3


class TestApplicationForm:
    def test_empty_fields(self):
        form = ApplicationForm(fields=[])
        assert form.fields == []
        assert form.published_at is None

    def test_with_fields(self):
        form = ApplicationForm(
            fields=[
                FormField(key="name", label="Name", type="text"),
                FormField(key="email", label="Email", type="email", required=True),
            ],
            published_at="2025-06-01T00:00:00",
        )
        assert len(form.fields) == 2
        assert form.published_at == "2025-06-01T00:00:00"


class TestApplication:
    def test_minimal_construction(self):
        app = Application(
            market_id="market-1",
            applicant_email="vendor@example.com",
            form_data={"name": "My Shop"},
            status=ApplicationStatus.OPEN,
        )
        assert app.id is not None
        assert app.market_id == "market-1"
        assert app.applicant_email == "vendor@example.com"
        assert app.form_data == {"name": "My Shop"}
        assert app.status == ApplicationStatus.OPEN
        assert app.application_type == ApplicationType.MAIN
        assert app.main_application_id is None
        assert app.submitted_at is None
        assert app.otp is None
        assert app.otp_expires is None
        assert app.otp_attempts == 0
        assert app.assigned_reviewer_id is None

    def test_waitlist_application(self):
        app = Application(
            market_id="market-1",
            applicant_email="vendor@example.com",
            form_data={"name": "My Shop"},
            status=ApplicationStatus.OPEN,
            application_type=ApplicationType.WAITLIST,
            main_application_id="main-app-1",
        )
        assert app.application_type == ApplicationType.WAITLIST
        assert app.main_application_id == "main-app-1"

    def test_assigned_reviewer(self):
        app = Application(
            market_id="market-1",
            applicant_email="vendor@example.com",
            form_data={},
            status=ApplicationStatus.UNDER_REVIEW,
            assigned_reviewer_id="reviewer-1",
        )
        assert app.status == ApplicationStatus.UNDER_REVIEW
        assert app.assigned_reviewer_id == "reviewer-1"


class TestMarketDefaults:
    def test_new_market_phase_defaults_to_draft(self):
        market = Market(
            name="Test Market",
            creation_date="2025-01-01",
            roles={"owner-1": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject(),
        )
        assert market.phase == MarketPhase.DRAFT

    def test_new_market_is_draft_remains_true(self):
        market = Market(
            name="Test Market",
            creation_date="2025-01-01",
            roles={"owner-1": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject(),
        )
        assert market.is_draft is True

    def test_new_market_optional_fields_default_to_none(self):
        market = Market(
            name="Test Market",
            creation_date="2025-01-01",
            roles={"owner-1": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject(),
        )
        assert market.application_form is None
        assert market.review_config is None
        assert market.discord_guild_id is None

    def test_market_with_application_form(self):
        form = ApplicationForm(fields=[FormField(key="name", label="Name", type="text")])
        market = Market(
            name="Test Market",
            creation_date="2025-01-01",
            roles={"owner-1": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject(),
            application_form=form,
            review_config={"reviewer_ids": ["r1"]},
            discord_guild_id="guild-123",
        )
        assert market.application_form is not None
        assert len(market.application_form.fields) == 1
        assert market.review_config == {"reviewer_ids": ["r1"]}
        assert market.discord_guild_id == "guild-123"

    def test_explicit_phase(self):
        market = Market(
            name="Test Market",
            creation_date="2025-01-01",
            roles={"owner-1": MarketRole.OWNER},
            modification_list=[],
            assignment_object=AssignmentObject(),
            phase=MarketPhase.ARCHIVED,
        )
        assert market.phase == MarketPhase.ARCHIVED


def _make_existing_market_doc(**overrides):
    doc = {
        "id": "existing-market-1",
        "name": "Existing Market",
        "creation_date": "2025-01-01",
        "roles": {"owner1": "owner"},
        "organization_id": None,
        "theme": None,
        "setup_object": {
            "col_names": ["Email", "Date", "TableChoice"],
            "col_values": [
                ["vendor@example.com"],
                ["2025-03-15"],
                ["Full table"],
            ],
            "col_include": [True, True, True],
            "enum_priority_order": [[], [], []],
            "priority": [
                {"id": 1, "col_name_idx": 0, "data_type": "String", "sorting_order": "asc"},
            ],
            "market_dates": [
                {"date": "2025-03-15", "col_name_idx": 1, "col_name": "Date"},
            ],
            "tiers": [{"id": 1, "name": "Gold"}],
            "locations": [{"name": "Main Hall"}],
            "sections": [
                {
                    "name": "A",
                    "location": {"name": "Main Hall"},
                    "tier": {"id": 1, "name": "Gold"},
                    "count": 10,
                },
            ],
            "assignment_options": {
                "email_col_name_idx": 0,
                "table_choice_col_name_idx": 2,
                "table_share_email_col_name_idx": None,
                "max_days_col_name_idx": None,
                "max_assignments_per_vendor": 4,
                "max_half_table_proportion_per_section": 100,
            },
            "floorplans": None,
        },
        "modification_list": [],
        "assignment_object": {
            "vendor_assignments": [],
            "assignment_date": "2025-01-02",
        },
        "is_draft": False,
        "discord_webhook_url": None,
    }
    doc.update(overrides)
    return doc


class TestBackwardCompatibility:
    def test_existing_published_market_loads_without_phase_field(self):
        doc = _make_existing_market_doc(
            id="published-mkt",
            is_draft=False,
        )
        market = Market(**doc)
        assert market.id == "published-mkt"
        assert market.is_draft is False
        assert market.phase == MarketPhase.DRAFT  # default when field absent

    def test_existing_draft_market_loads_without_phase_field(self):
        doc = _make_existing_market_doc(
            id="draft-mkt",
            is_draft=True,
        )
        market = Market(**doc)
        assert market.id == "draft-mkt"
        assert market.is_draft is True
        assert market.phase == MarketPhase.DRAFT

    def test_existing_setup_object_csv_fields_preserved(self):
        doc = _make_existing_market_doc()
        market = Market(**doc)
        setup = market.setup_object
        assert setup is not None
        assert setup.col_names == ["Email", "Date", "TableChoice"]
        assert setup.col_values == [
            ["vendor@example.com"],
            ["2025-03-15"],
            ["Full table"],
        ]
        assert setup.col_include == [True, True, True]
        assert setup.enum_priority_order == [[], [], []]
        assert setup.priority[0].col_name_idx == 0
        assert setup.market_dates[0].col_name_idx == 1
        assert setup.market_dates[0].col_name == "Date"

    def test_existing_market_with_phase_field_respected(self):
        doc = _make_existing_market_doc(
            id="archived-mkt",
            phase="archived",
            is_draft=False,
        )
        market = Market(**doc)
        assert market.phase == MarketPhase.ARCHIVED

    def test_existing_market_with_null_setup_object(self):
        doc = _make_existing_market_doc()
        doc["setup_object"] = None
        market = Market(**doc)
        assert market.setup_object is None


class TestSetupObjectOptionalCsvFields:
    def test_new_market_with_empty_csv_fields(self):
        setup = SetupObject(
            priority=[],
            market_dates=[],
            tiers=[],
            locations=[],
            sections=[],
            assignment_options=AssignmentOptionObject(),
        )
        assert setup.col_names == []
        assert setup.col_values == []
        assert setup.col_include == []
        assert setup.enum_priority_order == []

    def test_new_market_without_csv_fields_in_constructor(self):
        setup = SetupObject(
            priority=[],
            market_dates=[],
            tiers=[],
            locations=[],
            sections=[],
            assignment_options=AssignmentOptionObject(),
        )
        # CSV fields default to empty lists
        assert isinstance(setup.col_names, list)


class TestColNameIdxOptional:
    def test_market_date_without_col_name_idx(self):
        md = MarketDateObject(date="2025-01-15")
        assert md.date == "2025-01-15"
        assert md.col_name_idx is None

    def test_priority_without_col_name_idx(self):
        from datatypes import DataType
        p = PriorityObject(id=1, data_type=DataType.STRING, sorting_order="asc")
        assert p.col_name_idx is None
