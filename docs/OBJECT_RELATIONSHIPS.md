# Object Relationships Overview

This document provides a comprehensive audit of all types, objects, and their relationships within the Conventioner system.

## Table of Contents
1. [Core Domain Objects](#core-domain-objects)
2. [Market Configuration Objects](#market-configuration-objects)
3. [Assignment Objects](#assignment-objects)
4. [Application Objects](#application-objects)
5. [Supporting Types](#supporting-types)
6. [Database Collections](#database-collections)
7. [Relationship Diagrams](#relationship-diagrams)
8. [Data Flow](#data-flow)
9. [Permission System](#permission-system)

---

## Core Domain Objects

### User
**Location:** `back-end/datatypes.py`

Represents a user account in the system.

**Fields:**
- `id: str` - UUID, immutable primary key
- `email: str` - Unique identifier for login/auth
- `password: str` - Hashed password for authentication
- `organizations: List[str]` - List of organization ids the user belongs to

**Relationships:**
- **Many-to-Many with Organization**: Users can belong to multiple organizations (via `organizations` list of org ids). User's role in organization is stored in the Organization object (owner/admins/members as user ids).
- **Many-to-Many with Market**: Users can have access to multiple markets via explicit roles in `Market.roles` dict or through organization membership.
- **Stored in**: MongoDB `users` collection

**Related Classes:**
- `AuthUser` (in `api/users.py:10-14`) - Flask-Login wrapper that extends `UserMixin` for authentication

**Note:** User no longer maintains a `markets` list. Market access is determined dynamically through:
1. Explicit roles in `Market.roles` dictionary
2. Organization membership (grants VIEWER permission on organization's markets)

---

### Organization
**Location:** `back-end/datatypes.py`

Represents an organization that can contain multiple users and markets with hierarchical role-based access control.

**Fields:**
- `id: str` - UUID, immutable primary key
- `name: str` - Mutable display name
- `owner: str` - User id of the organization owner (exactly 1, references User.id)
- `admins: List[str]` - List of admin user ids (0+)
- `members: List[str]` - List of member user ids (0+)
- `markets: List[str]` - List of market ids owned by this organization
- `theme: Optional[ThemeObject]` - Organization theming (applied to all organization markets)

**Relationships:**
- **Many-to-Many with User**: Organizations contain multiple users with different roles (owner/admins/members)
- **One-to-Many with Market**: Organizations can own multiple markets (via `markets` list and `Market.organization_id` field). Because every new market requires an organization, a user must belong to at least one organization before they can create a market.
- **Stored in**: MongoDB `organizations` collection

**Role Hierarchy:**
- **Owner** (exactly 1): Can manage admins and members, has full control
- **Admin** (0+): Can manage members, has full control
- **Member** (0+): Has access to organization markets

**Validation:**
- Owner cannot be in admins or members lists
- Validated via Pydantic model validator

**Key Operations:**
- Organization CRUD via `api/organizations.py`
- Role management (add/remove admins/members, transfer ownership)

---

### Market
**Location:** `back-end/datatypes.py`

The central entity representing a market event with configuration, assignments, and role-based access control.

**Fields:**
- `id: str` - UUID, immutable primary key
- `name: str` - Mutable display name
- `creation_date: str` - ISO format date string when market was created
- `roles: Dict[str, MarketRole]` - Map of user_id -> role (must contain exactly one OWNER)
- `organization_id: Optional[str]` - Organization id the market belongs to. **Required at creation**: `POST /markets` rejects a payload without `organizationId`, with an unknown organization id, or with an organization the requesting user does not belong to (all 400). The field stays `Optional` in the model only so that org-less markets created before this rule remain readable; new markets always have one.
- `theme: Optional[ThemeObject]` - Market-specific theme (used if no organization, otherwise organization theme takes precedence)
- `setup_object: Optional[SetupObject]` - Market configuration and setup data
- `modification_list: List[ModificationObject]` - List of modifications (currently empty structure)
- `assignment_object: AssignmentObject` - Contains vendor assignment results and statistics
- `phase: MarketPhase` - Market lifecycle phase, and the **single source of truth** for where a market is in its life. Default **`DRAFT`**. Advanced only through `POST /markets/<market_id>/transition`. While the market is in `draft`, opening it from the dashboard or Markets sends the user to market setup; past `draft` the SPA routes to `/{kebab-case-slug}` derived from the market **name** (e.g. `my-summer-market`), and the public check-in URL resolves. See [MarketPhase](#marketphase-enum).
- `is_draft: bool` - Stored as `isDraft` in MongoDB (camelCase). A Pydantic `@computed_field` **derived strictly from `phase`** (`true` exactly when `phase == draft`), never independently writable: no request body can set it, and it is recomputed from the stored phase on every write. It is still persisted, and kept in agreement with `phase` by every writer, for exactly one reason: it is the fallback `phase_from_market_document()` drops to when a document's `phase` is missing or unrecognized. Nothing reads the stored value for a market whose `phase` this build understands - a fallback that disagreed with the phase would answer confidently and wrongly. Treat it as a persisted view of `phase`, never as state of its own.
- `application_form: Optional[ApplicationForm]` - Application form definition for application-based markets (None for CSV-based markets). Server-owned on update: only `PUT /markets/<market_id>/application-form` writes it (see [ApplicationForm](#applicationform))
- `review_config: Optional[Dict[str, Any]]` - Free-form review configuration (reviewer pool, etc.); no fixed schema yet
- `discord_guild_id: Optional[str]` - Per-market Discord guild reference (integration seam; not yet consumed)
- `discord_webhook_url: Optional[str]` - Per-market Discord webhook target for assignment notifications (omitted/blank disables Discord notifications)

**Relationships:**
- **Many-to-Many with User**: Markets have multiple users with different roles (via `roles` dict, keys are user ids)
- **Many-to-One with Organization**: Every market belongs to exactly one organization (via `organization_id` field, enforced at creation)
- **One-to-One with SetupObject**: Each market has one setup configuration (optional)
- **One-to-One with AssignmentObject**: Each market has one assignment result object
- **One-to-One with SourceData**: Each market can have one source data CSV (stored separately in MongoDB)
- **One-to-One with ApplicationForm**: Each market can have one application form (embedded, optional)
- **One-to-Many with Application**: Applications reference the market via `Application.market_id`. The `applications` collection exists, the market write path counts it (the D9 form lock), and `api/applications.find_or_create_application` can write to it - see [Application Objects](#application-objects)
- **Stored in**: MongoDB `markets` collection

**Server-Owned Fields:**
- `phase` is lifecycle state owned by the server, never by a client update body. `create_market()` always persists `phase: "draft"`, and `update_market()` re-applies the stored phase over whatever the payload contained. The one way to change it after creation is `POST /markets/<market_id>/transition`, which evaluates the guard registry before it writes (see [MarketPhase](#marketphase-enum)).
- `is_draft` is not owned by anything either: it is *computed* from `phase` on the model, and rewritten from the stored phase on every write path (`create_market()` stamps `true` alongside `phase: "draft"`; `update_market()` re-derives it from the stored phase; the transition endpoint sets both fields in one atomic update). A PUT body carrying `isDraft` is ignored, so a client cannot publish a market by flipping the flag - it must transition the phase.
- On read, the phase a market reports is always derived from its stored document by `phase_from_market_document()` (`back-end/datatypes.py`), never taken from the raw document as-is. Documents written before the field existed have no `phase`, so the detail endpoint, the market list, and every internal parse (`market_from_document()` in `back-end/market_documents.py`) run the same `isDraft` fallback and cannot disagree about what phase a market is in. The two endpoints that serve a *raw* document rather than a parsed `Market` (the detail endpoint and the market list) additionally re-stamp `isDraft` from that effective phase before responding, so a document the old publish flow left self-contradictory (`phase: "draft"` + `isDraft: false`) never goes out over the wire with its two fields disagreeing.
- `application_form` is written on an existing market only by `PUT /markets/<market_id>/application-form`. `update_market()` always re-applies the stored form over whatever the market payload contained, so a stale client copy cannot revert a saved form and no market PUT can bypass the D9 lock. `POST /markets` may still carry a form on the create body, and it goes through the same validation and normalization as the dedicated endpoint.
- `review_config` and `discord_guild_id` are carried over on update whenever the payload omits them, so a client that round-trips a market it fetched cannot accidentally null them out. Passing an explicit `null` still clears the field.

**Role System:**
- **Owner** (exactly 1): Can manage all roles (Admin/Editor/Viewer), Edit, View
- **Admin** (0+): Can manage Editor and Viewer roles, Edit, View
- **Editor** (0+): Edit, View
- **Viewer** (0+): View only

**Validation:**
- Must have exactly one owner in `roles` dict
- Validated via Pydantic model validator

**Key Operations:**
- Market creation/update via `api/markets.py`
- Role management via `api/markets.py` (add/remove/update roles)
- Assignment generation via `assignment/assignment.py:assign_market()`
- Source data upload/retrieval via `api/source_data.py`
- Permission resolution via `api/permissions.py`

**Theming:**
- If `organization_id` is set → uses `Organization.theme`
- Else → uses `Market.theme` (default theme)

---

## Market Configuration Objects

### SetupObject
**Location:** `back-end/datatypes.py:78-88`

Contains all configuration data needed to set up and run a market assignment.

**Fields:**
- `col_names: List[str]` - Column names from the uploaded CSV source data. Defaults to `[]`.
- `col_values: List[List[str]]` - Unique values for each column (used for filtering/prioritization). Defaults to `[]`.
- `col_include: List[bool]` - Flags indicating which columns to include in assignment logic. Defaults to `[]`.
- `enum_priority_order: List[List[str]]` - Priority ordering for enum-type columns. Defaults to `[]`.
- `priority: List[PriorityObject]` - List of priority rules for vendor assignment
- `market_dates: List[MarketDateObject]` - List of market dates and their associated columns
- `tiers: List[TierObject]` - List of tier levels (e.g., premium, standard)
- `locations: List[LocationObject]` - List of physical locations
- `sections: List[SectionObject]` - List of sections within locations
- `assignment_options: AssignmentOptionObject` - Configuration options for assignment algorithm
- `floorplans: Optional[List[FloorplanObject]]` - Saved floorplans for the market (optional)

**CSV-Derived Fields Are Optional:**

The four `col_*` fields above describe an uploaded CSV, so an application-based market has nothing to put in them.
They default to empty lists rather than being required, and the same applies to `PriorityObject.col_name_idx` and `MarketDateObject.col_name_idx` (both `Optional[int]`, default `None`).

Because the models no longer enforce them, the assignment algorithm validates them instead.
`_validate_assignment_column_mappings()` (`back-end/assignment/assignment.py`) rejects a setup object that reaches the solver with an empty `col_names`, an unset or out-of-range index on `assignment_options` (email / table choice / table share; max days is optional), a `market_dates` entry with neither `col_name` nor a valid `col_name_idx`, or a `priority` entry whose `col_name_idx` is unset or out of range for `enum_priority_order`.

**Relationships:**
- **One-to-One with Market**: Each market has one SetupObject
- **One-to-Many with PriorityObject**: Contains multiple priority rules
- **One-to-Many with MarketDateObject**: Contains multiple market dates
- **One-to-Many with TierObject**: Contains multiple tiers
- **One-to-Many with LocationObject**: Contains multiple locations
- **One-to-Many with SectionObject**: Contains multiple sections
- **One-to-One with AssignmentOptionObject**: Contains assignment configuration options

---

### PriorityObject
**Location:** `back-end/datatypes.py:42-46`

Defines a priority rule for vendor assignment based on column values.

**Fields:**
- `id: int` - Unique identifier for this priority rule
- `col_name_idx: Optional[int]` - Index into `SetupObject.col_names` indicating which column to prioritize. `None` on application-based markets; required (and validated against `enum_priority_order`) before assignment runs.
- `data_type: DataType` - Type of data in the column (affects how prioritization works)
- `sorting_order: str` - Sort order (e.g., "ascending", "descending")

**Relationships:**
- **Many-to-One with SetupObject**: Multiple PriorityObjects belong to one SetupObject
- **Uses DataType**: References the DataType enum

---

### MarketDateObject
**Location:** `back-end/datatypes.py:49-52`

Represents a market date and its associated data column.

**Fields:**
- `date: str` - ISO format date string
- `col_name_idx: Optional[int]` - Index into `SetupObject.col_names` indicating which column contains date availability data. `None` on application-based markets.
- `col_name: Optional[str]` - Cached column name (populated during assignment processing)

**Relationships:**
- **Many-to-One with SetupObject**: Multiple MarketDateObjects belong to one SetupObject
- **Used by Assignment**: Each MarketDateObject creates a DateAssignment during assignment processing

**Note:** `col_name` and `col_name_idx` are still read at runtime by `record_attendance()` (`back-end/api/attendance.py`, which builds date aliases from `col_name`) and by `_calculate_date_flexibility()` (`back-end/assignment/assignment.py`). They are kept for CSV-backed markets and are removed only once the solver adapter and attendance redesign land.

---

### TierObject
**Location:** `back-end/datatypes.py:55-57`

Represents a tier level (e.g., premium, standard, basic).

**Fields:**
- `id: int` - Unique identifier
- `name: str` - Tier name

**Relationships:**
- **Many-to-One with SetupObject**: Multiple TierObjects belong to one SetupObject
- **Many-to-One with SectionObject**: Sections can have an associated tier
- **Used in Assignment**: Tiers affect vendor assignment priority and statistics

---

### LocationObject
**Location:** `back-end/datatypes.py:60-61`

Represents a physical location where the market takes place.

**Fields:**
- `name: str` - Location name

**Relationships:**
- **Many-to-One with SetupObject**: Multiple LocationObjects belong to one SetupObject
- **Many-to-One with SectionObject**: Sections belong to locations
- **Used in Assignment**: Locations organize sections and affect assignment logic

---

### SectionObject
**Location:** `back-end/datatypes.py:64-68`

Represents a section within a location, containing a specific number of tables.

**Fields:**
- `name: str` - Section name
- `location: Optional[LocationObject]` - Parent location (can be null)
- `tier: Optional[TierObject]` - Associated tier level (can be null)
- `count: int` - Number of tables in this section

**Relationships:**
- **Many-to-One with SetupObject**: Multiple SectionObjects belong to one SetupObject
- **Many-to-One with LocationObject**: Sections can belong to a location (optional)
- **Many-to-One with TierObject**: Sections can have an associated tier (optional)
- **Used in Assignment**: Sections define table capacity and are assigned to vendors

---

### AssignmentOptionObject
**Location:** `back-end/datatypes.py:71-75`

Configuration options that control the assignment algorithm behavior.

**Fields:**
- `max_assignments_per_vendor: Optional[int]` - Maximum number of table assignments per vendor (None = unlimited)
- `max_half_table_proportion_per_section: Optional[int]` - Maximum proportion of half tables per section (None = unlimited)
- `email_col_name_idx: Optional[int]` - Index of the vendor email column. Required before assignment runs.
- `table_choice_col_name_idx: Optional[int]` - Index of the table choice column. Required before assignment runs.
- `table_share_email_col_name_idx: Optional[int]` - Index of the table-share partner email column. Required before assignment runs.
- `max_days_col_name_idx: Optional[int]` - Index of the per-vendor max-days column. Genuinely optional (None = no per-vendor cap from CSV, only global caps).

**Relationships:**
- **One-to-One with SetupObject**: Each SetupObject has one AssignmentOptionObject
- **Used by Assignment Algorithm**: Controls assignment constraints

**Note:** All four column indices are `Optional` on the model but validated by `_validate_assignment_column_mappings()` when assignment runs. There are no legacy default column names to fall back on.

**Note:** Commented fields suggest future features:
- `use_totally_random_assignment: bool`
- `use_maximum_capacity_assignment: bool`

---

### ModificationObject
**Location:** `back-end/datatypes.py:91-92`

Placeholder for future modification tracking functionality.

**Fields:**
- Currently empty (pass)

**Relationships:**
- **Many-to-One with Market**: Markets contain a list of ModificationObjects (currently unused)

---

## Assignment Objects

### AssignmentObject
**Location:** `back-end/datatypes.py:110-113`

Contains the results of a market assignment operation.

**Fields:**
- `vendor_assignments: List[VendorAssignmentResult]` - List of all vendor-to-table assignments
- `assignment_date: str` - ISO format timestamp when assignment was performed
- `assignment_statistics: Optional[AssignmentStatistics]` - Statistical summary of the assignment

**Relationships:**
- **One-to-One with Market**: Each market has one AssignmentObject
- **One-to-Many with VendorAssignmentResult**: Contains multiple vendor assignments
- **One-to-One with AssignmentStatistics**: Contains assignment statistics (optional)

**Lifecycle:**
- Created empty when market is created
- Populated by `assignment/assignment.py:assign_market()` function
- Updated when assignment is regenerated

---

### VendorAssignmentResult
**Location:** `back-end/datatypes.py:33-40`

Represents a single vendor-to-table assignment.

**Fields:**
- `email: str` - Vendor email (from source data)
- `date: str` - Market date for this assignment
- `table_code: str` - Unique table identifier
- `table_choice: str` - Type of table assignment: "Full table", "Half table - Left", or "Half table - Right"
- `section: str` - Section name where table is located
- `tier: str` - Tier name of the assigned section
- `location: str` - Location name of the assigned section

**Relationships:**
- **Many-to-One with AssignmentObject**: Multiple VendorAssignmentResults belong to one AssignmentObject
- **References MarketDateObject**: Uses date from market dates
- **References SectionObject**: Uses section, tier, and location information

---

### AssignmentStatistics
**Location:** `back-end/datatypes.py:95-107`

Statistical summary of an assignment operation.

**Fields:**
- `total_vendors: int` - Total number of vendors in source data
- `total_tables: int` - Total number of available tables
- `total_assignments: int` - Total number of assignments made
- `total_assigned_vendors: int` - Number of vendors who received at least one assignment
- `total_assigned_tables: int` - Number of tables that were assigned
- `unassigned_vendors: List[str]` - List of vendor emails that received no assignments
- `unassigned_tables: Dict[str, List[str]]` - Dictionary mapping dates to lists of unassigned table codes
- `assignments_per_date: Dict[str, int]` - Count of assignments per market date
- `assignments_per_tier: Dict[str, int]` - Count of assignments per tier
- `assignments_per_section: Dict[str, int]` - Count of assignments per section
- `assignments_per_table_choice: Optional[Dict[str, int]]` - Count of assignments per table choice type
- `satisfaction_score: float` - Calculated satisfaction score (0.0 to 1.0)

**Relationships:**
- **One-to-One with AssignmentObject**: Each AssignmentObject can have one AssignmentStatistics
- **Aggregates VendorAssignmentResult**: Statistics are calculated from vendor assignments

---

## Application Objects

These models back the application-based market flow (vendors apply through a form instead of being imported from a CSV).

**Status:** `ApplicationForm` is fully live: organizers build it in the market-setup Application Form tab and it is read and written through the endpoints below.
`Application` is a model with its own collection: `applications` exists (indexed on `market_id` and a unique compound index on `(market_id, applicant_email, application_type)`) and the market write path counts it to enforce the D9 form lock. The atomic upsert `find_or_create_application` in `api/applications.py` can write an application document, and the unique index is what makes it safe under concurrency. The applicant-facing submit endpoint lands in a later phase.

### ApplicationForm
**Location:** `back-end/datatypes.py`

The application form definition for a market.

**Fields:**
- `fields: List[FormField]` - Ordered list of form fields. Must contain at least one field.
- `published_at: Optional[str]` - ISO timestamp for when the form is published. Server-owned: a save always carries over the value on the stored form and discards any value in the payload, so a client cannot forge this lock-bearing state. No write path sets it yet, so it is `None` in practice; publishing lands with the applicant flow.

**Endpoints:**
- `GET /markets/<market_id>/application-form` - Requires `VIEWER`. Returns `{ application_form, editable, lock_reason }`, where `application_form` is camelCase (or `null` when no form has been saved) and `editable` / `lock_reason` describe the lock so the builder can render read-only before an organizer invests work in a form they cannot save.
- `PUT /markets/<market_id>/application-form` - Requires `EDITOR`. The only writer of `Market.application_form` on an existing market. Takes the form (camelCase) as the body and returns `{ message, application_form }` with the form exactly as persisted. `404` unknown market, `403` insufficient permission, `400` validation failure, `409` locked.

**Editability (the D9 lock):**

`application_form_lock_reason()` (`back-end/api/markets.py`) is the single source of truth for whether a market's form may be edited, and every write path consults it. A form is locked when either:
- the market is not in `draft` phase, or
- at least one `Application` exists for the market (counted by `market_id` via `back-end/api/applications.py`).

The second rule is permanent: once an applicant has submitted, the form can never be modified again, so no applicant can have answered a question that later moved.

**Validation and Normalization:**

Every writer (`POST /markets` with a form on the body, and the `PUT` above) runs the form through one validator, which returns it exactly as it will be persisted, so a stored form can never differ from the form that was checked. It rejects a form with no fields, and per field enforces the [FormField](#formfield) rules below. It also renormalizes `order` to the field's array position, so the builder and the applicant's form can never disagree about display order.

**Relationships:**
- **One-to-One with Market**: Embedded in `Market.application_form` (optional; None for CSV-based markets)
- **One-to-Many with FormField**: Contains multiple form fields

---

### FormField
**Location:** `back-end/datatypes.py`

A single field in an application form.

**Fields:**
- `key: str` - Machine name (e.g., `business_name`); the key used in `Application.form_data`
- `label: str` - Human-readable label (e.g., "Business Name")
- `type: str` - Field type. The model types this as a free `str`, but the API accepts only `text`, `number`, `select`, `multi_select`, `checkbox`, `date`, or `email` (`VALID_FORM_FIELD_TYPES` in `back-end/api/markets.py`). A `file` type is named in the model comment but is not yet accepted by any write path.
- `required: bool` - Whether the field must be filled. Default **false**.
- `options: List[str]` - Choices for `select` / `multi_select` fields. Default `[]`.
- `help_text: Optional[str]` - Optional helper text shown under the field
- `order: int` - Display order. Default **0**. Server-owned: renormalized on every write to the field's position in `ApplicationForm.fields`.

**Validation (enforced on every write of `Market.application_form`):**
- `key` must be non-blank, unique within the form, and match `^[a-z0-9_]+$`. Field keys become document keys inside `Application.form_data`, where a dot or a leading `$` cannot be addressed by Mongo update operators, so the charset is held to the slug form the builder auto-generates from the label.
- `label` must be non-blank.
- `type` must be one of the accepted types above.
- `select` / `multi_select` fields must have at least one option, and options are trimmed and must be non-blank and unique - they are the persisted answer values in `Application.form_data`, so a duplicate would be an ambiguous answer. Options are cleared to `[]` on every other field type.

The front-end mirrors these rules in `front-end/src/utils/applicationForm.ts` (`applicationFormError()`), so the builder blocks Save before the request is sent; the back-end remains the authority.

**Relationships:**
- **Many-to-One with ApplicationForm**: Multiple FormFields belong to one ApplicationForm
- **Referenced by Application**: `Application.form_data` is keyed by `FormField.key`

---

### Application
**Location:** `back-end/datatypes.py`

A vendor's submitted application to a market.

**Fields:**
- `id: str` - UUID, immutable primary key
- `market_id: str` - References `Market.id`
- `applicant_email: str` - The applicant's email (also the login key for the applicant portal)
- `form_data: Dict[str, Any]` - Submitted answers, keyed by `FormField.key`
- `status: ApplicationStatus` - Current state in the application state machine
- `application_type: ApplicationType` - `MAIN` or `WAITLIST`. Default **`MAIN`**.
- `main_application_id: Optional[str]` - References the main `Application.id` a waitlist entry was prefilled from
- `submitted_at: Optional[str]` - ISO timestamp of submission
- `updated_at: str` - ISO timestamp of the last update. Defaults to now.
- `assigned_reviewer_id: Optional[str]` - References the `User.id` of the assigned reviewer

**Relationships:**
- **Many-to-One with Market**: Multiple Applications belong to one Market (via `market_id`)
- **Many-to-One with Application**: A waitlist Application can reference a main Application (via `main_application_id`)
- **Uses ApplicationStatus / ApplicationType**: References both enums

---

## Supporting Types

### DataType (Enum)
**Location:** `back-end/datatypes.py:6-12`

Enumeration of data types used for column classification and priority rules.

**Values:**
- `DEFAULT = "Select a datatype"` - Default/unselected state
- `STRING = "String"` - Text data
- `NUMBER = "Number"` - Numeric data
- `ENUM = "Enum"` - Enumerated/categorical data
- `CONTAINS = "Contains"` - Filter type: contains substring
- `NOT_CONTAINS = "Does not contain"` - Filter type: does not contain substring

**Relationships:**
- **Used by PriorityObject**: Defines how priority rules interpret column data

---

### MarketRole (Enum)
**Location:** `back-end/datatypes.py:15-19`

Enumeration of roles users can have in a market.

**Values:**
- `OWNER = "owner"` - Market owner (exactly 1 per market)
- `ADMIN = "admin"` - Market administrator (0+)
- `EDITOR = "editor"` - Market editor (0+)
- `VIEWER = "viewer"` - Market viewer (0+)

**Permission Hierarchy:**
```
Owner (4) > Admin (3) > Editor (2) > Viewer (1)
```

**Relationships:**
- **Used by Market**: Stored in `Market.roles` dictionary
- **Used by Permission System**: Determines user access levels

---

### MarketPhase (Enum)
**Location:** `back-end/datatypes.py`

The market lifecycle. A market moves forward through these phases; the phase drives which operations are available.

**Values:**
- `DRAFT = "draft"` - Being configured; not yet accepting applications. Default for new markets.
- `APPLICATIONS_OPEN = "applications_open"` - Vendors can submit applications
- `APPLICATIONS_CLOSED = "applications_closed"` - Submission window has closed
- `REVIEW = "review"` - Reviewers are triaging applications
- `ASSIGNMENT = "assignment"` - Tables are being assigned
- `OFFERS = "offers"` - Assignments have been sent; vendors accept or refuse
- `MARKET_DAYS = "market_days"` - The market is running (check-in is live)
- `ARCHIVED = "archived"` - Read-only

**Transitions:**

Only these edges exist today (`VALID_TRANSITIONS` in `back-end/guards.py`); every other pair is rejected, and each missing edge lands with the feature that needs it.
`review`, `assignment`, `offers`, and `market_days` are declared on the enum but no transition enters them yet.

- `draft` → `applications_open`
- `draft` → `archived` (**publishing a CSV-based market**: the Done button at the end of the Generated Assignment flow. A CSV market never opens applications - its vendors arrive in the upload - so the one thing publishing has to do is move it out of `draft`, which is what puts it on its public check-in URL. `archived` is where that lands: it is the phase a published pre-`phase` market already reads back as, so the CSV flow and the legacy documents agree. No guards - a CSV market that has an assignment has nothing left to satisfy.)
- `applications_open` → `applications_closed`
- `applications_closed` → `applications_open` (reopening the submission window)

**Endpoint:**
- `POST /markets/<market_id>/transition` - Requires `ADMIN`. Body: `{ "toPhase": "applications_open" }`. Returns `200` with `{ "phase": "<new_phase>" }`. `400` on an unknown phase or an edge that is not valid from the market's current phase, `403` on insufficient permission, `404` on an unknown market, `409` when a guard blocks the transition or when the market's phase changed while the request was in flight (the write is a compare-and-set against the phase the request read, so two organizers racing cannot both win). This is the only writer of `Market.phase` on an existing market, and it writes the derived `isDraft` in the same atomic update so the two can never drift apart.
- **Callers**: `GenerateAssignmentView.vue`'s Done button posts `{ "toPhase": "archived" }` to publish a CSV-based market, surfacing a `409`'s blocker messages in the Done error rather than a generic "failed to save". Publishing used to be a `PUT` of `isDraft: false`; that route is gone, and this transition is now the only way a CSV market leaves `draft`.

**Guards (the D16 registry):**

Every precondition for every transition lives in `back-end/guards.py` and nowhere else - the endpoint and the front-end contain no guard-specific logic, so adding or removing a precondition is a one-file edit. Three hand-maintained tables drive it, and `_validate_registry()` runs at import and refuses to load a file whose tables disagree (a guard on an edge that does not exist, a phase no transition enters, an edge that fails to carry its target phase's entry invariants):

- `VALID_TRANSITIONS` - the edges above. Anything else is a `400`.
- `PHASE_ENTRY_INVARIANTS` - what must hold of a market *sitting in* a phase, whatever route it took. Every inbound edge to the phase must enforce these.
- `TRANSITION_GUARDS` - `(from_phase, to_phase)` → the guards that edge evaluates. Keyed by edge rather than by target phase, because a precondition can belong to a route rather than to a phase.

The only guard today is `FormHasFieldsGuard` (`form_has_fields`): the application form must have at least one field, enforced on both edges into `applications_open`.

**Blocker wire shape:**

A failed guard becomes a `PreconditionResult` (`id`, `passed`, `message`, optional `resolution_link`), and the `409` body is `{ error, currentPhase, targetPhase, blockers: PreconditionResult[] }`, camelCased on the wire. The front-end mirrors these as `PreconditionResult` / `TransitionRequest` / `TransitionResponse` / `TransitionBlockedResponse` in `front-end/src/assets/types/datatypes.ts`, and `BlockerPanel.vue` renders the blocker list generically - message plus a "Fix this" link when the guard supplied a `resolutionLink`.

`BlockerPanel` itself still ships ahead of the view that mounts it: the only caller of the transition today is the CSV publish (`draft` → `archived`), which carries no guards and so can never be blocked. `FormHasFieldsGuard`'s `resolution_link` (`/markets/<market_id>/form-builder`) has no matching route in `front-end/src/router/index.ts` yet either - the form builder is today a tab inside `/market-setup`. Both land with the view that wires up an application-based market's transition into `applications_open`.

**Relationships:**
- **Used by Market**: Stored in `Market.phase`, server-owned (see [Market](#market))
- **`is_draft` is derived from it**: `Market.is_draft` is a computed field, true exactly when `phase == draft`. Phase is the single source of truth; `is_draft` is a persisted view of it kept in agreement by every writer, and is only ever *read* as the fallback for a document that has no usable `phase`.
- **Derived on read**: `phase_from_market_document()` (`back-end/datatypes.py`) is the single source of truth for the phase of a stored document - it falls back to the `isDraft` mapping when the field is absent, and logs and falls back rather than raising when the stored value is one this build does not recognize.
- **Not decidable in Mongo**: because that fallback exists, no query condition can answer "is this market published?" - `{"phase": {"$ne": "draft"}}` also matches a phase-less document, which is what a legacy *draft* looks like. The public slug lookup (`published_market_by_slug` in `back-end/market_documents.py`) therefore prunes with `non_draft_market_prefilter()` and makes the actual draft decision in Python through `phase_from_market_document()`. The prefilter excludes only the unambiguous drafts: it prunes, it does not judge.

---

### ApplicationStatus (Enum)
**Location:** `back-end/datatypes.py`

The application state machine. An application occupies exactly one of these states.

**Values:**
- `OPEN = "open"` - Submitted, not yet picked up
- `UNDER_REVIEW = "under_review"` - A reviewer is working on it
- `REVIEWER_APPROVED = "reviewer_approved"` - Approved by a reviewer
- `REVIEWER_REJECTED = "reviewer_rejected"` - Rejected by a reviewer
- `UNASSIGNED = "unassigned"` - Approved but no table assigned
- `ASSIGNED = "assigned"` - A table has been assigned
- `ASSIGNMENT_SENT = "assignment_sent"` - The offer has been sent to the vendor
- `VENDOR_ACCEPTED = "vendor_accepted"` - The vendor accepted the offer
- `VENDOR_REFUSED = "vendor_refused"` - The vendor declined the offer
- `CANCELLED = "cancelled"` - Withdrawn or cancelled

**Relationships:**
- **Used by Application**: Stored in `Application.status`

---

### ApplicationType (Enum)
**Location:** `back-end/datatypes.py`

**Values:**
- `MAIN = "main"` - A normal application
- `WAITLIST = "waitlist"` - A waitlist entry, optionally prefilled from a main application via `Application.main_application_id`

**Relationships:**
- **Used by Application**: Stored in `Application.application_type`

---

### OrganizationRole (Enum)
**Location:** `back-end/datatypes.py:22-25`

Enumeration of roles users can have in an organization.

**Values:**
- `OWNER = "owner"` - Organization owner (exactly 1 per organization)
- `ADMIN = "admin"` - Organization administrator (0+)
- `MEMBER = "member"` - Organization member (0+)

**Relationships:**
- **Used by Organization**: Stored in `Organization.owner`, `admins`, and `members` fields

---

### ThemeObject
**Location:** `back-end/datatypes.py:28-31`

Represents theming configuration for markets and organizations.

**Fields:**
- `primary_color: str` - Primary theme color
- `secondary_color: str` - Secondary theme color
- `logo_url: Optional[str]` - URL to organization/market logo

**Relationships:**
- **One-to-One with Market**: Markets can have a theme (optional)
- **One-to-One with Organization**: Organizations can have a theme (optional)
- **Theming Resolution**: Organization theme takes precedence over market theme

---

## Database Collections

### MongoDB Collections

The system uses MongoDB with the following collections:

#### `users` Collection
- **Document Structure**: Matches `User` datatype
- **Primary Key**: `id` field (UUID)
- **Unique Index**: `email` for login/auth
- **Operations**: Create, read, update via `api/users.py`
- **Authentication**: Used by Flask-Login for session management (lookup by email)

#### `markets` Collection
- **Document Structure**: Matches `Market` datatype (with camelCase keys in database), including `phase` for the market lifecycle and the `isDraft` flag derived from it
- **Primary Key**: `id` field (UUID)
- **Operations**: Create, read, update, delete via `api/markets.py`
- **Key Conversion**: Uses snake_case ↔ camelCase conversion utilities
- **Canonical keys are camelCase**: every write camel-cases the whole document, so `organization_id` is persisted as `organizationId`, and reads name that one spelling. Code that touches a raw document or writes a Mongo filter goes through the helpers in `back-end/market_documents.py` (`market_doc_field()`, `market_doc_filter()`, `market_doc_set()`, `market_from_document()`) rather than a string literal, so the spelling is decided in one place. Tolerating both spellings at read time would not converge - a write only ever refreshes the camelCase key, so a legacy `organization_id` holds a value that is stale forever and any filter still matching it acts on data no write has touched since (an organization a market was moved away from would go on seeing it).
- **Normalizing legacy keys + backfilling slug**: documents written before that convention carry snake_case keys. `back-end/migrations/migrate_market_keys.py` rewrites them under the canonical keys, dropping the legacy spelling (where a document carries both, the camelCase value wins - it is the one the last write set). In the same pass it stamps the stored slug (derived from the name via `market_name_slug()`) on every document and builds the `market_slug` index, so the public lookup (`published_market_by_slug` in `market_documents.py`) is one indexed query. It is idempotent and supports `--dry-run`. Nothing runs it for you, and the back end **refuses to boot** until it records both of its markers (`market_document_keys` and `market_slugs`) in `schema_migrations`: an unmigrated market is invisible to the canonical-key reads rather than broken, so it would be hidden from the public check-in lookup, from applicant URLs, and from organization-scoped market lists with nothing logged anywhere.
- **Indexing**: Markets are queried by id; roles dict keys are user ids
- **Backfilling `phase`**: Market documents written before `phase` existed have no such field. `back-end/migrations/migrate_phase.py` backfills them (`isDraft: true` → `draft`, `isDraft: false` → `archived`, the safe default given archives are read-only). It is idempotent and supports `--dry-run`. Documents without `phase` still load: `phase_from_market_document()` applies the same mapping on read, so a market behaves identically before and after the migration runs.
- **Reconciling `isDraft` with `phase`**: `back-end/migrations/migrate_is_draft_consistency.py` brings the two fields into agreement on every document that stores a `phase`. Two shapes disagree, and they are repaired in *opposite* directions, because which field carried the truth depends on which build wrote the document:
  - `phase: "draft"` + `isDraft: false` - a market **published by the old build**, when publishing was a `PUT` of `isDraft: false` and nothing advanced the phase. `isDraft` was the only publish signal that existed, so it wins: the *phase* is advanced to `archived` (where the CSV publish now lands). Confirming these as drafts instead would take a live market's public check-in URL off the air, because the slug lookup now decides on phase.
  - `phase != "draft"` + `isDraft: true` - a market the transition endpoint advanced before `isDraft` joined its atomic update. The phase is what moved, so `isDraft` is the stale field and is recomputed from it.

  Documents with **no** `phase` at all are deliberately untouched: `phase_from_market_document()` derives their phase *from* `isDraft`, so they are already self-consistent, and `migrate_phase.py` is what backfills them. Every repair is a targeted, condition-checked `$set` (never a scan-then-replace) whose filter Mongo re-checks per document as it writes, so a market the live app transitions mid-run drops out of the repair instead of having a stale value written over its new phase. It is idempotent and supports `--dry-run`.

#### `schema_migrations` Collection
- **Document Structure**: one marker document per applied migration - `_id` is the migration name (today `market_document_keys` and `market_slugs`), with an `appliedAt` ISO timestamp
- **Owner module**: `back-end/market_documents.py` (`read_market_key_migration_marker()`, `record_market_key_migration()`, `assert_market_key_migration_recorded()`)
- **Operations**: `app.py` asserts every marker in `MARKET_MIGRATION_IDS` at import, before the app can serve anything, and refuses to boot if any is missing. The check is a few `_id` lookups bounded by a short server-selection timeout (`MIGRATION_PROBE_TIMEOUT_MS` in `back-end/db_config.py`) so a database blip cannot hang boot, and it fails closed on every outcome that is not a confirmed marker - an unknown migration state is not a migrated one.
- **Creation**: `mongo-init.js` creates the collection on a fresh Mongo volume and records both markers vacuously (a brand new database holds no market documents, so nothing is under the legacy keys and nothing is missing a slug). `back-end/init_database.py` does the same for a database it initializes, and refuses to record the markers if it finds markets that still need rewriting. `migrations/migrate_market_keys.py` records both markers after a real rewrite.

#### `organizations` Collection
- **Document Structure**: Matches `Organization` datatype (with camelCase keys in database)
- **Primary Key**: `id` field (UUID)
- **Operations**: Create, read, update, delete via `api/organizations.py`
- **Key Conversion**: Uses snake_case ↔ camelCase conversion utilities

#### `source_data` Collection
- **Document Structure**: 
  - `market_id: str` - References Market.id (UUID)
  - `csv_content: str` - Raw CSV file content
  - `headers: List[str]` - Column headers
  - `row_count: int` - Number of data rows
  - `upload_date: datetime` - Upload timestamp
  - `filename: str` - Original filename
- **Primary Key**: `market_id`
- **Operations**: Upload, read, delete via `api/source_data.py`
- **Relationship**: One-to-One with Market (via `market_id`)

#### `applications` Collection
- **Document Structure**: Matches the `Application` datatype, stored **snake_case** - unlike `markets` and `organizations`, application documents are *not* camelCased on write. The market foreign key is `market_id`, not `marketId`.
- **Primary Key**: `id` field (UUID)
- **Indexes**: `market_id` (the D9 form lock counts on every market write) and a unique compound index `market_applicant_type_unique` on `(market_id, applicant_email, application_type)` that enforces one applicant per market.
- **Owner module**: `back-end/api/applications.py` is the single owner of this collection; every reader and writer goes through it so the storage contract lives in one place. A writer that stored the market reference under any other key would silently disable the form lock.
- **Operations**: `count_applications_for_market()` (drives the D9 lock) and `find_or_create_application()` (atomic upsert guarded by the unique index, safe under concurrency). The applicant-facing submit endpoint lands in a later phase.
- **Creation**: `mongo-init.js` creates it and its indexes on a fresh Mongo volume; `back-end/migrations/create_applications_collection.py` does the same for an already-deployed database (idempotent, supports `--dry-run`).
- **Relationship**: Many-to-One with Market (via `market_id`)

---

## Permission System

### Permission Resolution
**Location:** `back-end/api/permissions.py`

The permission system determines user access to markets through a two-tier resolution process:

1. **Explicit Market Role**: Check `Market.roles[user_id]` (roles keys are user ids)
   - If user has explicit role → return that role
   - Roles: Owner, Admin, Editor, Viewer

2. **Organization Membership**: If no explicit role, check organization membership
   - If market belongs to organization (via `organization_id`) AND user is in organization (owner/admin/member) → return Viewer
   - Organization members get View permission on all organization markets

3. **No Access**: If neither condition met → return None (no access)

**Key Functions:**
- `get_user_market_role(user_email, market, organization)` - Get user's effective role
- `user_has_permission(user_email, market, required_role, organization)` - Check if user has required permission level
- `can_manage_roles(user_email, market, target_role, organization)` - Check if user can manage specific role
- `get_user_organizations(user_email)` - Get all organizations user belongs to

**Permission Hierarchy:**
- Owner (4) > Admin (3) > Editor (2) > Viewer (1)
- User's role must have hierarchy value >= required role

**Role Management Permissions:**
- **Owner**: Can manage all roles (Owner, Admin, Editor, Viewer)
- **Admin**: Can manage Editor and Viewer roles only
- **Editor/Viewer**: Cannot manage any roles

---

## Relationship Diagrams

### High-Level Entity Relationships

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│    User     │◄───────►│ Organization │◄───────►│   Market    │
└─────────────┘         └──────────────┘         └─────────────┘
     │                        │                        │
     │                        │                        │
     │                        │                        │
     │                        │                        │
     │                        │                        │
     └────────────────────────┴────────────────────────┘
                              │
                              │ (role-based access)
                              │
```

**Relationship Details:**
- **User ↔ Organization**: Many-to-many via `User.organizations` (org ids) and `Organization.owner/admins/members` (user ids)
- **User ↔ Market**: Many-to-many via `Market.roles` dict (user id keys) or organization membership (implicit Viewer)
- **Organization ↔ Market**: One-to-many via `Organization.markets` (market ids) and `Market.organization_id`

### Market Composition Hierarchy

```
Market
├── roles: Dict[str, MarketRole] (many-to-many with User, keys are user ids)
├── organization_id: Optional[str] (many-to-one with Organization)
├── phase: MarketPhase (lifecycle, server-owned, default DRAFT - single source of truth)
├── is_draft: bool (computed from phase: true iff phase == draft)
├── theme: Optional[ThemeObject]
├── SetupObject (1:1, optional)
│   ├── PriorityObject[] (1:many)
│   ├── MarketDateObject[] (1:many)
│   ├── TierObject[] (1:many)
│   ├── LocationObject[] (1:many)
│   ├── SectionObject[] (1:many)
│   │   ├── LocationObject (many:1, optional)
│   │   └── TierObject (many:1, optional)
│   └── AssignmentOptionObject (1:1)
├── ApplicationForm (1:1, optional, server-owned: written only via PUT /markets/<id>/application-form)
│   └── FormField[] (1:many)
├── ModificationObject[] (1:many, currently unused)
└── AssignmentObject (1:1)
    ├── VendorAssignmentResult[] (1:many)
    └── AssignmentStatistics (1:1, optional)

Application (many:1 with Market, via market_id; atomic upsert find_or_create_application writes it)
├── status: ApplicationStatus
├── application_type: ApplicationType
└── main_application_id: Optional[str] (many:1 with Application, waitlist prefill)
```

### User-Market Access Control

```
User
    │
    ├─→ Explicit Role (Market.roles[user_id])
    │   │
    │   ├─→ Owner: Full control, manage all roles
    │   ├─→ Admin: Edit, manage Editor/Viewer roles
    │   ├─→ Editor: Edit and View
    │   └─→ Viewer: View only
    │
    └─→ Organization Membership (if no explicit role)
        │
        └─→ If market.organization matches user's org
            └─→ Viewer permission (implicit)
```

### Organization Structure

```
Organization
├── id: str (UUID, primary key)
├── owner: str (user id, exactly 1)
├── admins: List[str] (user ids, 0+)
├── members: List[str] (user ids, 0+)
├── markets: List[str] (market ids, owned by org)
└── theme: Optional[ThemeObject]
```

### Data Flow for Assignment

```
SourceData (CSV)
    │
    ├── Upload → MongoDB source_data collection
    │
    └── Used by → MarketAssignment class
                      │
                      ├── SetupObject (configuration)
                      │
                      └── Generates → AssignmentObject
                                         │
                                         ├── VendorAssignmentResult[]
                                         └── AssignmentStatistics
```

---

## Data Flow

### Market Creation Flow

1. **User** creates a new **Market** via API
2. **Market** must have `roles` dict with exactly one OWNER role
3. **Market** must carry an `organizationId`; the API rejects a missing organization id, an organization that does not exist, or an organization the requesting user is not a member of (400). The front-end enforces the same rule up front: the new-market overlay requires an organization to be picked from a dropdown before submission is enabled, and users with no organizations are linked to `/organizations` to create one.
4. **Market** is stored in MongoDB `markets` collection (identified by `id` UUID)
5. Market is added to its `Organization.markets` list
6. **SourceData** CSV is uploaded separately and stored in `source_data` collection (via `market_id`)
7. **SetupObject** is configured within the Market
8. **AssignmentObject** is initialized empty

### Assignment Generation Flow

1. **Market** is retrieved from database by id
2. **SourceData** is retrieved from `source_data` collection using `market_id`
3. **MarketAssignment** class is instantiated with `Market.setup_object` and `source_data`
4. Assignment algorithm processes vendors and generates assignments
5. **AssignmentObject** is populated with:
   - `VendorAssignmentResult[]` - Individual assignments
   - `AssignmentStatistics` - Summary statistics
6. **Market** is updated with new **AssignmentObject**
7. CSV export is generated from assignment results

### User Access Flow

1. **User** logs in (authenticated via `AuthUser` wrapper)
2. User's accessible markets are determined via `get_markets_for_user()`:
   - Markets where user has explicit role in `Market.roles` dict
   - Markets belonging to user's organizations (implicit Viewer permission)
3. Permission resolution determines effective role:
   - Explicit role takes precedence over organization membership
   - Organization membership grants Viewer permission if no explicit role
4. User's effective role controls access:
   - **Owner**: Full control, can manage all roles
   - **Admin**: Edit, can manage Editor/Viewer roles
   - **Editor**: Edit and View
   - **Viewer**: View only

### Role Management Flow

1. **Owner** or **Admin** requests to add/remove/update user role
2. Permission check via `can_manage_roles()`:
   - Owner can manage all roles
   - Admin can manage Editor and Viewer only
3. Role constraints validated:
   - Market must have exactly one Owner
   - Cannot remove the only Owner
4. `Market.roles` dict is updated
5. Market document is saved to database

### Organization Management Flow

1. **Organization Owner** creates organization
2. Owner can add **Admins** (who can manage Members)
3. Owner and Admins can add **Members**
4. All organization users (Owner/Admin/Member) get View permission on organization markets
5. Markets are assigned to the organization via `Market.organization_id`, chosen when the market is created (an organization is required, so a user with no organization must create one here first)
6. Organization theme applies to all organization markets

---

## Key Design Patterns

### 1. Role-Based Access Control (RBAC)
- Markets use dictionary-based roles (`roles: Dict[str, MarketRole]`)
- Organizations use separate lists for different roles (`owner`, `admins`, `members`)
- Permission resolution combines explicit roles and organization membership
- Role hierarchy enforced: Owner > Admin > Editor > Viewer

### 2. Reference-Based Relationships (UUID Primary Keys)
- All entities use UUIDs as immutable primary keys (`id` field)
- Cross-entity references use ids: `User.organizations` (org ids), `Organization.owner/admins/members` (user ids), `Organization.markets` (market ids), `Market.organization_id`, `Market.roles` (user id keys)
- Auth continues to use email for login; backend resolves user by email and uses `user.id` for permissions
- SourceData references `market_id` instead of `market_name`

### 3. Embedded vs Referenced Documents
- **Embedded**: SetupObject, AssignmentObject, ApplicationForm, roles dict are embedded within Market documents
- **Referenced**: SourceData, Organization are stored separately and referenced by name; Application is stored in its own `applications` collection and references the market by `market_id`

### 4. Optional vs Required Fields
- `SetupObject` is optional (market can exist without configuration)
- `AssignmentStatistics` is optional (assignment may not have statistics yet)
- `SectionObject.location` and `tier` are optional (sections can exist independently)
- `Market.organization_id` is `Optional` in the model but required by `POST /markets`: new markets always belong to an organization, and the optional typing only keeps pre-existing org-less markets readable
- `Market.theme` and `Organization.theme` are optional
- `Market.application_form`, `review_config`, and `discord_guild_id` are optional (None on CSV-based markets)
- The CSV-derived fields (`SetupObject.col_names` / `col_values` / `col_include` / `enum_priority_order`, `PriorityObject.col_name_idx`, `MarketDateObject.col_name_idx`, and the `AssignmentOptionObject` column indices) are optional so application-based markets can omit them. The assignment algorithm validates them instead of the models. See [SetupObject](#setupobject).

### 5. Permission Resolution
- Two-tier resolution: explicit role first, then organization membership
- Explicit roles always take precedence over organization-based access
- Organization membership grants Viewer permission only

### 6. Theming Resolution
- Organization theme takes precedence over market theme
- If `Market.organization_id` is set → use `Organization.theme`
- Else → use `Market.theme` (or default if neither exists)

### 7. Additive Schema Evolution
- New fields are added alongside the fields they will eventually replace, never in place of them: `Market.phase` shipped next to `Market.is_draft`, and the CSV-derived fields are relaxed to optional rather than deleted.
- Old documents therefore keep loading without a migration, and code moves to the new field one call site at a time.
- Migration scripts (like `migrations/migrate_phase.py`) backfill the new field so it is queryable, but the model defaults keep documents valid even before the migration runs.
- **The takeover completes by deriving the old field, not by dropping it.** `Market.is_draft` is now a computed field over `phase` rather than independent state: the old field keeps its shape on the wire and in the database - so old documents, and any reader that still names it, keep working - while there is exactly one thing left to write. A field kept only as a fallback must never be allowed to *contradict* the field it falls back for, which is what `migrations/migrate_is_draft_consistency.py` guarantees for documents the old write path left disagreeing.
- **The exception is the key convention.** `migrations/migrate_market_keys.py` is not additive and is not optional: a market left under the legacy snake_case keys is invisible to reads that name the canonical key, so the back end refuses to boot until the migration is recorded rather than serve a database it can only half see. See the [`markets`](#markets-collection) and [`schema_migrations`](#schema_migrations-collection) collections.

---

## Notes and Future Considerations

1. **UUID Primary Keys**: All entities (User, Organization, Market) use UUIDs as immutable primary keys. Names and emails are mutable display fields. Renaming does not require cascading updates.

2. **ModificationObject**: Currently empty. Consider implementing change tracking/history for markets.

3. **SourceData Relationship**: SourceData is stored separately but has a one-to-one relationship with Market via `market_id`.

4. **Referential Integrity**: UUID-based references are used for cross-entity links. Validation is performed at API layer.

5. **AssignmentOptions**: Commented fields suggest future assignment algorithm variations.

6. **Frontend Type Alignment**: Frontend TypeScript types (`front-end/src/assets/types/datatypes.ts`) mirror backend types but use camelCase. Conversion utilities handle this.

7. **Role Management**: Consider adding audit logging for role changes and permission checks.

8. **Organization Deletion**: When organization is deleted, markets are orphaned (organization field set to None). Consider cascade options or validation.

---

## Summary

The system follows a hierarchical structure centered around the **Market** entity, which contains configuration (**SetupObject**) and results (**AssignmentObject**). **Users** control access through role-based permissions stored in `Market.roles` dictionary, with support for organization-based access. **Organizations** provide a way to group markets and users with hierarchical roles. The design emphasizes flexibility through optional fields, role-based access control, and reference-based relationships, enabling markets to exist in various states of configuration and completion while maintaining fine-grained access control.

---

## VendorAttendance

Public attendance check-in record. One document per (market_id, vendor_email, date) triple. Stored in the `attendance` MongoDB collection separately from Market documents (not embedded).

### Fields

- `market_id: str` — UUID of the Market this attendance belongs to.
- `vendor_email: str` — Normalized (lowercased, trimmed) vendor email.
- `date: str` — Market date the vendor checked in for (canonical `MarketDateObject.date`, not `col_name`).
- `checked_in_at: str` — ISO 8601 UTC timestamp of the most recent check-in.

### Relationships

- `(market_id) → Market.id` — references one Market.
- `(vendor_email, date)` is validated against `Market.assignment_object.vendor_assignments` at write time (404 if no matching assignment exists for that vendor on that date).
- Upsert key: `(market_id, vendor_email, date)` — idempotent re-check-in refreshes `checked_in_at`.

### Access

- Public read of a single vendor's own assignments + check-in status via `GET /public/markets/<slug>/vendors/<email>/assignments`.
- Public write via `POST /public/markets/<slug>/attendance/checkin`.
- Both resolve the slug through `get_published_market_by_slug()` (which delegates to `published_market_by_slug` in `market_documents.py`), which serves a market only once it is **past `draft`** - so a market reaches its public check-in URL by being transitioned, and a draft is a `404` there. The draft test is made in Python on the effective phase, not by a Mongo condition (see [MarketPhase](#marketphase-enum)).
- Owner-only listing of all attendance records for a market via `GET /markets/<market_id>/attendance` (requires `VIEWER` permission).
