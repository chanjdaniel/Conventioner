# Object Relationships Overview

This document provides a comprehensive audit of all types, objects, and their relationships within the Conventioner system.

## Table of Contents
1. [Core Domain Objects](#core-domain-objects)
2. [Market Configuration Objects](#market-configuration-objects)
3. [Assignment Objects](#assignment-objects)
4. [Supporting Types](#supporting-types)
5. [Database Collections](#database-collections)
6. [Relationship Diagrams](#relationship-diagrams)
7. [Data Flow](#data-flow)
8. [Permission System](#permission-system)

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
- **One-to-Many with Market**: Organizations can own multiple markets (via `markets` list and `Market.organization` field)
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
- `organization_id: Optional[str]` - Organization id if market belongs to an organization (None if standalone)
- `theme: Optional[ThemeObject]` - Market-specific theme (used if no organization, otherwise organization theme takes precedence)
- `setup_object: Optional[SetupObject]` - Market configuration and setup data
- `modification_list: List[ModificationObject]` - List of modifications (currently empty structure)
- `assignment_object: AssignmentObject` - Contains vendor assignment results and statistics
- `is_draft: bool` - Stored as `isDraft` in MongoDB (camelCase). Default **true**: market setup is not finished. Set to **false** when the user completes the Generated Assignment flow (Done). While `true`, opening the market from the dashboard or Markets sends the user to market setup; when `false`, the SPA routes to `/{kebab-case-slug}` derived from the market **name** (e.g. `my-summer-market`).

**Relationships:**
- **Many-to-Many with User**: Markets have multiple users with different roles (via `roles` dict, keys are user ids)
- **Many-to-One with Organization**: Markets can belong to one organization (via `organization_id` field, optional)
- **One-to-One with SetupObject**: Each market has one setup configuration (optional)
- **One-to-One with AssignmentObject**: Each market has one assignment result object
- **One-to-One with SourceData**: Each market can have one source data CSV (stored separately in MongoDB)
- **Stored in**: MongoDB `markets` collection

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
- `col_names: List[str]` - Column names from the uploaded CSV source data
- `col_values: List[List[str]]` - Unique values for each column (used for filtering/prioritization)
- `col_include: List[bool]` - Flags indicating which columns to include in assignment logic
- `enum_priority_order: List[List[str]]` - Priority ordering for enum-type columns
- `priority: List[PriorityObject]` - List of priority rules for vendor assignment
- `market_dates: List[MarketDateObject]` - List of market dates and their associated columns
- `tiers: List[TierObject]` - List of tier levels (e.g., premium, standard)
- `locations: List[LocationObject]` - List of physical locations
- `sections: List[SectionObject]` - List of sections within locations
- `assignment_options: AssignmentOptionObject` - Configuration options for assignment algorithm

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
- `col_name_idx: int` - Index into `SetupObject.col_names` indicating which column to prioritize
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
- `col_name_idx: int` - Index into `SetupObject.col_names` indicating which column contains date availability data
- `col_name: Optional[str]` - Cached column name (populated during assignment processing)

**Relationships:**
- **Many-to-One with SetupObject**: Multiple MarketDateObjects belong to one SetupObject
- **Used by Assignment**: Each MarketDateObject creates a DateAssignment during assignment processing

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

**Relationships:**
- **One-to-One with SetupObject**: Each SetupObject has one AssignmentOptionObject
- **Used by Assignment Algorithm**: Controls assignment constraints

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
- **Document Structure**: Matches `Market` datatype (with camelCase keys in database), including `isDraft` for draft vs. completed setup
- **Primary Key**: `id` field (UUID)
- **Operations**: Create, read, update, delete via `api/markets.py`
- **Key Conversion**: Uses snake_case ↔ camelCase conversion utilities
- **Indexing**: Markets are queried by id; roles dict keys are user ids

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
├── ModificationObject[] (1:many, currently unused)
└── AssignmentObject (1:1)
    ├── VendorAssignmentResult[] (1:many)
    └── AssignmentStatistics (1:1, optional)
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
3. **Market** is stored in MongoDB `markets` collection (identified by `id` UUID)
4. If market belongs to organization, it's added to `Organization.markets` list
5. **SourceData** CSV is uploaded separately and stored in `source_data` collection (via `market_id`)
6. **SetupObject** is configured within the Market
7. **AssignmentObject** is initialized empty

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
5. Markets can be assigned to organization via `Market.organization` field
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
- **Embedded**: SetupObject, AssignmentObject, roles dict are embedded within Market documents
- **Referenced**: SourceData, Organization are stored separately and referenced by name

### 4. Optional vs Required Fields
- `SetupObject` is optional (market can exist without configuration)
- `AssignmentStatistics` is optional (assignment may not have statistics yet)
- `SectionObject.location` and `tier` are optional (sections can exist independently)
- `Market.organization_id` is optional (markets can be standalone)
- `Market.theme` and `Organization.theme` are optional

### 5. Permission Resolution
- Two-tier resolution: explicit role first, then organization membership
- Explicit roles always take precedence over organization-based access
- Organization membership grants Viewer permission only

### 6. Theming Resolution
- Organization theme takes precedence over market theme
- If `Market.organization_id` is set → use `Organization.theme`
- Else → use `Market.theme` (or default if neither exists)

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
