# 06: Intake mode on Market - what exactly does it govern?

Type: grilling
Status: resolved
Blocked by: none

## Question

Charting settled that a market declares its intake mode, and that MVP markets are CSV-intake with the public applicant surface switched off.
The applicant login and application pages are built and merged; they are being withheld, not removed.

Decide what the field governs, and how tightly.

### Why the field is necessary at all

Application submission is already gated to `applications_open` (`api/applicants.py:289-295`).
But charting also settled that CSV markets pass through `applications_open` - that is where the import happens.
So during that window a CSV market's public application form is live and accepting strangers.
**The phase cannot distinguish the two cases; that is precisely the gap intake mode fills.**

### The public surface, as it stands

Seven public endpoints, splitting cleanly in two:

- **Applicant intake (five)**: `applicant-login/request-code`, `applicant-login/verify-code`, `application-form` GET, `applicant/application` GET, `applicant/application` PUT.
- **Check-in (two)**: `attendance/checkin`, `vendors/<email>/assignments`.

Front-end mirrors it: `/:marketSlug`, `/:marketSlug/apply`, `/:marketSlug/applicant-login`, `/:marketSlug/applicant/dashboard` against `/:marketSlug/check-in`.

## Answer

### Values

**`csv` and `form`. Exactly one. No hybrid.**

Hybrid intake - importing some vendors while accepting others online - is plausible eventually but makes ticket 05's re-import collision question real instead of hypothetical, and nothing in MVP needs it.
A third value can be added later without breaking either existing one, so this forecloses nothing.

### What it gates

**The five applicant-intake endpoints and their four front-end routes. Not check-in.**

Check-in concerns vendors who are already assigned; how they entered the market is irrelevant to whether they can scan in on the day.
Gating it would break a CSV market's market-day flow for no reason.

**It does not gate the form builder.** A CSV market still has an application form, because **the essential questions define the offering the CSV maps onto**.
The organizer still authors it; it simply is not served publicly.
Intake mode decides who fills the form in, not whether one exists.

### Enforcement

**A second lookup helper in `back-end/market_documents.py`** - for example `applicant_intake_market_by_slug` - layered on `published_market_by_slug` and used by exactly those five endpoints.

`AGENTS.md` is explicit that the public draft decision belongs in one place and is made in Python rather than in a Mongo filter; this follows that precedent instead of opening a second front.
It cannot be `published_market_by_slug` itself, because check-in shares that lookup and must stay open.
Rejected: a check in each of the five endpoints, which is five chances to forget the sixth.

### Ownership and mutability

**Organizer-settable, frozen once the market leaves `draft`.**

Switching intake mid-lifecycle strands whatever the previous mode produced: flip a form market to CSV after applicants have applied and their dashboards go dark.
This mirrors the D9 application-form lock - editable until it would invalidate something real, then fixed for good.

It is client-writable only on the `draft` edit path; every later write re-applies the stored value, exactly as `update_market()` already does for `phase` and the application form.

### Default for existing documents

**Absence means `csv`** - the public applicant surface is off unless a market says otherwise.

The `phase_from_market_document` lesson recorded in `AGENTS.md` is that a default which silently mislabels existing documents is the failure mode to avoid.
Between the two possible mistakes, wrongly exposing a public application surface is worse than wrongly hiding one: hiding is visible and gets complained about, exposing is silent until a stranger applies.
No market has shipped, so the blast radius is nil either way - which makes this the cheap moment to choose the safe default.
