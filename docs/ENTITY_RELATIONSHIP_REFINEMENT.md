# Entity Relationship Refinement Analysis

This document analyzes the current entity relationships and outlines the changes needed to implement the refined access control and organization structure.

## Table of Contents
1. [Current State Analysis](#current-state-analysis)
2. [Required Changes](#required-changes)
3. [Proposed New Structure](#proposed-new-structure)
4. [Permission Resolution Logic](#permission-resolution-logic)
5. [Migration Strategy](#migration-strategy)
6. [Implementation Checklist](#implementation-checklist)

---

## Current State Analysis

### Current Market Structure
```python
class Market(BaseModel):
    name: str
    owner: str                    # Single owner email
    creation_date: str
    editors: List[str]            # List of editor emails
    viewers: List[str]            # List of viewer emails
    setup_object: Optional[SetupObject]
    modification_list: List[ModificationObject]
    assignment_object: AssignmentObject
```

**Issues:**
- No `admins` role
- No organization reference
- No theming support
- Users can appear in multiple role lists (not enforced)
- No way to determine a user's single role per market

### Current Organization Structure
```python
class Organization(BaseModel):
    name: str
    users: List[str]             # Flat list, no role distinction
    markets: List[str]            # Markets owned by organization
```

**Issues:**
- No role structure (owner, admins, members)
- No theming support
- No clear ownership model

### Current User Structure
```python
class User(BaseModel):
    email: str
    password: str
    organizations: List[str]      # Organization names only
    markets: List[str]            # Market names only
```

**Issues:**
- No role tracking per organization
- No role tracking per market
- `markets` list may be redundant if we can derive from Market.roles

### Current Market Access Logic
- Markets are queried by `owner` only (`get_markets_by_owner_email`)
- No checking of `editors` or `viewers` lists
- No organization-based access checking
- No permission resolution logic

---

## Required Changes

### 1. Market Role System
**Requirement:** Each user must have exactly one role per market.

**Roles:**
- **Owner** (exactly 1): Can manage Admins/Editors/Viewers, Edit, View
- **Admin** (0+): Can manage Editors/Viewers, Edit, View
- **Editor** (0+): Edit, View
- **Viewer** (0+): View only

**Current Problem:** Separate lists (`owner`, `editors`, `viewers`) allow users to appear in multiple lists.

**Solution Options:**

#### Option A: Role Map (Recommended)
Store roles as a dictionary mapping user email to role:
```python
roles: Dict[str, str]  # {"user@email.com": "owner", "admin@email.com": "admin", ...}
```

**Pros:**
- Enforces single role per user
- Easy to query and update
- Clear role assignment

**Cons:**
- Slightly more complex queries for role-based filtering

#### Option B: Separate Lists with Validation
Keep separate lists but add validation:
```python
owner: str                    # Single email
admins: List[str]            # New field
editors: List[str]
viewers: List[str]
```

**Pros:**
- Simpler queries for specific roles
- Backward compatible structure

**Cons:**
- Requires validation to prevent duplicates
- More complex permission checking

**Recommendation:** Option A (Role Map) for cleaner design and better enforcement.

### 2. Organization Structure
**Requirement:** Organizations have hierarchical roles and theming.

**New Structure:**
```python
class Organization(BaseModel):
    name: str
    owner: str                  # Exactly 1 owner email
    admins: List[str]          # 0+ admin emails
    members: List[str]         # 0+ member emails
    markets: List[str]         # Markets owned by organization
    theme: Optional[ThemeObject]  # Organization theming
```

**Changes:**
- Replace `users: List[str]` with role-based structure
- Add `theme` field for theming

### 3. Market-Organization Relationship
**Requirement:** Market can belong to 0 or 1 organization.

> **Superseded:** markets now belong to exactly 1 organization. `POST /markets` requires an `organizationId` naming an organization the caller belongs to, and the new-market form blocks submission until one is picked. The shipped field is `organization_id` (an id, not a name), and it is still typed `Optional[str]` only so org-less markets created before this rule stay readable. See [OBJECT_RELATIONSHIPS.md](./OBJECT_RELATIONSHIPS.md) for the current model.

**New Field:**
```python
class Market(BaseModel):
    # ... existing fields ...
    organization: Optional[str]  # Organization name (None if no org)
    theme: Optional[ThemeObject]  # Market-specific theme (used if no org)
```

**Theming Logic:**
- If `market.organization` exists → use `organization.theme`
- Else → use `market.theme` (default theme)

### 4. User-Organization Relationship
**Requirement:** Users belong to organizations with roles, but roles are stored in Organization, not User.

**Current:** `User.organizations: List[str]` (just names)

**Keep:** Same structure (roles are in Organization, not User)

**Access Logic:**
- User belongs to organization if their email is in `organization.owner`, `organization.admins`, or `organization.members`
- User gets View permission on all organization markets
- Explicit market role takes precedence

### 5. Permission Resolution
**Requirement:** Determine user's effective role for a market.

**Resolution Order:**
1. Check explicit Market role (in `market.roles[user_email]`)
2. If no explicit role, check Organization membership:
   - If market belongs to organization AND user is in organization → View permission
3. If neither → No access

**Permission Hierarchy:**
```
Owner > Admin > Editor > Viewer
```

---

## Proposed New Structure

### Updated Data Types

```python
from enum import Enum
from typing import Dict, Optional, List
from pydantic import BaseModel, validator

class MarketRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"

class OrganizationRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"

class ThemeObject(BaseModel):
    primary_color: str
    secondary_color: str
    logo_url: Optional[str] = None
    # Add other theming fields as needed

class Market(BaseModel):
    name: str
    owner: str  # Email of owner (for backward compatibility, also in roles)
    creation_date: str
    roles: Dict[str, MarketRole]  # Map of user_email -> role
    organization: Optional[str] = None  # Organization name
    theme: Optional[ThemeObject] = None  # Market-specific theme
    setup_object: Optional[SetupObject] = None
    modification_list: List[ModificationObject]
    assignment_object: AssignmentObject
    
    @validator('roles')
    def validate_owner_exists(cls, v, values):
        """Ensure owner exists in roles dict and is OWNER role."""
        if 'owner' in values and values['owner'] not in v:
            raise ValueError("Owner must be in roles dict")
        if 'owner' in values and v.get(values['owner']) != MarketRole.OWNER:
            raise ValueError("Owner must have OWNER role")
        return v
    
    @validator('roles')
    def validate_single_owner(cls, v):
        """Ensure exactly one owner."""
        owner_count = sum(1 for role in v.values() if role == MarketRole.OWNER)
        if owner_count != 1:
            raise ValueError("Market must have exactly one owner")
        return v

class Organization(BaseModel):
    name: str
    owner: str  # Email of owner
    admins: List[str]  # List of admin emails
    members: List[str]  # List of member emails
    markets: List[str]  # List of market names
    theme: Optional[ThemeObject] = None
    
    @validator('owner')
    def validate_owner_not_in_other_roles(cls, v, values):
        """Ensure owner is not in admins or members."""
        if 'admins' in values and v in values.get('admins', []):
            raise ValueError("Owner cannot be in admins list")
        if 'members' in values and v in values.get('members', []):
            raise ValueError("Owner cannot be in members list")
        return v

class User(BaseModel):
    email: str
    password: str
    organizations: List[str]  # Organization names (roles stored in Organization)
    # Remove markets list - derive from roles and organizations
```

### Permission Helper Functions

```python
def get_user_market_role(user_email: str, market: Market, organization: Optional[Organization] = None) -> Optional[MarketRole]:
    """
    Get user's effective role for a market.
    Returns None if user has no access.
    """
    # 1. Check explicit market role
    if user_email in market.roles:
        return market.roles[user_email]
    
    # 2. Check organization-based access
    if market.organization and organization:
        if organization.name == market.organization:
            # Check if user is in organization
            if (user_email == organization.owner or 
                user_email in organization.admins or 
                user_email in organization.members):
                return MarketRole.VIEWER  # Organization members get View permission
    
    return None  # No access

def user_has_permission(user_email: str, market: Market, required_role: MarketRole, organization: Optional[Organization] = None) -> bool:
    """
    Check if user has required permission level.
    """
    user_role = get_user_market_role(user_email, market, organization)
    if user_role is None:
        return False
    
    # Permission hierarchy: Owner > Admin > Editor > Viewer
    role_hierarchy = {
        MarketRole.OWNER: 4,
        MarketRole.ADMIN: 3,
        MarketRole.EDITOR: 2,
        MarketRole.VIEWER: 1
    }
    
    return role_hierarchy[user_role] >= role_hierarchy[required_role]

def can_manage_roles(user_email: str, market: Market, target_role: MarketRole, organization: Optional[Organization] = None) -> bool:
    """
    Check if user can add/remove users with target_role.
    """
    user_role = get_user_market_role(user_email, market, organization)
    if user_role is None:
        return False
    
    # Owner can manage all roles
    if user_role == MarketRole.OWNER:
        return True
    
    # Admin can manage Editor and Viewer
    if user_role == MarketRole.ADMIN:
        return target_role in [MarketRole.EDITOR, MarketRole.VIEWER]
    
    return False
```

### Market Query Functions

```python
def get_markets_for_user(user_email: str) -> List[Market]:
    """
    Get all markets a user has access to (via explicit role or organization).
    """
    # Get markets where user has explicit role
    markets_with_role = markets_collection.find({
        f"roles.{user_email}": {"$exists": True}
    })
    
    # Get user's organizations
    user = users_collection.find_one({"email": user_email})
    if not user:
        return []
    
    org_names = user.get("organizations", [])
    
    # Get markets belonging to user's organizations
    org_markets = markets_collection.find({
        "organization": {"$in": org_names}
    })
    
    # Combine and deduplicate
    market_ids = set()
    result = []
    
    for market in list(markets_with_role) + list(org_markets):
        market_id = (market["name"], market["owner"])
        if market_id not in market_ids:
            market_ids.add(market_id)
            result.append(market)
    
    return result
```

---

## Permission Resolution Logic

### Flowchart

```
User requests Market access
    │
    ├─→ Check market.roles[user_email]
    │   │
    │   ├─→ Found? → Return role (Owner/Admin/Editor/Viewer)
    │   │
    │   └─→ Not found? → Continue
    │
    ├─→ Check market.organization
    │   │
    │   ├─→ Exists? → Check user in organization
    │   │   │
    │   │   ├─→ User in org.owner/admins/members? → Return Viewer
    │   │   │
    │   │   └─→ Not in org? → Continue
    │   │
    │   └─→ No org? → Continue
    │
    └─→ No access → Return None/403
```

### Permission Matrix

| User Role | Can Edit | Can View | Can Manage Admins | Can Manage Editors | Can Manage Viewers |
|-----------|----------|----------|-------------------|-------------------|-------------------|
| Owner     | ✅       | ✅       | ✅                | ✅                | ✅                |
| Admin     | ✅       | ✅       | ❌                | ✅                | ✅                |
| Editor    | ✅       | ✅       | ❌                | ❌                | ❌                |
| Viewer    | ❌       | ✅       | ❌                | ❌                | ❌                |

### Organization Permission Matrix

| Org Role | Can Manage Admins | Can Manage Members | Market Access |
|----------|------------------|-------------------|---------------|
| Owner    | ✅               | ✅                | View all org markets |
| Admin    | ❌               | ✅                | View all org markets |
| Member   | ❌               | ❌                | View all org markets |

**Note:** Organization members get View permission on organization markets, but explicit market roles take precedence.

---

## Migration Strategy

### Phase 1: Add New Fields (Backward Compatible)

1. Add `roles: Dict[str, str]` to Market (populate from existing `owner`, `editors`, `viewers`)
2. Add `organization: Optional[str]` to Market
3. Add `theme: Optional[ThemeObject]` to Market and Organization
4. Keep old fields temporarily for backward compatibility

### Phase 2: Update Organization Structure

1. Add `owner`, `admins`, `members` to Organization
2. Migrate `users` list to appropriate role lists
3. Add `theme` to Organization

### Phase 3: Update API Logic

1. Update market query functions to check `roles` dict
2. Implement permission resolution functions
3. Update API endpoints to use new permission checks
4. Add role management endpoints

### Phase 4: Remove Old Fields

1. Remove `editors` and `viewers` from Market (keep `owner` for reference)
2. Remove `users` from Organization
3. Remove `markets` from User (derive from queries)

### Migration Script Example

```python
def migrate_market_roles():
    """Migrate old role lists to new roles dict."""
    markets = markets_collection.find({})
    
    for market in markets:
        roles = {}
        
        # Migrate owner
        if 'owner' in market:
            roles[market['owner']] = 'owner'
        
        # Migrate editors
        if 'editors' in market:
            for editor in market['editors']:
                if editor not in roles:  # Don't override owner
                    roles[editor] = 'editor'
        
        # Migrate viewers
        if 'viewers' in market:
            for viewer in market['viewers']:
                if viewer not in roles:  # Don't override owner/editors
                    roles[viewer] = 'viewer'
        
        # Update market with new roles
        markets_collection.update_one(
            {"_id": market["_id"]},
            {"$set": {"roles": roles}}
        )
```

---

## Implementation Checklist

### Backend Changes

- [ ] **Data Types (`datatypes.py`)**
  - [ ] Add `MarketRole` enum
  - [ ] Add `OrganizationRole` enum
  - [ ] Add `ThemeObject` class
  - [ ] Update `Market` class:
    - [ ] Add `roles: Dict[str, MarketRole]`
    - [ ] Add `organization: Optional[str]`
    - [ ] Add `theme: Optional[ThemeObject]`
    - [ ] Add validators for role constraints
    - [ ] Keep `owner` field for backward compatibility
  - [ ] Update `Organization` class:
    - [ ] Replace `users: List[str]` with `owner`, `admins`, `members`
    - [ ] Add `theme: Optional[ThemeObject]`
    - [ ] Add validators
  - [ ] Update `User` class:
    - [ ] Consider removing `markets` list (derive from queries)

- [ ] **Permission Logic (`api/permissions.py` - new file)**
  - [ ] Implement `get_user_market_role()`
  - [ ] Implement `user_has_permission()`
  - [ ] Implement `can_manage_roles()`
  - [ ] Implement `get_markets_for_user()`

- [ ] **Market API (`api/markets.py`)**
  - [ ] Update `get_markets_by_owner_email()` → `get_markets_for_user()`
  - [ ] Add permission checks to all market operations
  - [ ] Add role management endpoints:
    - [ ] `add_market_role(user_email, role)`
    - [ ] `remove_market_role(user_email)`
    - [ ] `update_market_role(user_email, new_role)`
  - [ ] Update market creation to initialize `roles` dict

- [ ] **Organization API (`api/organizations.py` - new file)**
  - [ ] Create organization CRUD operations
  - [ ] Add role management endpoints:
    - [ ] `add_org_admin(user_email)`
    - [ ] `add_org_member(user_email)`
    - [ ] `remove_org_user(user_email)`
    - [ ] `transfer_org_ownership(new_owner_email)`

- [ ] **Database Migration**
  - [ ] Create migration script for market roles
  - [ ] Create migration script for organization structure
  - [ ] Update `init_database.py` to include `organizations` collection

- [ ] **Theming Support**
  - [ ] Add theme storage/retrieval
  - [ ] Implement theme resolution logic (org theme vs market theme)

### Frontend Changes

- [ ] **Type Definitions (`types/datatypes.ts`)**
  - [ ] Update `Market` interface with new fields
  - [ ] Update `Organization` interface
  - [ ] Add `ThemeObject` interface
  - [ ] Add role enums

- [ ] **Market List View**
  - [ ] Update to use `get_markets_for_user()` endpoint
  - [ ] Show user's role for each market
  - [ ] Filter/organize by organization

- [ ] **Market Access Control**
  - [ ] Implement permission checks in components
  - [ ] Show/hide UI elements based on role
  - [ ] Add role management UI (for Owners/Admins)

- [ ] **Organization Management**
  - [ ] Create organization management views
  - [ ] Add organization selection when creating market
  - [ ] Show organization theming

- [ ] **Theming**
  - [ ] Apply organization/market themes
  - [ ] Theme editor UI

### Testing

- [ ] **Unit Tests**
  - [ ] Test permission resolution logic
  - [ ] Test role management functions
  - [ ] Test organization access logic

- [ ] **Integration Tests**
  - [ ] Test market access with various role combinations
  - [ ] Test organization-based access
  - [ ] Test role precedence (explicit > organization)

- [ ] **Migration Tests**
  - [ ] Test migration scripts
  - [ ] Verify backward compatibility

---

## Key Design Decisions

### 1. Role Storage: Dict vs Separate Lists
**Decision:** Use `Dict[str, MarketRole]` for roles
**Rationale:** Enforces single role per user, easier to query and update

### 2. Backward Compatibility
**Decision:** Keep `owner` field temporarily, populate `roles` from old fields
**Rationale:** Allows gradual migration without breaking existing code

### 3. Organization Role Storage
**Decision:** Store roles in Organization, not User
**Rationale:** Organization owns the relationship, easier to manage permissions

### 4. Market List in User
**Decision:** Remove `markets` list from User, derive from queries
**Rationale:** Reduces data duplication, always accurate, supports organization-based access

### 5. Theming Resolution
**Decision:** Organization theme overrides market theme
**Rationale:** Organizations want consistent branding across markets

---

## Open Questions

1. **Market Naming:** Can markets have the same name if they belong to different organizations? Currently markets are identified by `(name, owner)` - should this change?

2. **Organization Deletion:** What happens to markets when organization is deleted? Should markets be orphaned or deleted?

3. **Role Transfer:** How to handle owner transfer? Should there be an approval process?

4. **Bulk Operations:** Should admins be able to bulk-add users to multiple markets?

5. **Audit Logging:** Should we track role changes and permission checks?

---

## Next Steps

1. Review and approve proposed structure
2. Create detailed API specifications
3. Implement backend changes in phases
4. Update frontend to match new structure
5. Test thoroughly before removing old fields
6. Document API changes for frontend team
